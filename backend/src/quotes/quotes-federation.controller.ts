import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FederationActorGuard } from '../common/workspace/federation-actor.guard';
import { SkipWorkspaceMembership } from '../common/workspace/skip-workspace-membership.decorator';
import { QuoteAcceptedDto } from './dto/quote-accepted.dto';
import { FederationStatusFilter } from './federation-status.filter';
import { QUOTE_FEDERATION_ACTOR, federationError } from './quote-federation.util';
import { QuoteAcceptedResult, QuotesFederationService } from './quotes-federation.service';

/** Request markers stamped by FederationActorGuard (never by a header). */
interface FederationRequest {
  federationActor?: string | null;
  workspaceId?: string;
}

/**
 * Inbound federation ingress for Quotes & Proposals (QUOTES-CONTRACT-v1 §3).
 *
 * Guard chain: JwtAuthGuard authenticates (a Brigade token-exchange minted for
 * aud=project-ops with `act.client_id=customer-ops` resolves to a SYNTHETIC
 * federation principal) → FederationActorGuard elevates it ONLY if the actor is
 * on PROJECT_OPS_FEDERATION_ACTORS AND permitted on this handler
 * (`quoteAccepted` → customer-ops only), stamping `req.workspaceId` from the
 * Brigade-vouched `workspace_id` claim. The `X-Workspace-Id` header is never
 * read here: the claim is the boundary.
 *
 * Actor-only by design: there is no human path on this route. A human token
 * (even ADMIN) gets 403 FEDERATION_ACTOR_REQUIRED — "retry federation" is a
 * Customer-Ops action that re-enters through the same actor. That is also why
 * the global WorkspaceMembershipGuard is opted out (@SkipWorkspaceMembership):
 * the actor is not a workspace member; its workspace is re-gated by the guard.
 */
@ApiTags('federation')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, FederationActorGuard)
@UseFilters(FederationStatusFilter)
@Controller('federation/quotes')
export class QuotesFederationController {
  constructor(private readonly quotes: QuotesFederationService) {}

  @Post('accepted')
  @SkipWorkspaceMembership()
  @ApiOperation({
    summary:
      'Customer-Ops → Project-Ops: federate an accepted quote into a project (idempotent by customer_ops_quote_id + version)',
  })
  @ApiResponse({
    status: 201,
    description: 'Project + tasks + billing + PDF created; status=done, created=true',
  })
  @ApiResponse({
    status: 200,
    description: 'Idempotent replay; the same ids; status=done, created=false',
  })
  @ApiResponse({ status: 403, description: 'Not the customer-ops federation actor; status=failed' })
  async quoteAccepted(
    @CurrentUser() user: User,
    @Req() req: FederationRequest,
    @Body() dto: QuoteAcceptedDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QuoteAcceptedResult> {
    const actor = req.federationActor ?? null;
    const workspaceId = req.workspaceId?.trim();
    if (actor !== QUOTE_FEDERATION_ACTOR || !workspaceId) {
      throw federationError(
        HttpStatus.FORBIDDEN,
        'FEDERATION_ACTOR_REQUIRED',
        'Only the customer-ops federation actor may federate a quote acceptance ' +
          '(Brigade token exchange with aud=project-ops and act.client_id=customer-ops, ' +
          'allow-listed in PROJECT_OPS_FEDERATION_ACTORS, carrying a workspace_id claim).',
      );
    }

    const result = await this.quotes.acceptQuote(workspaceId, user, dto, {
      federationActor: actor,
    });
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }
}
