/**
 * MCP tool RBAC + workspace gating (security-path coverage).
 *
 * McpService.createServerForUser wraps every registered tool with a gate that:
 *   - fails closed on a PAT scope the token wasn't granted (scope_denied),
 *   - fails closed when a workspace-bound PAT's resolved workspace drifts from
 *     its bound workspace (workspace_denied) — a PAT for W1 can never act on W2,
 *   - lets a JWT-auth'd caller (no granted-scope set, no PAT workspace) through
 *     so the per-tool RBAC inside ProjectOpsTools is the only gate,
 *   - fails closed on a tool name with no scope mapping (never fail-open).
 *
 * We stub the MCP SDK's McpServer so `registerTool` records the GATED handler,
 * then invoke those handlers directly to assert the gate's behavior. The tool
 * bodies themselves are stubbed (ProjectOpsTools methods are not exercised) —
 * this test pins the GATE, which the rest of the suite did not cover.
 */

// Replace the SDK server with a fake that records (name -> gated handler).
const registered = new Map<string, (args: any) => Promise<any> | any>();
const registeredSchemas = new Map<string, any>();
jest.mock(
  '@modelcontextprotocol/sdk/server/mcp.js',
  () => ({
    McpServer: class {
      registerTool(name: string, schema: unknown, handler: (args: any) => any) {
        registered.set(name, handler);
        registeredSchemas.set(name, schema);
      }
    },
  }),
  { virtual: true },
);

import { Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { McpService } from './mcp.service';
import { ProjectOpsTools } from './mcp.tools';
import { getMcpMetricsSnapshot, resetMcpMetricsForTests } from './mcp.metrics';

/** Minimal user; the gate only reads identity for workspace resolution. */
const adminUser = () =>
  ({ id: 'u-admin', email: 'admin@example.com', role: UserRole.ADMIN, keycloakId: null }) as any;

/**
 * Build an McpService with stubbed collaborators. ProjectOpsTools is constructed
 * with these stubs but its methods are not invoked by the gate tests (the gate
 * runs BEFORE the tool body); a denied call returns before touching them.
 */
function makeService(resolvedWorkspace: string): McpService {
  const noop = {} as any;
  const workspace = {
    // resolve() is what the workspace-drift gate consults.
    resolve: () => resolvedWorkspace,
    resolveAuthorized: async () => resolvedWorkspace,
    assertCanWrite: async () => undefined,
  } as any;
  const svc = new McpService(
    noop, // prisma
    noop, // minio
    noop, // triage
    workspace, // workspaceContext
    noop, // timer
    noop, // timeEntry
    noop, // timesheet
    noop, // reports
    noop, // rollup
    noop, // events (EventEmitter2) — gate tests deny before the tool body
    noop, // reporting (Wave 2)
    noop, // capacity (Wave 2)
    noop, // automations (Wave 2)
    noop, // customFields (Wave 2)
    noop, // approvals (Wave 2)
    noop, // workspaceAdmin (member mgmt) — gate denies before the tool body
  );
  // Silence the service logger.
  (svc as any).logger = new Logger('test');
  return svc;
}

/** Parse the JSON text payload an MCP tool result wraps. */
function payload(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe('McpService tool gating (RBAC + workspace)', () => {
  beforeEach(() => {
    registered.clear();
    registeredSchemas.clear();
    resetMcpMetricsForTests();
  });

  it('records denied metrics when PAT scope gate refuses a tool', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', null);
    const create = registered.get('create_project')!;
    await create({ title: 't', clientName: 'c' });
    const snap = getMcpMetricsSnapshot();
    const row = snap.tools.find((t) => t.tool === 'create_project');
    expect(row?.denied).toBe(1);
    expect(snap.totals.denied).toBeGreaterThanOrEqual(1);
  });

  it('validates every registered task enum input and keeps lowercase values working', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), null, null, null);
    const schemaFor = (name: string) => z.object(registeredSchemas.get(name).inputSchema);
    const expectInvalid = (name: string, input: Record<string, unknown>, validValue: string) => {
      const invalid = schemaFor(name).safeParse(input);
      expect(invalid.success).toBe(false);
      expect(JSON.stringify(invalid.error)).toContain(validValue);
      expect(JSON.stringify(invalid.error)).not.toMatch(/prisma|invocation/i);
    };

    expectInvalid('create_task', { title: 't', type: 'BUG' }, 'TASK');
    expectInvalid('update_task', { taskId: 'task-1', priority: 'CRITICAL' }, 'URGENT');
    expectInvalid('list_my_tasks', { status: 'ACTIVE' }, 'PENDING');
    expectInvalid('list_project_tasks', { projectId: 'project-1', status: 'ACTIVE' }, 'COMPLETED');
    expectInvalid('update_task_status', { taskId: 'task-1', status: 'ACTIVE' }, 'CANCELLED');

    const create = schemaFor('create_task').safeParse({
      title: 't',
      type: 'review',
      priority: 'high',
    });
    expect(create.success).toBe(true);
    if (!create.success) throw create.error;
    expect(create.data.type).toBe('REVIEW');
    expect(create.data.priority).toBe('HIGH');

    const projectTasks = schemaFor('list_project_tasks').safeParse({
      projectId: 'project-1',
      status: 'in_progress',
      priority: 'urgent',
    });
    expect(projectTasks.success).toBe(true);
    if (!projectTasks.success) throw projectTasks.error;
    expect(projectTasks.data.status).toBe('IN_PROGRESS');
    expect(projectTasks.data.priority).toBe('URGENT');

    const status = schemaFor('update_task_status').safeParse({
      taskId: 'task-1',
      status: 'completed',
    });
    expect(status.success).toBe(true);
    if (!status.success) throw status.error;
    expect(status.data.status).toBe('COMPLETED');
  });

  it('limits new MCP fee inputs to non-negative cents', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), null, null, null);
    const schemaFor = (name: string) => z.object(registeredSchemas.get(name).inputSchema);

    expect(schemaFor('create_task').safeParse({ title: 't', fixedAmount: 12.345 }).success).toBe(
      false,
    );
    expect(schemaFor('update_task').safeParse({ taskId: 't1', fixedAmount: 12.345 }).success).toBe(
      false,
    );
    expect(
      schemaFor('update_billing_fields').safeParse({ id: 'p1', flatFeeAmount: 12.345 }).success,
    ).toBe(false);

    expect(schemaFor('create_task').safeParse({ title: 't', fixedAmount: 12.34 }).success).toBe(
      true,
    );
    expect(schemaFor('update_task').safeParse({ taskId: 't1', fixedAmount: null }).success).toBe(
      true,
    );
    expect(
      schemaFor('update_billing_fields').safeParse({ id: 'p1', flatFeeAmount: null }).success,
    ).toBe(true);
  });

  it('sanitizes Prisma errors at the shared MCP error boundary', async () => {
    const original = ProjectOpsTools.prototype.getProject;
    ProjectOpsTools.prototype.getProject = jest.fn().mockRejectedValue(
      Object.assign(new Error('Invalid `prisma.task.create()` invocation with payload'), {
        name: 'PrismaClientValidationError',
      }),
    ) as any;
    try {
      const svc = makeService('ws-1');
      await svc.createServerForUser(adminUser(), null, null, null);
      const result = await registered.get('get_project')!({ id: 'p1' });
      const text = result.content[0].text;
      expect(result.isError).toBe(true);
      expect(text).toContain('invalid input');
      expect(text).not.toMatch(/prisma|invocation/i);
    } finally {
      ProjectOpsTools.prototype.getProject = original;
    }
  });

  it('returns a one-line safe error for create_task Prisma validation failures', async () => {
    const original = ProjectOpsTools.prototype.createTask;
    ProjectOpsTools.prototype.createTask = jest
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error('Invalid `prisma.task.create()` invocation with workspace and payload'),
          { name: 'PrismaClientValidationError' },
        ),
      ) as any;
    try {
      const svc = makeService('ws-1');
      await svc.createServerForUser(adminUser(), null, null, null);
      const result = await registered.get('create_task')!({
        projectId: 'project-secret',
        title: 'private payload',
        type: 'TASK',
        priority: 'HIGH',
      });
      const text = result.content[0].text;
      expect(result.isError).toBe(true);
      expect(text).toBe('{"error":"invalid input"}');
      expect(text).not.toMatch(/prisma|invocation|project-secret|private payload/i);
    } finally {
      ProjectOpsTools.prototype.createTask = original;
    }
  });

  it('JWT-auth (no granted scopes, no PAT workspace) — tools pass the gate', async () => {
    const svc = makeService('ws-1');
    // grantedScopes=null, patWorkspaceId=null => JWT path.
    await svc.createServerForUser(adminUser(), null, null, null);

    // list_my_projects requires read:projects; with no scope gate it must run.
    // The tool body (tools.listMyProjects) is the real one but we only assert
    // the gate didn't short-circuit — so stub the tool to a sentinel via the
    // recorded handler boundary: invoke and confirm it does NOT return a
    // scope/workspace denial.
    const handler = registered.get('get_recent_activity')!;
    // The real tools.getRecentActivity would hit prisma; to keep this a pure
    // gate test, assert instead that the handler is the pass-through (it does
    // not pre-empt with a denial). We detect a denial by its error shape, so a
    // throw from the stubbed-out tool body is fine — it proves the gate let it
    // through to the body.
    await expect(Promise.resolve(handler({ limit: 1 }))).rejects.toBeDefined();
  });

  it('PAT scope gate — a tool whose required scope is missing returns scope_denied', async () => {
    const svc = makeService('ws-1');
    // Granted only read:projects; create_project requires write:projects.
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', null);

    const create = registered.get('create_project')!;
    const result = await create({ title: 't', clientName: 'c' });
    const body = payload(result);
    expect(result.isError).toBe(true);
    expect(body.error).toBe('scope_denied');
    expect(body.required_scope).toBe('write:projects');
    expect(body.granted_scopes).toEqual(['read:projects']);
  });

  it('PAT scope gate — a granted scope lets the tool through to its body', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', null);

    // get_project requires read:projects (granted) -> the gate passes and the
    // (real, prisma-backed) tool body runs and throws -> proves no denial.
    const get = registered.get('get_project')!;
    await expect(Promise.resolve(get({ id: 'p1' }))).rejects.toBeDefined();
  });

  it('PAT workspace gate — a drift from the bound workspace returns workspace_denied', async () => {
    // PAT bound to ws-1, but the acting user resolves to ws-2 (drift).
    const svc = makeService('ws-2');
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', 'ws-1');

    const get = registered.get('get_project')!;
    const result = await get({ id: 'p1' });
    const body = payload(result);
    expect(result.isError).toBe(true);
    expect(body.error).toBe('workspace_denied');
    expect(body.pat_workspace).toBe('ws-1');
    expect(body.resolved_workspace).toBe('ws-2');
  });

  it('PAT workspace gate — a MATCHING workspace passes the workspace check', async () => {
    // Bound to ws-1 and resolves to ws-1: the workspace gate passes; the scope
    // gate (read:projects granted) also passes; the tool body then runs/throws.
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', 'ws-1');

    const get = registered.get('get_project')!;
    await expect(Promise.resolve(get({ id: 'p1' }))).rejects.toBeDefined();
  });

  it('workspace gate runs BEFORE the scope gate (drift denies even a granted scope)', async () => {
    const svc = makeService('ws-2');
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', 'ws-1');
    const get = registered.get('get_project')!;
    const body = payload(await get({ id: 'p1' }));
    // Drift wins: workspace_denied, not scope_denied (even though read:projects
    // is granted) — the bound-workspace check is the outermost fence.
    expect(body.error).toBe('workspace_denied');
  });

  // Wave 2 tools ride the SAME PAT-scope wrapper. These pin that the new tools
  // are registered AND mapped in MCP_TOOL_SCOPE_MAP (an unmapped tool would
  // fail closed with "(no mapping)"), so PAT scoping works for them.
  it('Wave 2 reporting tool is scope-gated — denied without read:reports', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:projects'], 'tok', null);
    const portfolio = registered.get('get_portfolio_report')!;
    const body = payload(await portfolio({}));
    expect(body.error).toBe('scope_denied');
    expect(body.required_scope).toBe('read:reports');
  });

  it('Wave 2 reporting tool passes the gate when read:reports is granted', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:reports'], 'tok', null);
    const portfolio = registered.get('get_portfolio_report')!;
    // Granted -> gate passes, the (real, service-backed) body runs and throws
    // (no stubbed reporting service wired) -> proves no scope denial.
    await expect(Promise.resolve(portfolio({}))).rejects.toBeDefined();
  });

  it('Wave 2 automation write tool is scope-gated — denied without write:automations', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:automations'], 'tok', null);
    const del = registered.get('delete_automation')!;
    const body = payload(await del({ id: 'r1' }));
    expect(body.error).toBe('scope_denied');
    expect(body.required_scope).toBe('write:automations');
  });

  it('delete_time_entry is scope-gated — denied without write:time', async () => {
    const svc = makeService('ws-1');
    await svc.createServerForUser(adminUser(), ['read:time'], 'tok', null);
    const del = registered.get('delete_time_entry')!;
    expect(del).toBeDefined();
    const body = payload(await del({ id: 'e1' }));
    expect(body.error).toBe('scope_denied');
    expect(body.required_scope).toBe('write:time');
  });
});
