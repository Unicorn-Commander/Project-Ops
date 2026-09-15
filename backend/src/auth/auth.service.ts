import { Injectable, UnauthorizedException, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LoginDto } from './dto/login.dto';
import { ClientSignupDto } from './dto/client-signup.dto';
import { User, UserRole, WorkspaceRole, MembershipStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { resolveUserAccess, describeAccessList } from './access-list';
import {
  resolveEntitlement,
  entitlementsEnabled,
  entitlementsFailOpen,
  entitlementsAllowlistFallback,
} from './entitlements.client';
import {
  MembershipService,
  ActiveWorkspaceMembership,
} from '../common/workspace/membership.service';
import {
  isHumanSessionPayload,
  readActorClientId,
} from '../common/workspace/federation-token';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  username: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private membershipService: MembershipService,
  ) {
    // Boot-time visibility into the active SSO access list — operator
    // can `docker logs project-ops-backend | grep "SSO access list"` to
    // confirm the right env was loaded (vs. silent legacy fallback).
    const meta = describeAccessList();
    this.logger.log(
      `SSO access list: ${meta.ruleCount} rule${meta.ruleCount === 1 ? '' : 's'} (source: ${meta.source})`,
    );
  }

  async validateUser(email: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) {
      return null;
    }
    return user;
  }

  /**
   * The caller's active workspace memberships for the frontend switcher
   * (Phase C2 / C3). Lives in the JSON response body of login / SSO token
   * issuance / profile — NEVER in the JWT (token claims are unchanged).
   *
   * While `PROJECT_OPS_TENANCY_ENABLED` is OFF, no Membership rows exist for
   * most users, so this returns `[]` and the frontend keeps its single-tenant
   * behavior. Once tenancy is on (and memberships are seeded), each entry is
   * `{ workspaceId, slug, displayName, role, isDefault }`, default-first.
   */
  private async workspacesForUser(
    user: User,
  ): Promise<ActiveWorkspaceMembership[]> {
    return this.membershipService.listActiveWorkspaces(user);
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Validate password
    if (!user.password) {
      throw new UnauthorizedException('Password not set for this account');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.usersService.updateLastLogin(user.id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      username: user.username,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange || false,
      },
      workspaces: await this.workspacesForUser(user),
    };
  }

  /**
   * Build the `/api/auth/profile` response body, including the caller's active
   * workspace memberships for the switcher (same `workspaces[]` shape as
   * login). On a fresh page load the frontend hydrates from this endpoint
   * (the login response is not persisted), so it must carry `workspaces[]`
   * too or the switcher would be empty after reload.
   */
  async getProfile(user: User) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      forcePasswordChange: user.forcePasswordChange || false,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      workspaces: await this.workspacesForUser(user),
    };
  }

  async validateKeycloakUser(
    keycloakId: string,
    profile: any,
    accessToken?: string,
  ): Promise<User> {
    const email = profile.email;
    const getEnv = (k: string) => this.configService.get<string>(k);

    // When the Ops-Center entitlements gate is ARMED (flag + URL + a forwarded
    // uchub Bearer), it governs and is RE-CHECKED on EVERY interactive SSO
    // login, so a revoked entitlement (plan change / cancellation) locks a
    // previously-provisioned user out. We therefore evaluate it BEFORE the
    // find/link so it covers existing users too. The legacy allowlist path
    // keeps today's exact semantics (gate only on first JIT, below), so the
    // flag-OFF default is byte-for-byte unchanged.
    const armed = entitlementsEnabled(getEnv) && !!accessToken;
    let resolvedAccess: { allowed: boolean; role: UserRole; reason: string } | null = null;
    if (armed) {
      resolvedAccess = await this.resolveSsoAccess(email, accessToken);
      if (!resolvedAccess.allowed) {
        this.logger.warn(`Rejected SSO for ${email || '(no email)'} — ${resolvedAccess.reason}`);
        throw new UnauthorizedException(
          'You are not authorized for Project-Ops. Contact your administrator.',
        );
      }
    }

    // First try to find by keycloakId, then fall back to email match
    let user = await this.usersService.findByKeycloakId(keycloakId);

    if (!user && email) {
      // Check if a local user exists with this email (link accounts)
      user = await this.usersService.findByEmail(email);
      if (user) {
        // Link existing local account to Keycloak
        await this.usersService.update(user.id, { keycloakId });
        this.logger.log(`Linked existing user ${email} to Keycloak ID ${keycloakId}`);
      }
    }

    if (!user) {
      // Gate (first JIT): Project-Ops is single-tenant internal. Just because an
      // email exists in the shared `uchub` Keycloak realm does NOT mean they get
      // a Project-Ops account. When armed, the entitlements verdict above already
      // governs; otherwise the static `PROJECT_OPS_ACCESS_LIST` defines who may
      // JIT-provision and at what role. See `auth/access-list.ts` +
      // `auth/entitlements.client.ts`.
      const access = resolvedAccess ?? (await this.resolveSsoAccess(email, accessToken));
      if (!access.allowed) {
        this.logger.warn(
          `Rejected SSO JIT for ${email || '(no email)'} — ${access.reason}`,
        );
        throw new UnauthorizedException(
          'You are not authorized for Project-Ops. Contact your administrator.',
        );
      }

      // Auto-create from the Keycloak profile with the resolved role. The role
      // is seeded ONCE here; later logins re-check ACCESS but never clobber an
      // in-app role change (the entitlements role is coarse — owner->ADMIN, else
      // ->STAFF; MANAGER/CLIENT are refined in-app).
      user = await this.usersService.create({
        email,
        username: profile.preferred_username || profile.username || email,
        firstName: profile.given_name || profile.firstName || '',
        lastName: profile.family_name || profile.lastName || '',
        keycloakId,
        role: access.role,
      });

      this.logger.log(
        `Created new user from Keycloak SSO: ${email} with role ${access.role} (${access.reason})`,
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    return user;
  }

  /**
   * Resolve "may this Keycloak identity sign into Project-Ops, and at what JIT
   * role" — the single gate behind the SSO login. Two sources, picked at runtime:
   *
   *  - ARMED entitlements gate (PROJECT_OPS_ENTITLEMENTS_ENABLED + UC_ENTITLEMENTS_URL
   *    + a forwarded uchub Bearer): Ops-Center is the source of truth. Allowed iff
   *    the org carries PROJECT_OPS_FEATURE_KEY; role mapped from the org role.
   *    INDETERMINATE (endpoint outage/timeout) fails CLOSED (deny) unless
   *    PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN degrades it to the allowlist.
   *  - Otherwise the static PROJECT_OPS_ACCESS_LIST (today's behavior, and the
   *    no-token fallback for the realm-token-direct-to-API / Brigade-federated
   *    callers, which adopt entitlements as a documented fast-follow).
   */
  private async resolveSsoAccess(
    email: string | undefined,
    accessToken?: string,
  ): Promise<{ allowed: boolean; role: UserRole; reason: string }> {
    const getEnv = (k: string) => this.configService.get<string>(k);

    if (!entitlementsEnabled(getEnv) || !accessToken) {
      const a = resolveUserAccess(email);
      return { allowed: a.allowed, role: a.role, reason: a.reason };
    }

    const ent = await resolveEntitlement(accessToken, {
      getEnv,
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
        error: (m) => this.logger.error(m),
      },
    });

    if (ent.outcome === 'allowed') {
      return { allowed: true, role: ent.role ?? UserRole.STAFF, reason: ent.reason };
    }
    if (ent.outcome === 'denied') {
      // "Soft enforce" migration aid: while Ops-Center orgs are still being
      // seeded with entitlements, an allowlisted (known-good) user must not be
      // locked out by an unseeded org. When the fallback is on, a DEFINITIVE
      // deny degrades to the allowlist — the gate still hard-denies anyone NOT
      // on the allowlist. Set the flag false to land on pure enforcement once
      // every intended org is seeded.
      if (entitlementsAllowlistFallback(getEnv)) {
        const a = resolveUserAccess(email);
        if (a.allowed) {
          this.logger.warn(
            `Entitlements denied (${ent.reason}) but ${email || '(no email)'} is allowlisted — ` +
              `granting via soft-enforce allowlist fallback`,
          );
          return {
            allowed: true,
            role: a.role,
            reason: `entitlement-denied→allowlist-fallback: ${a.reason}`,
          };
        }
      }
      return { allowed: false, role: UserRole.STAFF, reason: ent.reason };
    }

    // indeterminate: an Ops-Center outage/timeout. Fail CLOSED by default (this
    // is a security gate); only degrade to the allowlist when explicitly opted in.
    if (entitlementsFailOpen(getEnv)) {
      this.logger.warn(
        `Entitlements indeterminate (${ent.reason}); failing OPEN to the allowlist for ${email || '(no email)'}`,
      );
      const a = resolveUserAccess(email);
      return {
        allowed: a.allowed,
        role: a.role,
        reason: `entitlements-indeterminate→allowlist: ${a.reason}`,
      };
    }
    this.logger.error(
      `Entitlements indeterminate (${ent.reason}); failing CLOSED (deny) for ${email || '(no email)'}`,
    );
    return {
      allowed: false,
      role: UserRole.STAFF,
      reason: `entitlements-indeterminate→deny: ${ent.reason}`,
    };
  }

  async generateTokenForUser(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      username: user.username,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange || false,
      },
      workspaces: await this.workspacesForUser(user),
    };
  }

  async validateJwtPayload(payload: any): Promise<User> {
    // Disambiguate by `iss` claim across three branches:
    //
    //   1. Keycloak realm-signed (uchub SSO browser flow):
    //      `iss` contains `/realms/`, `sub` = Keycloak userId.
    //   2. Brigade federation-signed (cross-app MCP via the broker):
    //      `iss` listed in BRIGADE_TRUSTED_ISSUERS env (defaults to the
    //      prod broker at https://brigade.unicorncommander.ai), `sub`
    //      currently = customer email (transitional; opaque uchub sub
    //      upgrade is parked). Both Keycloak and Brigade tokens route
    //      through validateKeycloakUser so JIT-provisioning, the access
    //      list gate, and email-fallback linking all apply uniformly.
    //   3. Locally-signed (browser session token, HS256):
    //      no `iss`, `sub` = project-ops user id.
    const issuer: string | undefined = payload?.iss;
    const isKeycloakRealmToken =
      typeof issuer === 'string' && issuer.includes('/realms/');
    const isBrigadeFederationToken =
      typeof issuer === 'string' && AuthService.brigadeTrustedIssuers().includes(issuer);

    if (isBrigadeFederationToken) {
      // Audience-binding enforcement: a JWT minted for a different
      // federated app MUST be rejected here, otherwise a Meeting-Ops
      // token (or any other audience) could be replayed against PO.
      // This is the single most important security property of the
      // federation broker and is non-negotiable.
      const expectedAudience =
        process.env.BRIGADE_EXPECTED_AUDIENCE || 'project-ops';
      const aud = payload?.aud;
      const audMatches =
        aud === expectedAudience ||
        (Array.isArray(aud) && aud.includes(expectedAudience));
      if (!audMatches) {
        this.logger.warn(
          `Brigade JWT audience mismatch: token aud=${JSON.stringify(aud)}, expected '${expectedAudience}'`,
        );
        throw new UnauthorizedException(
          'Token audience does not match this app',
        );
      }

    }

    // Federation ACTOR detection (Brigade token-exchange AND Keycloak
    // client-credentials). A machine token carries azp / client_id /
    // act.client_id and NO human session (no email, no sid/session_state,
    // sub is not an email). It must NOT be forced through the human
    // access-list (it would 401 or JIT-provision a service account as a
    // person); resolve a synthetic, non-DB federation principal instead.
    // WHAT it may do is gated by FederationActorGuard (allow-list + route
    // scope). A token that ALSO looks like a human session is treated as
    // that human (on-behalf-of-user) so membership governs, not federation.
    if (isBrigadeFederationToken || isKeycloakRealmToken) {
      const actorClientId = readActorClientId(payload);
      if (actorClientId && !isHumanSessionPayload(payload)) {
        return AuthService.buildFederationPrincipal(actorClientId);
      }
    }

    if (isKeycloakRealmToken || isBrigadeFederationToken) {
      // Reuse the same JIT-provisioning + access-list gate as the
      // /auth/keycloak browser callback so cross-app federation cannot
      // bypass policy. validateKeycloakUser handles linking by email
      // when an existing local user is present, and works for both
      // sub=keycloakUuid (Keycloak branch) and sub=email (Brigade
      // transitional) because the email-fallback path covers both.
      //
      // Brigade's mint_app_jwt does not currently emit an `email` claim
      // (the customer identity lives in `sub` as a transitional choice
      // per project_brigade_federation_identity_model). When the email
      // claim is absent and `sub` looks like an email, treat sub as the
      // profile email so the access-list + findByEmail path still
      // resolves. This is harmless for Keycloak realm tokens (which DO
      // emit email) and harmless for the long-term opaque-sub Brigade
      // model (Brigade will emit email separately in that case).
      const subLooksLikeEmail =
        typeof payload.sub === 'string' && payload.sub.includes('@');
      const profile = {
        email:
          payload.email ?? (subLooksLikeEmail ? payload.sub : undefined),
        preferred_username: payload.preferred_username,
        given_name: payload.given_name,
        family_name: payload.family_name,
      };
      return this.validateKeycloakUser(payload.sub, profile);
    }

    // Locally-signed token: existing behavior.
    const user = await this.usersService.findOne(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return user;
  }

  /**
   * A synthetic, NON-PERSISTENT principal for a trusted sibling-app federation
   * call (a Brigade token-exchange whose `act.client_id` is the calling app,
   * or a Keycloak client-credentials token whose `azp`/`client_id` is the
   * calling app, e.g. `meeting-ops`). It has no DB row and no human UserRole;
   * it is authorized ONLY by FederationActorGuard (actor allow-list + route
   * scope + the vouched workspace claim), never by a Membership row. The `id`
   * is a stable `federation:<app>` string used for the soft, non-FK
   * `TriageProposal.createdById` attribution and `app.uc_uid`. The marker
   * fields are read via the WithWorkspaceClaim cast downstream.
   */
  static buildFederationPrincipal(actorClientId: string): User {
    const now = new Date();
    return {
      id: `federation:${actorClientId}`,
      email: null,
      username: `federation:${actorClientId}`,
      password: null,
      firstName: null,
      lastName: null,
      role: null,
      isActive: true,
      keycloakId: null,
      createdAt: now,
      updatedAt: now,
      __isFederationActor: true,
      __federationActor: actorClientId,
    } as unknown as User;
  }

  /**
   * Parse the BRIGADE_TRUSTED_ISSUERS env var (comma-separated). Defaults
   * to the customer-facing prod broker. Set to "" to disable the federation
   * branch entirely. Read each call rather than cached so test/runtime env
   * changes take effect without a process restart.
   */
  private static brigadeTrustedIssuers(): readonly string[] {
    const raw = process.env.BRIGADE_TRUSTED_ISSUERS;
    if (raw === undefined || raw === null) {
      return ['https://brigade.unicorncommander.ai'];
    }
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.usersService.findOne(userId);

    if (!user || !user.password) {
      throw new UnauthorizedException('User not found or password not set');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear forcePasswordChange flag
    await this.usersService.update(userId, {
      password: hashedPassword,
      forcePasswordChange: false,
    });

    this.logger.log(`User ${user.email} changed their password`);

    // Send password change confirmation email (non-blocking)
    const userName = `${user.firstName} ${user.lastName}`.trim() || user.username;
    this.emailService.sendPasswordResetEmail(
      user.email,
      userName,
      '#', // No reset link needed for successful change
    ).catch(err => {
      this.logger.warn(`Failed to send password change confirmation email: ${err.message}`);
    });

    return { message: 'Password changed successfully' };
  }

  async resetUserPassword(adminUserId: string, targetUserId: string, newPassword: string, forceChange: boolean = true) {
    const admin = await this.usersService.findOne(adminUserId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new UnauthorizedException('Only admins can reset passwords');
    }

    const targetUser = await this.usersService.findOne(targetUserId);
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.usersService.update(targetUserId, {
      password: hashedPassword,
      forcePasswordChange: forceChange,
    });

    this.logger.log(`Admin ${admin.email} reset password for user ID ${targetUserId}`);

    // Send password reset notification email (non-blocking)
    const userName = `${targetUser.firstName} ${targetUser.lastName}`.trim() || targetUser.username;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'https://projectops.unicorncommander.ai');
    this.emailService.sendPasswordResetEmail(
      targetUser.email,
      userName,
      `${frontendUrl}/auth/login`, // Direct to login page after admin reset
    ).catch(err => {
      this.logger.warn(`Failed to send password reset notification email: ${err.message}`);
    });

    return { message: 'Password reset successfully', forcePasswordChange: forceChange };
  }

  async toggleForcePasswordChange(adminUserId: string, targetUserId: string, force: boolean) {
    const admin = await this.usersService.findOne(adminUserId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new UnauthorizedException('Only admins can manage password policies');
    }

    await this.usersService.update(targetUserId, {
      forcePasswordChange: force,
    });

    this.logger.log(`Admin ${admin.email} set forcePasswordChange=${force} for user ID ${targetUserId}`);

    return { message: `Force password change ${force ? 'enabled' : 'disabled'}`, forcePasswordChange: force };
  }

  async clientSignup(token: string, dto: ClientSignupDto) {
    // Verify passwords match
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Resolve the workspace from the provisional invite membership. Memberships
    // are a control-plane table (RLS-OFF), so this row is readable with NO GUC.
    // That is what breaks the chicken-and-egg: the invited Contact lives behind
    // FORCE-RLS and cannot be read until we already know its workspace. The
    // `invite:<token>` membership was written at invite time (inviteToPortal),
    // inside the operator's authorized workspace, precisely as that binding.
    const invite = await this.prisma.membership.findFirst({
      where: { userKey: `invite:${token}`, status: MembershipStatus.ACTIVE },
    });
    if (!invite) {
      throw new NotFoundException('Invalid invitation token');
    }
    const workspaceId = invite.workspaceId;

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Everything touching contacts (FORCE-RLS) runs inside the workspace GUC.
    const user = await this.prisma.withWorkspace(
      workspaceId,
      null,
      async (tx) => {
        const contact = await tx.contact.findUnique({
          where: { invitationToken: token },
        });
        if (!contact) {
          throw new NotFoundException('Invalid invitation token');
        }
        if (contact.userId) {
          throw new BadRequestException('Contact already signed up');
        }

        // Create user account (users is RLS-OFF; on tx for atomicity).
        const created = await tx.user.create({
          data: {
            email: contact.email,
            username: contact.email,
            password: hashedPassword,
            firstName: contact.firstName,
            lastName: contact.lastName,
            role: 'CLIENT',
            isActive: true,
          },
        });

        // Link contact to user and clear invitation token.
        await tx.contact.update({
          where: { id: contact.id },
          data: {
            userId: created.id,
            invitationToken: null, // Clear token after use
            portalAccessEnabled: true,
          },
        });

        // Reconcile the provisional invite membership onto the real user key.
        // A CLIENT has no keycloakId, so membershipKey() == created.id.
        const finalUserKey = MembershipService.membershipKey(created);
        await tx.membership.upsert({
          where: {
            userKey_workspaceId: { userKey: finalUserKey, workspaceId },
          },
          update: {
            status: MembershipStatus.ACTIVE,
            role: WorkspaceRole.VIEWER,
            isDefault: true,
          },
          create: {
            userKey: finalUserKey,
            workspaceId,
            role: WorkspaceRole.VIEWER, // CLIENT → VIEWER (suite role map)
            status: MembershipStatus.ACTIVE,
            isDefault: true,
          },
        });
        // Consume the provisional row so the token can't be replayed.
        await tx.membership.deleteMany({
          where: { userKey: `invite:${token}` },
        });

        return created;
      },
    );

    this.logger.log(`Client ${user.email} signed up successfully with invitation token`);

    // Generate JWT token
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      username: user.username,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      // The reconciled VIEWER membership now resolves to the client's workspace.
      workspaces: await this.workspacesForUser(user),
    };
  }
}