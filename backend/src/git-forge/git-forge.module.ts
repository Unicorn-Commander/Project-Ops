import { Module } from '@nestjs/common';
import { GIT_FORGE_PROVIDER } from './git-forge.provider';
import { ForgejoAdapter } from './providers/forgejo.adapter';

/**
 * Git-forge integration module (design scaffold).
 *
 * INTENTIONALLY NOT imported by AppModule yet — zero runtime impact on main.
 * Phase 0 (after design approval) will:
 *   1. Land Prisma models + RLS for connections / repo links / activity
 *   2. Import GitForgeModule in AppModule
 *   3. Add WorkspaceContextService + MembershipService providers (tenancy seam)
 *   4. Add controller + GitForgeService
 *
 * Multi-provider note: v1 binds GIT_FORGE_PROVIDER → ForgejoAdapter. Phase 3
 * will introduce a small registry (kind → adapter) instead of a single bind.
 *
 * Spec: docs/designs/GIT-FORGE-INTEGRATION.md
 */
@Module({
  providers: [ForgejoAdapter, { provide: GIT_FORGE_PROVIDER, useExisting: ForgejoAdapter }],
  exports: [GIT_FORGE_PROVIDER, ForgejoAdapter],
})
export class GitForgeModule {}
