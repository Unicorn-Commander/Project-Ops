import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TriageService, CandidateItem } from './triage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

/**
 * Approval surface for the PO-owned triage agent. Everything is propose-then-
 * approve: ingest creates proposals, nothing becomes a Task until a human acts.
 * (DTOs with class-validator are a follow-up polish; bodies are typed inline.)
 */
@ApiTags('triage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  /** Submit candidate action items for triage (propose-only). Source-agnostic. */
  @Post('ingest')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Submit candidate action items for triage (propose-only)' })
  ingest(
    @Body() body: { items: CandidateItem[]; sourceType?: string },
    @Request() req,
  ) {
    const items = (body.items ?? []).map((it) => ({
      ...it,
      sourceType: it.sourceType ?? body.sourceType,
    }));
    return this.triage.ingestCandidates(items, req.user.id);
  }

  /** The "Unassigned / needs a project" inbox. */
  @Get('inbox')
  @ApiOperation({ summary: 'Unassigned proposals that need a project' })
  inbox() {
    return this.triage.listInbox();
  }

  /** All pending proposals (assigned + unassigned). */
  @Get('proposals')
  @ApiOperation({ summary: 'List pending triage proposals' })
  proposals() {
    return this.triage.listPending();
  }

  /** Approve a proposal -> creates the task (optionally override the project). */
  @Post('proposals/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Approve a proposal and create the task' })
  approve(
    @Param('id') id: string,
    @Body() body: { targetProjectId?: string },
    @Request() req,
  ) {
    return this.triage.approve(id, req.user.id, body?.targetProjectId);
  }

  /** Reject a proposal (no task created). */
  @Post('proposals/:id/reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Reject a proposal' })
  reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Request() req,
  ) {
    return this.triage.reject(id, req.user.id, body?.reason);
  }

  /** Create a NEW project from unassigned proposals, then apply them as its tasks. */
  @Post('create-project')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a project from unassigned proposals and apply them' })
  createProject(
    @Body()
    body: {
      proposalIds: string[];
      title: string;
      clientName: string;
      description?: string;
      priority?: string;
    },
    @Request() req,
  ) {
    const { proposalIds, ...projectInput } = body;
    return this.triage.createProjectFromUnassigned(
      proposalIds ?? [],
      projectInput,
      req.user.id,
    );
  }
}
