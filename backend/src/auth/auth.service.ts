import { Injectable, UnauthorizedException, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LoginDto } from './dto/login.dto';
import { ClientSignupDto } from './dto/client-signup.dto';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { resolveUserAccess, describeAccessList } from './access-list';

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
    };
  }

  async validateKeycloakUser(keycloakId: string, profile: any): Promise<User> {
    const email = profile.email;

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
      // Gate: Project-Ops is single-tenant internal. Just because an
      // email exists in the shared `uchub` Keycloak realm does NOT
      // mean they get a Project-Ops account — the access list defines
      // who can JIT-provision and at what role. See
      // `auth/access-list.ts` and the `PROJECT_OPS_ACCESS_LIST` env.
      const access = resolveUserAccess(email);
      if (!access.allowed) {
        this.logger.warn(
          `Rejected SSO JIT for ${email || '(no email)'} — ${access.reason}`,
        );
        throw new UnauthorizedException(
          'You are not authorized for Project-Ops. Contact your administrator.',
        );
      }

      // Auto-create user from Keycloak profile with the resolved role.
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

    // Find contact by invitation token
    const contact = await this.prisma.contact.findUnique({
      where: { invitationToken: token },
    });

    if (!contact) {
      throw new NotFoundException('Invalid invitation token');
    }

    if (contact.userId) {
      throw new BadRequestException('Contact already signed up');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Create user account
    const user = await this.prisma.user.create({
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

    // Link contact to user and clear invitation token
    await this.prisma.contact.update({
      where: { id: contact.id },
      data: {
        userId: user.id,
        invitationToken: null, // Clear token after use
        portalAccessEnabled: true,
      },
    });

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
    };
  }
}