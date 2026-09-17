import { WorkspaceMutationGuard } from '../common/workspace/workspace-mutation.guard';
import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TriageService, CandidateItem } from './triage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { FederationActorGuard } from '../common/workspace/federation-actor.guard';
import { SkipWorkspaceMembership } from '../common/workspace/skip-workspace-membership.decorator';
import { User, UserRole } from '@prisma/client';

/**
 * Approval surface for the PO-owned triage agent. Everything is propose-then-
 * approve: ingest creates proposals, nothing becomes a Task until a human acts.
 * (DTOs with class-validator are a follow-up polish; bodies are typed inline.)
 *
 * Suite tenancy (Phase 2, B9): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('triage')
@ApiBearerAuth()
// Guard order matters: authenticate (JwtAuthGuard) → elevate a trusted
// federation actor on the propose-only `ingest` route (FederationActorGuard,
// which then short-circuits the next two) → human role (RolesGuard) → human
// workspace membership / D5 (WorkspaceMembershipGuard). Non-federation requests
// flow through the human path exactly as before.
@UseGuards(JwtAuthGuard, FederationActorGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  /** Submit candidate action items for triage (propose-only). Source-agnostic. */
  @Post('ingest')
  @UseGuards(WorkspaceMutationGuard)
  // Opt OUT of the GLOBAL WorkspaceMembershipGuard: this is the federation
  // ingress. A trusted sibling-app actor is NOT a workspace member, and the
  // global guard runs BEFORE this route's per-route FederationActorGuard (which
  // is what stamps req.federationActor + the vouched workspace claim).
  //
  // L2 hardening: this route is MACHINE-TOKEN ONLY. FederationActorGuard now
  // rejects a human session with 403 FEDERATION_ACTOR_REQUIRED — there is no
  // human fall-through on the Meeting-Ops bridge write. The @Roles decorator
  // remains only as documentation of the (now-unreachable) human surface.
  @SkipWorkspaceMembership()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Submit candidate action items for triage (propose-only)' })
  ingest(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Req() req: { federationActor?: string | null },
    @Body() body: { items: CandidateItem[]; sourceType?: string },
  ) {
    const items = (body.items ?? []).map((it) => ({
      ...it,
      sourceType: it.sourceType ?? body.sourceType,
    }));
    // req.federationActor is set ONLY by FederationActorGuard after the actor
    // allow-list check; when present the service uses the membership-free
    // workspace path (the actor is not a human member).
    return this.triage.ingestCandidates(workspaceId, user, items, {
      federationActor: req.federationActor ?? null,
    });
  }

  /** The "Unassigned / needs a project" inbox. */
  @Get('inbox')
  @ApiOperation({ summary: 'Unassigned proposals that need a project' })
  inbox(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.triage.listInbox(workspaceId, user);
  }

  /** All pending proposals (assigned + unassigned). */
  @Get('proposals')
  @ApiOperation({ summary: 'List pending triage proposals' })
  proposals(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.triage.listPending(workspaceId, user);
  }

  /** Approve a proposal -> creates the task (optionally override the project). */
  @Post('proposals/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Approve a proposal and create the task' })
  approve(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { targetProjectId?: string },
  ) {
    return this.triage.approve(workspaceId, user, id, body?.targetProjectId);
  }

  /** Reject a proposal (no task created). */
  @Post('proposals/:id/reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Reject a proposal' })
  reject(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.triage.reject(workspaceId, user, id, body?.reason);
  }

  /** Create a NEW project from unassigned proposals, then apply them as its tasks. */
  @Post('create-project')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a project from unassigned proposals and apply them' })
  createProject(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body()
    body: {
      proposalIds: string[];
      title: string;
      clientName: string;
      description?: string;
      priority?: string;
    },
  ) {
    const { proposalIds, ...projectInput } = body;
    return this.triage.createProjectFromUnassigned(
      workspaceId,
      user,
      proposalIds ?? [],
      projectInput,
    );
  }
}
