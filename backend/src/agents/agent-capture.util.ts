/**
 * Capture helpers — derive an AgentEvent's identity + target from the wiring
 * context, kept OUT of the hot modules (mcp.service / assistant.service) so the
 * capture call-sites stay one line and the derivation is unit-testable.
 */

import { AgentActorKind, User } from '@prisma/client';
import { WithWorkspaceClaim } from '../common/workspace/workspace.util';

/** The agent identity (kind/key/label) for one MCP-authenticated caller. */
export interface McpActorIdentity {
  actorKind: AgentActorKind;
  actorKey: string;
  actorLabel: string;
}

/**
 * Resolve the agent identity for an MCP tool call from the acting user + the
 * auth context.
 *
 *   - A FEDERATION actor (Brigade token-exchange: `__isFederationActor`) is a
 *     non-human sibling app → FEDERATED, keyed by its uchub sub (`__ucUid`) or
 *     the calling app id, labeled with the app id.
 *   - A PAT-auth'd caller → PAT, keyed by the PAT id (stable per token), labeled
 *     with the PAT's human name ("Claude Code on Aaron's Mac"). When the PAT's
 *     id/name aren't threaded in (controller didn't enrich), we degrade to a
 *     stable per-user PAT key (`pat:<userId>`) so the roster still groups the
 *     agent — see `patAuth`.
 *   - A bare JWT/session caller (no PAT) → USER, keyed by the user id, labeled
 *     with their name/email. (An agent driving a browser session shows up as the
 *     user; PAT/federation are the true machine principals.)
 *
 * `patAuth` is the cheap signal the MCP service already has (grantedScopes !=
 * null ⇒ PAT-auth'd). `pat` is the richer id/name if the call-site provides it.
 */
export function resolveMcpActor(
  user: User & Partial<WithWorkspaceClaim>,
  pat?: { id: string; name?: string | null } | null,
  patAuth = false,
): McpActorIdentity {
  const u = user as WithWorkspaceClaim;

  if (u.__isFederationActor) {
    const app = u.__federationActor || 'federated';
    return {
      actorKind: AgentActorKind.FEDERATED,
      actorKey: (u.__ucUid && u.__ucUid.trim()) || app,
      actorLabel: `Federated agent (${app})`,
    };
  }

  if (pat?.id) {
    return {
      actorKind: AgentActorKind.PAT,
      actorKey: pat.id,
      actorLabel: pat.name?.trim() || 'Personal Access Token',
    };
  }

  if (patAuth) {
    // PAT-auth'd but the id/name weren't threaded through. Stable per-user key
    // so the roster groups this principal as a token (not the human session).
    const who = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
    return {
      actorKind: AgentActorKind.PAT,
      actorKey: `pat:${user.id}`,
      actorLabel: `Personal Access Token (${who})`,
    };
  }

  return {
    actorKind: AgentActorKind.USER,
    actorKey: user.id,
    actorLabel: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
  };
}

/** A tool call's derived target: which project/task/resource it touched. */
export interface ToolTarget {
  projectId: string | null;
  taskId: string | null;
  resource: string | null;
  resourceId: string | null;
}

const PROJECT_TOOLS = new Set([
  'create_project',
  'update_project',
  'update_project_status',
  'get_project',
  'list_project_documents',
  'update_billing_fields',
]);
const TASK_TOOLS = new Set([
  'create_task',
  'update_task',
  'update_task_status',
  'add_task_comment',
]);

/** Pull the first present string value among `keys` from a plain object. */
function pick(obj: any, keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * Derive the target (project/task/resource) of an MCP tool call from its name,
 * its args, and its (already-unwrapped) result. Defensive: tool result shapes
 * vary ({ task }, { project }, { id, ... }, raw entity), so we probe a handful
 * of common key paths and degrade to null rather than ever throw. The `resource`
 * is a coarse noun derived from the tool name so the activity feed can group.
 *
 * `result` is the raw tool return BEFORE `wrap()` (the JS object), or undefined.
 */
export function deriveToolTarget(action: string, args: any, result: any): ToolTarget {
  // Result may nest the entity under a singular key.
  const task = result?.task ?? null;
  const project = result?.project ?? null;
  const comment = result?.comment ?? null;

  // Task id: prefer the created/updated task in the result, then the args.
  const taskId =
    pick(task, ['id']) ??
    pick(comment, ['taskId']) ??
    pick(result, ['taskId']) ??
    pick(args, ['taskId', 'task_id']) ??
    (TASK_TOOLS.has(action) ? pick(result, ['id']) : null);

  // Project id: result.project.id, a top-level result id for project tools,
  // the task's project, then args.
  const projectId =
    pick(project, ['id']) ??
    (PROJECT_TOOLS.has(action) ? pick(result, ['id']) : null) ??
    pick(task?.project, ['id']) ??
    pick(result, ['projectId']) ??
    pick(args, ['projectId', 'project_id']);

  // Coarse resource noun + best-effort id (the entity the tool acted on).
  let resource: string | null = null;
  let resourceId: string | null = null;
  if (TASK_TOOLS.has(action)) {
    resource = action === 'add_task_comment' ? 'comment' : 'task';
    resourceId = action === 'add_task_comment' ? pick(comment, ['id']) : taskId;
  } else if (PROJECT_TOOLS.has(action)) {
    resource = 'project';
    resourceId = projectId;
  } else if (action.startsWith('create_organization') || action.includes('organization')) {
    resource = 'organization';
    resourceId = pick(result?.organization ?? result, ['id']);
  } else if (action.includes('time') || action.includes('timer') || action.includes('timesheet')) {
    resource = 'time';
    resourceId = pick(result?.entry ?? result?.timeEntry ?? result, ['id']);
  }

  return {
    projectId: projectId ?? null,
    taskId: taskId ?? null,
    resource,
    resourceId: resourceId ?? null,
  };
}
