import { WorkspaceWriteException } from '../common/workspace/workspace-write-policy.decorator';
/**
 * Streamable HTTP transport endpoint for the Project Ops MCP server.
 *
 * Brigade (and any MCP client) sends POST/GET/DELETE on /api/v1/mcp. We
 * authenticate via JWT, mint a per-request MCP server scoped to the user,
 * and let the SDK transport handle the protocol framing.
 *
 * Stateless mode: each request is its own session. Brigade re-authenticates
 * per call, so we don't need to track sessions on our side.
 */

import { All, Controller, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { McpService } from './mcp.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { readDelegationHeader } from '../common/workspace/federation-delegation';
import { THROTTLER_MCP } from '../config/throttler.config';
import { User, UserRole, PersonalAccessToken } from '@prisma/client';

@ApiTags('mcp')
@ApiBearerAuth()
// The MCP endpoint is an AUTHENTICATED agent surface (Brigade & MCP clients):
// a busy chat issues many tool calls per turn, so the human `short`/`long`
// tiers are too tight — but these calls can create projects/tasks and trigger
// LLM inference, so we must NOT leave it unlimited (the previous blanket
// @SkipThrottle did). Skip the human tiers and apply the dedicated,
// present-but-looser `mcp` tier instead (see config/throttler.config.ts). The
// explicit per-tier maps are required for @nestjs/throttler v5.
@SkipThrottle({ short: true, long: true })
@Throttle({ [THROTTLER_MCP]: { limit: 300, ttl: 60_000 } })
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcp: McpService,
    private readonly workspace: WorkspaceContextService,
  ) {}

  @All()
  @WorkspaceWriteException('mcp')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'MCP Streamable HTTP endpoint. Auth as a Project Ops user; agent acts on their behalf.',
  })
  async handle(@Req() req: Request, @Res() res: Response) {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    // Generic agent tools expose internal working material; clients use the curated portal.
    if (user.role === UserRole.CLIENT) {
      res.status(403).json({ error: 'client_portal_required' });
      return;
    }

    // If the caller authenticated with a Personal Access Token, the
    // JwtAuthGuard stashed the resolved row on the request. The MCP
    // server builder uses the token's `scopes` list to gate which
    // tools the agent can invoke; JWT-auth'd callers (no `pat` on the
    // request) get the full RBAC-gated tool set.
    const pat = (req as any).pat as PersonalAccessToken | undefined;
    const grantedScopes = pat ? pat.scopes : null;
    // The PAT's bound workspace. The guard already 403'd any explicit
    // X-Workspace-Id that disagreed with it; we thread it into the MCP
    // server so every tool call additionally fails closed if the acting
    // user's resolved workspace ever drifts from the PAT's workspace.
    const patWorkspaceId = pat ? (pat.workspaceId ?? null) : null;

    // The workspace this REQUEST addressed, resolved by the global
    // WorkspaceMembershipGuard with the SUITE-IDENTITY §D4 precedence
    // (path param → X-Workspace-Id header → token claim) and — when
    // PROJECT_OPS_TENANCY_ENABLED is on — already membership-authorized
    // (non-members were 403'd before this handler ran). Threading it into
    // the MCP server is what lets a JWT-auth'd MCP client re-scope with
    // X-Workspace-Id, exactly like the REST layer's @CurrentWorkspace;
    // previously the MCP tools re-resolved from the claim/default only,
    // silently ignoring the header. For a PAT this equals the PAT's bound
    // workspace (the guard 403'd any disagreeing header).
    const requestWorkspaceId = ((req as any).workspaceId as string | undefined) ?? null;

    // Forward the caller's bearer so cross-app tools (e.g. the billable
    // rollup → Accounting-Ops) can act on the user's behalf.
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '') : null;

    const {
      StreamableHTTPServerTransport,
      // Preserve lazy CommonJS SDK loading used by the existing runtime.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const transport = new StreamableHTTPServerTransport({
      // Stateless — no session ID assignment, MCP clients send their own.
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close().catch(() => undefined);
    });

    // ON-BEHALF-OF federation read (task 092b2902). A verified, allow-listed
    // federation actor that names the acting user (X-Uc-Uid) runs AS that
    // member, capped to read scopes and bound to the token's workspace — never
    // more than the user's own session would see. A machine call without the
    // header keeps the unchanged federation path; a header that cannot be
    // honoured is refused outright rather than silently ignored.
    const delegation = await this.workspace.resolveFederationDelegation(
      user as any,
      readDelegationHeader(req.headers as any),
      requestWorkspaceId,
    );
    if (delegation.kind === 'denied') {
      this.logger.warn(
        `MCP federation delegation refused (user=${user.username}): ${delegation.reason}`,
      );
      res.status(403).json({ error: 'federation_delegation_denied', reason: delegation.reason });
      return;
    }

    try {
      const server =
        delegation.kind === 'delegated'
          ? await this.mcp.createServerForUser(
              delegation.user,
              delegation.scopes,
              null, // never forward the machine bearer to cross-app tools
              delegation.workspaceId,
              {
                id: `federation:${delegation.actor}`,
                name: `${delegation.actor} on behalf of ${delegation.user.email}`,
              },
              delegation.workspaceId,
            )
          : await this.mcp.createServerForUser(
              user,
              grantedScopes,
              bearerToken,
              patWorkspaceId,
              undefined, // patIdentity — unchanged (label enrichment not wired here)
              requestWorkspaceId,
            );
      await server.connect(transport);
      // body has already been parsed by express.json — pass it through.
      await transport.handleRequest(req, res, (req as any).body);
    } catch (err) {
      this.logger.error(`MCP request failed (user=${user.email}): ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'mcp_internal_error' });
      }
    }
  }
}
