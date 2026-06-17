import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { tenancyEnabled } from '../common/workspace/feature-flags';

/**
 * Fail-closed runtime DB-role self-check (PO security-hardening item 2).
 *
 * Row-Level Security only enforces if the app's live connection role is
 * NOBYPASSRLS (`project_ops_app`). A role with BYPASSRLS (the table owner
 * `project_ops_admin`, or a superuser) silently sees EVERY workspace's rows
 * regardless of the RLS policies — so a misconfigured DATABASE_URL would turn
 * tenant isolation off with no visible symptom.
 *
 * At boot we ask Postgres what role we actually connected as and whether it
 * bypasses RLS. When tenancy is ON (PROJECT_OPS_TENANCY_ENABLED=true) a
 * BYPASSRLS role is a hard boot failure — better a loud crash than a silent
 * cross-tenant data leak. When tenancy is OFF (today's default, RLS created but
 * inert) we only WARN, because the current deploy still legitimately connects
 * as the owner; the warning is the early signal to fix DATABASE_URL before the
 * flag flips.
 *
 * This runs in onModuleInit (after PrismaService.onModuleInit has connected,
 * since Nest initializes providers in dependency order and this depends on
 * PrismaService).
 */
@Injectable()
export class DbRoleGuardService implements OnModuleInit {
  private readonly logger = new Logger(DbRoleGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enforced = tenancyEnabled((k) => this.config.get<string>(k));

    let rows: Array<{ current_user: string; rolbypassrls: boolean }>;
    try {
      // current_user resolves to the role the live session authenticated as.
      // rolbypassrls is the attribute that defeats RLS when true.
      rows = await this.prisma.$queryRawUnsafe<
        Array<{ current_user: string; rolbypassrls: boolean }>
      >(
        `SELECT current_user, rolbypassrls
           FROM pg_roles
          WHERE rolname = current_user`,
      );
    } catch (error) {
      const message = `Could not verify DB role attributes: ${(error as Error).message}`;
      if (enforced) {
        // Fail closed: if tenancy is ON we cannot prove RLS will enforce, so we
        // must not serve traffic.
        throw new Error(
          `${message}. Refusing to boot with PROJECT_OPS_TENANCY_ENABLED=true ` +
            `because RLS enforcement cannot be confirmed.`,
        );
      }
      this.logger.warn(message);
      return;
    }

    const row = rows?.[0];
    if (!row) {
      const message = 'DB role self-check returned no row for current_user (unexpected).';
      if (enforced) {
        throw new Error(`${message} Refusing to boot with PROJECT_OPS_TENANCY_ENABLED=true.`);
      }
      this.logger.warn(message);
      return;
    }

    const role = row.current_user;
    const bypassesRls = row.rolbypassrls === true;

    if (bypassesRls) {
      const message =
        `Database role '${role}' has BYPASSRLS — Row-Level Security will NOT be ` +
        `enforced. The runtime DATABASE_URL must connect as the NOBYPASSRLS role ` +
        `'project_ops_app' (the admin/owner role is for migrations only).`;
      if (enforced) {
        throw new Error(`${message} Refusing to boot with PROJECT_OPS_TENANCY_ENABLED=true.`);
      }
      this.logger.warn(
        `${message} Tenancy is currently OFF so this is tolerated, but it MUST ` +
          `be fixed before enabling PROJECT_OPS_TENANCY_ENABLED.`,
      );
      return;
    }

    this.logger.log(
      `DB role self-check passed: connected as '${role}' (NOBYPASSRLS) — RLS enforceable` +
        (enforced ? ' (tenancy ENABLED)' : ' (tenancy currently disabled)'),
    );
  }
}
