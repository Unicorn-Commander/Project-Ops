import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RegisterOutcome,
  RegisterWorkspaceInput,
  registerWorkspaceWithRegistry,
  ucRegistryEnabled,
} from './uc-registry.client';

/**
 * DI wrapper around the pure uc-registry client (uc-registry.client.ts).
 *
 * For NestJS services that create workspaces (today: the client-signup
 * provisioning path in AuthService). Reads UC_REGISTRY_URL via ConfigService and
 * routes the client's logging through a Nest Logger. Inert (a pure no-op) while
 * UC_REGISTRY_URL is unset — so it is safe to inject and call unconditionally,
 * exactly like the feature-flag helpers.
 *
 * Seed scripts (scripts/seed-phase2-tenancy.ts, the §9 RLS fixtures) call the
 * pure function directly — they have no Nest container — so the registration
 * logic lives in the client, not here, and both entry points stay in lock-step.
 */
@Injectable()
export class UcRegistryService {
  private readonly logger = new Logger('UcRegistryService');

  constructor(private readonly config: ConfigService) {}

  /** True when UC_REGISTRY_URL is configured (the client is armed). */
  get enabled(): boolean {
    return ucRegistryEnabled((k) => this.config.get<string>(k));
  }

  /**
   * Register (or idempotently re-assert) a workspace with uc-registry. No-op
   * when UC_REGISTRY_URL is unset. Never throws — see the client's failure
   * policy (best-effort + loud for this Phase-E step).
   */
  async registerWorkspace(input: RegisterWorkspaceInput): Promise<RegisterOutcome> {
    return registerWorkspaceWithRegistry(input, {
      getEnv: (k) => this.config.get<string>(k),
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
        error: (m) => this.logger.error(m),
      },
    });
  }
}
