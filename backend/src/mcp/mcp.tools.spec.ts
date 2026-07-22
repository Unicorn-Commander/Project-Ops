/**
 * Targeted RBAC tests for the MCP layer.
 *
 * These cover the load-bearing access-control surfaces:
 *
 *   - buildVisibilityFilter: the Prisma `where` fragment that scopes every
 *     project-related list query to what the calling user is allowed to see.
 *   - assertCanWrite: the role gate at the top of every write tool.
 *
 * Both are pure functions of (user) — no DB, no mocks needed. A regression
 * here would silently widen access; that's the bug class these tests exist
 * to prevent.
 */

import { User, UserRole } from '@prisma/client';
import {
  ProjectOpsTools,
  buildVisibilityFilter,
  normalizeProjectStatus,
} from './mcp.tools';

const baseUser = (overrides: Partial<User>): User =>
  ({
    id: 'user-id',
    email: 'user@example.com',
    username: 'user',
    firstName: 'Test',
    lastName: 'User',
    role: UserRole.STAFF,
    keycloakId: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    password: null,
    forcePasswordChange: false,
    ...overrides,
  }) as User;

describe('buildVisibilityFilter', () => {
  it('returns no scope (sees everything) for ADMIN', () => {
    const filter = buildVisibilityFilter(baseUser({ role: UserRole.ADMIN }));
    expect(filter).toEqual({});
  });

  it('returns no scope (sees everything) for MANAGER', () => {
    const filter = buildVisibilityFilter(baseUser({ role: UserRole.MANAGER }));
    expect(filter).toEqual({});
  });

  it('limits STAFF to projects they own or are assigned to', () => {
    const filter = buildVisibilityFilter(baseUser({ id: 'staff-1', role: UserRole.STAFF }));
    expect(filter).toEqual({
      OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }],
    });
  });

  it('limits CLIENT to projects they are the contact for', () => {
    const filter = buildVisibilityFilter(baseUser({ id: 'client-1', role: UserRole.CLIENT }));
    expect(filter).toEqual({
      OR: [{ contactId: 'client-1' }, { contact: { userId: 'client-1' } }],
    });
  });

  it('does NOT leak STAFF visibility shape to CLIENT — filter shapes differ', () => {
    // Cheap regression check: if someone collapses both branches by accident,
    // both roles would suddenly see by-assignee projects, which would be
    // a privilege escalation for CLIENT users.
    const staffFilter = buildVisibilityFilter(baseUser({ id: 'u1', role: UserRole.STAFF }));
    const clientFilter = buildVisibilityFilter(baseUser({ id: 'u1', role: UserRole.CLIENT }));
    expect(staffFilter).not.toEqual(clientFilter);
  });
});

describe('normalizeProjectStatus — forgiving status filter', () => {
  it('returns undefined for empty / missing input (no filter)', () => {
    expect(normalizeProjectStatus(undefined)).toBeUndefined();
    expect(normalizeProjectStatus('')).toBeUndefined();
    expect(normalizeProjectStatus('   ')).toBeUndefined();
  });

  it('case-normalizes valid values so lowercase / mixed-case just work', () => {
    expect(normalizeProjectStatus('new')).toBe('NEW');
    expect(normalizeProjectStatus('in_progress')).toBe('IN_PROGRESS');
    expect(normalizeProjectStatus('  Completed ')).toBe('COMPLETED');
  });

  it('throws a self-correcting error listing valid values for unknown input', () => {
    // This is the exact failure the live agent loop hit: it passed "active",
    // which is not a ProjectStatus, and Prisma surfaced an opaque 500. Now the
    // tool rejects early with the valid set so the agent can retry.
    expect(() => normalizeProjectStatus('active')).toThrow(
      /Invalid status "active"\. Valid values: NEW, IN_PROGRESS, UNDER_REVIEW, COMPLETED, ARCHIVED\./,
    );
  });
});

describe('ProjectOpsTools.getProject — project-number-in-id forgiveness', () => {
  const WS_ID = 'ws-1';

  function makeTools(findFirst: jest.Mock) {
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn({ project: { findFirst } }, WS_ID),
    } as any;
    return new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
  }

  it('matches the given key against EITHER id or projectNumber, ANDed with visibility', async () => {
    const findFirst = jest.fn(async () => ({ id: 'p1', projectNumber: 'P-00110' }));
    const tools = makeTools(findFirst);

    // Agent put the human project number in the `id` field — should still resolve.
    await tools.getProject(baseUser({ role: UserRole.STAFF, id: 'staff-1' }), {
      id: 'P-00110',
    });

    const where = (findFirst.mock.calls[0] as any[])[0].where;
    // visibility OR is preserved (not clobbered) and the key matches either column.
    expect(where.AND).toEqual([
      { OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }] },
      { OR: [{ id: 'P-00110' }, { projectNumber: 'P-00110' }] },
    ]);
  });

  it('still requires id or projectNumber', async () => {
    const findFirst = jest.fn();
    const tools = makeTools(findFirst);
    await expect(
      tools.getProject(baseUser({ role: UserRole.STAFF }), {}),
    ).rejects.toThrow(/Either id or projectNumber/);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('ProjectOpsTools.assertCanWrite', () => {
  // We don't exercise any DB-touching code, just the gate, so a stub
  // PrismaService / MinioService is enough.
  const tools = new ProjectOpsTools({} as any, {} as any, { log: () => {}, warn: () => {} });

  it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])('allows %s to write', (role) => {
    expect(() => tools.assertCanWrite(baseUser({ role }))).not.toThrow();
  });

  it('rejects CLIENT writes', () => {
    expect(() => tools.assertCanWrite(baseUser({ role: UserRole.CLIENT }))).toThrow(
      /Read-only role/,
    );
  });
});

describe('ProjectOpsTools — Wave 2 role gates', () => {
  // Each Wave 2 service is a jest stub; we assert the role GATE fires (or
  // doesn't) and, when it passes, that the tool delegates to the right service
  // with the resolved workspace. The workspace stub mirrors the addTaskComment
  // spec: resolveAuthorized hands back the active workspace.
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    reporting?: any;
    capacity?: any;
    automations?: any;
    customFields?: any;
    approvals?: any;
  }) {
    const reporting = overrides?.reporting ?? {
      getPortfolio: jest.fn(async () => ({ ok: 'portfolio' })),
      getProfitability: jest.fn(async () => ({ ok: 'profitability' })),
      getThroughput: jest.fn(async () => ({ ok: 'throughput' })),
    };
    const capacity = overrides?.capacity ?? {
      getTeamCapacity: jest.fn(async () => ({ ok: 'team' })),
      getMyCapacity: jest.fn(async () => ({ ok: 'me' })),
    };
    const automations = overrides?.automations ?? {
      findAll: jest.fn(async () => [{ id: 'r1' }]),
      create: jest.fn(async () => ({ id: 'r1' })),
      update: jest.fn(async () => ({ id: 'r1', enabled: false })),
      remove: jest.fn(async () => ({ message: 'deleted' })),
    };
    const customFields = overrides?.customFields ?? {
      findAllForEntity: jest.fn(async () => [{ id: 'cf1', key: 'k' }]),
      validateValues: jest.fn(async () => ({ k: 'v' })),
    };
    const approvals = overrides?.approvals ?? {
      listForProject: jest.fn(async () => ({ data: [], total: 0 })),
      request: jest.fn(async () => ({ id: 'a1' })),
    };
    const workspace = {
      resolveAuthorized: jest.fn(async () => WS_ID),
    } as any;
    const wave2 = { reporting, capacity, automations, customFields, approvals };
    const tools = new ProjectOpsTools(
      {} as any, // prisma
      {} as any, // minio
      { log: () => {}, warn: () => {} },
      undefined, // triage
      undefined, // tt
      null, // bearerToken
      workspace,
      undefined, // events
      wave2 as any,
    );
    return { tools, reporting, capacity, automations, customFields, approvals };
  }

  const admin = baseUser({ role: UserRole.ADMIN });
  const manager = baseUser({ role: UserRole.MANAGER });
  const staff = baseUser({ role: UserRole.STAFF });
  const client = baseUser({ role: UserRole.CLIENT });

  it('get_profitability_report is MANAGER/ADMIN only', async () => {
    const { tools, reporting } = makeTools();
    await expect(tools.getProfitabilityReport(staff, {})).rejects.toThrow(/ADMIN or MANAGER/);
    await expect(tools.getProfitabilityReport(client, {})).rejects.toThrow(/ADMIN or MANAGER/);
    expect(reporting.getProfitability).not.toHaveBeenCalled();

    await tools.getProfitabilityReport(manager, { from: 'f', to: 't' });
    expect(reporting.getProfitability).toHaveBeenCalledWith(WS_ID, manager, { from: 'f', to: 't' });
  });

  it('get_portfolio_report + get_throughput_report are readable by any member', async () => {
    const { tools, reporting } = makeTools();
    await tools.getPortfolioReport(staff, {} as any);
    await tools.getThroughputReport(client, {});
    expect(reporting.getPortfolio).toHaveBeenCalledWith(WS_ID, staff);
    expect(reporting.getThroughput).toHaveBeenCalledWith(WS_ID, client, {
      from: undefined,
      to: undefined,
    });
  });

  it('get_team_capacity is MANAGER/ADMIN only; get_my_capacity is any member', async () => {
    const { tools, capacity } = makeTools();
    await expect(tools.getTeamCapacity(staff, {})).rejects.toThrow(/ADMIN or MANAGER/);
    expect(capacity.getTeamCapacity).not.toHaveBeenCalled();

    await tools.getTeamCapacity(admin, { from: 'f', to: 't' });
    expect(capacity.getTeamCapacity).toHaveBeenCalledWith(WS_ID, admin, 'f', 't');

    await tools.getMyCapacity(staff, {});
    expect(capacity.getMyCapacity).toHaveBeenCalledWith(WS_ID, staff, undefined, undefined);
  });

  it('automation write tools (create/set-enabled/delete) are MANAGER/ADMIN only', async () => {
    const { tools, automations } = makeTools();
    await expect(
      tools.createAutomation(staff, {
        name: 'r',
        trigger: 'TASK_CREATED',
        actions: [{ type: 'notify', params: { userId: 'u' } }],
      }),
    ).rejects.toThrow(/ADMIN or MANAGER/);
    await expect(tools.setAutomationEnabled(staff, { id: 'r1', enabled: false })).rejects.toThrow(
      /ADMIN or MANAGER/,
    );
    await expect(tools.deleteAutomation(client, { id: 'r1' })).rejects.toThrow(/ADMIN or MANAGER/);
    expect(automations.create).not.toHaveBeenCalled();
    expect(automations.update).not.toHaveBeenCalled();
    expect(automations.remove).not.toHaveBeenCalled();
  });

  it('create_automation rejects an unknown trigger and an empty actions array', async () => {
    const { tools, automations } = makeTools();
    await expect(
      tools.createAutomation(admin, {
        name: 'r',
        trigger: 'NOT_A_TRIGGER',
        actions: [{ type: 'notify', params: {} }],
      }),
    ).rejects.toThrow(/Invalid trigger/);
    await expect(
      tools.createAutomation(admin, { name: 'r', trigger: 'TASK_CREATED', actions: [] }),
    ).rejects.toThrow(/actions is required/);
    expect(automations.create).not.toHaveBeenCalled();
  });

  it('create_automation forwards the rule shape to AutomationsService.create', async () => {
    const { tools, automations } = makeTools();
    await tools.createAutomation(manager, {
      name: 'auto',
      trigger: 'TASK_CREATED',
      conditions: [{ field: 'priority', op: 'eq', value: 'URGENT' }],
      actions: [{ type: 'notify', params: { userId: 'u' } }],
      enabled: true,
    });
    expect(automations.create).toHaveBeenCalledWith(
      WS_ID,
      manager,
      expect.objectContaining({
        name: 'auto',
        trigger: 'TASK_CREATED',
        enabled: true,
        conditions: [{ field: 'priority', op: 'eq', value: 'URGENT' }],
        actions: [{ type: 'notify', params: { userId: 'u' } }],
      }),
    );
  });

  it('list_custom_fields rejects an invalid entity and forwards a valid one', async () => {
    const { tools, customFields } = makeTools();
    await expect(tools.listCustomFields(staff, { entity: 'NOPE' })).rejects.toThrow(
      /Invalid entity/,
    );
    await tools.listCustomFields(staff, { entity: 'TASK' });
    expect(customFields.findAllForEntity).toHaveBeenCalledWith(WS_ID, staff, 'TASK');
  });

  it('approval tools are staff-gated (CLIENT cannot)', async () => {
    const { tools, approvals } = makeTools();
    await expect(tools.listProjectApprovals(client, { projectId: 'p1' })).rejects.toThrow(
      /Read-only role/,
    );
    await expect(
      tools.requestApproval(client, { entityType: 'DOCUMENT', entityId: 'd1' }),
    ).rejects.toThrow(/Read-only role/);
    expect(approvals.listForProject).not.toHaveBeenCalled();
    expect(approvals.request).not.toHaveBeenCalled();

    await tools.listProjectApprovals(staff, { projectId: 'p1' });
    expect(approvals.listForProject).toHaveBeenCalledWith(WS_ID, staff, 'p1');
  });

  it('request_approval rejects an invalid entityType and forwards a valid request', async () => {
    const { tools, approvals } = makeTools();
    await expect(
      tools.requestApproval(staff, { entityType: 'NOPE', entityId: 'd1' }),
    ).rejects.toThrow(/Invalid entityType/);
    await tools.requestApproval(staff, {
      entityType: 'DOCUMENT',
      entityId: 'd1',
      projectId: 'p1',
      note: 'please review',
    });
    expect(approvals.request).toHaveBeenCalledWith(
      WS_ID,
      staff,
      expect.objectContaining({
        entityType: 'DOCUMENT',
        entityId: 'd1',
        projectId: 'p1',
        note: 'please review',
      }),
    );
  });
});

describe('ProjectOpsTools — custom-field VALUE pass-through on create_task', () => {
  // Pins that create_task validates customFields against the workspace TASK
  // definitions ON THE SAME tx and folds the result into metadata.customFields,
  // mirroring TasksService.resolveMetadataWithCustomFields. recurrenceRule +
  // estimatedHours pass straight through as columns.
  const WS_ID = 'ws-1';

  it('validates customFields on the tx and stores them under metadata.customFields', async () => {
    const validateValues = jest.fn(async () => ({ priority_score: 8 }));
    const taskCreate = jest.fn(async (arg: any) => ({ id: 't1', ...arg.data }));
    const tx = {
      project: { findFirst: async () => ({ id: 'p1', projectNumber: 'P-00001' }) },
      task: { create: taskCreate },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) => fn(tx, WS_ID),
    } as any;
    const wave2 = { customFields: { validateValues } } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
      undefined,
      wave2,
    );

    await tools.createTask(baseUser({ role: UserRole.STAFF }), {
      projectId: 'p1',
      title: 'T',
      customFields: { priority_score: 8 },
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
      estimatedHours: 4.5,
    });

    // validateValues called with (tx, workspaceId, 'TASK', incoming).
    expect(validateValues).toHaveBeenCalledWith(tx, WS_ID, 'TASK', { priority_score: 8 });
    const data = taskCreate.mock.calls[0][0].data;
    expect(data.metadata).toEqual({ customFields: { priority_score: 8 } });
    expect(data.recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=1');
    expect(data.estimatedHours).toBe(4.5);
  });

  it('does NOT touch metadata/validator when customFields is omitted', async () => {
    const validateValues = jest.fn();
    const taskCreate = jest.fn(async (arg: any) => ({ id: 't1', ...arg.data }));
    const tx = {
      project: { findFirst: async () => ({ id: 'p1', projectNumber: 'P-00001' }) },
      task: { create: taskCreate },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) => fn(tx, WS_ID),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
      undefined,
      { customFields: { validateValues } } as any,
    );

    await tools.createTask(baseUser({ role: UserRole.STAFF }), { projectId: 'p1', title: 'T' });
    expect(validateValues).not.toHaveBeenCalled();
    expect(taskCreate.mock.calls[0][0].data.metadata).toBeUndefined();
  });
});

describe('ProjectOpsTools.addTaskComment — domain event', () => {
  // Minimal WorkspaceContextService stub: resolveAuthorized hands back the
  // active workspace, runForUser runs the callback against a fake tx (no DB).
  // This pins the MCP path's `task.comment.created` emit so MCP-posted task
  // comments fan out @mentions identically to the REST TasksService.addComment.
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    taskFindFirst?: () => Promise<any>;
    taskCommentCreate?: () => Promise<any>;
  }) {
    const emit = jest.fn();
    const events = { emit } as any;
    const tx = {
      task: {
        findFirst: overrides?.taskFindFirst ?? (async () => ({ id: 'task1', projectId: 'p1' })),
      },
      taskComment: {
        create:
          overrides?.taskCommentCreate ??
          (async () => ({
            id: 'comment1',
            content: 'hey @bob',
            createdAt: new Date(),
            author: { firstName: 'A', lastName: 'B' },
          })),
      },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_user: User, fn: (t: any) => Promise<any>) => fn(tx),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any, // prisma (unused — runForUser stub supplies tx)
      {} as any, // minio
      { log: () => {}, warn: () => {} },
      undefined, // triage
      undefined, // tt
      null, // bearerToken
      workspace,
      events,
    );
    return { tools, emit };
  }

  const user = baseUser({ id: 'u1', role: UserRole.STAFF });

  it('emits task.comment.created with the expected payload after commit', async () => {
    const { tools, emit } = makeTools();

    await tools.addTaskComment(user, { taskId: 'task1', content: 'hey @bob' });

    // Byte-for-byte the same event + payload shape TasksService.addComment emits.
    expect(emit).toHaveBeenCalledWith('task.comment.created', {
      workspaceId: WS_ID,
      taskId: 'task1',
      commentId: 'comment1',
      authorId: 'u1',
      content: 'hey @bob',
    });
  });

  it('does NOT emit if the task is missing (create never runs)', async () => {
    const { tools, emit } = makeTools({ taskFindFirst: async () => null });

    await expect(tools.addTaskComment(user, { taskId: 'missing', content: 'x' })).rejects.toThrow(
      /Task not found/,
    );
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('ProjectOpsTools — agent-surface gap tools', () => {
  // Tools added to close the gaps the agent-readiness eval exposed:
  // create_custom_field, issue_invoice, archive_project, and the member tools.
  // We assert each tool's OWN gate + validation + delegation; the deeper RBAC
  // (CustomFieldsService conflict handling, the billable rollup, the
  // WorkspacesService OWNER/last-owner rules) is the delegated service's
  // contract and is covered by those services' own tests.
  const WS = 'ws-gap';

  function makeGapTools() {
    const workspace = { resolveAuthorized: jest.fn(async () => WS) } as any;
    const customFields = { create: jest.fn(async () => ({ id: 'cf-new', key: 'risk_level' })) };
    const rollup = { createBillableDraft: jest.fn(async () => ({ status: 'SENT', invoiceId: 'inv-1' })) };
    const tt = { timer: {}, timeEntry: {}, timesheet: {}, reports: {}, rollup, workspace } as any;
    const workspaceAdmin = {
      listMembers: jest.fn(async () => ({ members: [{ userKey: 'u-1' }] })),
      addMember: jest.fn(async () => ({ status: 'invited', inviteUrl: 'https://x/invite' })),
      updateMemberRole: jest.fn(async () => ({ userKey: 'u-1', role: 'MANAGER' })),
      removeMember: jest.fn(async () => ({ removed: true })),
    };
    const wave2 = { reporting: {}, capacity: {}, automations: {}, customFields, approvals: {} };
    const tools = new ProjectOpsTools(
      {} as any, // prisma
      {} as any, // minio
      { log: () => {}, warn: () => {} },
      undefined, // triage
      tt, // tt (issue_invoice → createBillableDraft)
      null, // bearerToken
      workspace,
      undefined, // events
      wave2 as any,
      workspaceAdmin as any,
    );
    return { tools, customFields, rollup, workspaceAdmin };
  }

  const admin = baseUser({ role: UserRole.ADMIN });
  const staff = baseUser({ role: UserRole.STAFF });
  const client = baseUser({ role: UserRole.CLIENT });

  it('create_custom_field rejects CLIENT and validates entity + type', async () => {
    const { tools, customFields } = makeGapTools();
    await expect(
      tools.createCustomField(client, { entity: 'TASK', label: 'L', type: 'TEXT' }),
    ).rejects.toThrow(/Read-only role/);
    await expect(
      tools.createCustomField(staff, { entity: 'NOPE', label: 'L', type: 'TEXT' }),
    ).rejects.toThrow(/Invalid entity/);
    await expect(
      tools.createCustomField(staff, { entity: 'PROJECT', label: 'L', type: 'NOPE' }),
    ).rejects.toThrow(/Invalid type/);
    expect(customFields.create).not.toHaveBeenCalled();
  });

  it('create_custom_field forwards a valid definition to CustomFieldsService.create', async () => {
    const { tools, customFields } = makeGapTools();
    await tools.createCustomField(staff, {
      entity: 'PROJECT',
      label: 'Risk Level',
      type: 'SELECT',
      options: ['low', 'high'],
    });
    expect(customFields.create).toHaveBeenCalledWith(
      WS,
      staff,
      expect.objectContaining({ entity: 'PROJECT', label: 'Risk Level', type: 'SELECT', options: ['low', 'high'] }),
    );
  });

  it('issue_invoice delegates to createBillableDraft with autoSend=true', async () => {
    const { tools, rollup } = makeGapTools();
    await tools.issueInvoice(admin, { projectId: 'p-1', groupBy: 'TASK' });
    expect(rollup.createBillableDraft).toHaveBeenCalledTimes(1);
    // (workspaceId, user, args, ctx) — args must carry autoSend:true.
    const billArgs = rollup.createBillableDraft.mock.calls[0] as any[];
    expect(billArgs[2]).toEqual(
      expect.objectContaining({ projectId: 'p-1', groupBy: 'TASK', autoSend: true }),
    );
  });

  it('archive_project rejects CLIENT and requires an identifier (gate fires pre-DB)', async () => {
    const { tools } = makeGapTools();
    await expect(tools.archiveProject(client, { projectNumber: 'P-1' })).rejects.toThrow(
      /Read-only role/,
    );
    await expect(tools.archiveProject(staff, {})).rejects.toThrow(/Either id or projectNumber/);
  });

  it('list_members delegates to WorkspacesService with the active workspace', async () => {
    const { tools, workspaceAdmin } = makeGapTools();
    await tools.listMembers(admin, {} as any);
    expect(workspaceAdmin.listMembers).toHaveBeenCalledWith(admin, WS);
  });

  it('invite_member requires email, validates role, then forwards to addMember', async () => {
    const { tools, workspaceAdmin } = makeGapTools();
    await expect(tools.inviteMember(admin, { email: '' })).rejects.toThrow(/email/);
    await expect(tools.inviteMember(admin, { email: 'a@b.com', role: 'WIZARD' })).rejects.toThrow(
      /Invalid role/,
    );
    expect(workspaceAdmin.addMember).not.toHaveBeenCalled();
    await tools.inviteMember(admin, { email: 'a@b.com', role: 'MANAGER' });
    expect(workspaceAdmin.addMember).toHaveBeenCalledWith(
      admin,
      WS,
      expect.objectContaining({ email: 'a@b.com', role: 'MANAGER' }),
    );
  });

  it('update_member_role requires userKey + valid role, then forwards', async () => {
    const { tools, workspaceAdmin } = makeGapTools();
    await expect(tools.updateMemberRole(admin, { userKey: '', role: 'MANAGER' })).rejects.toThrow(
      /userKey/,
    );
    await expect(tools.updateMemberRole(admin, { userKey: 'u-1', role: 'WIZARD' })).rejects.toThrow(
      /Invalid role/,
    );
    expect(workspaceAdmin.updateMemberRole).not.toHaveBeenCalled();
    await tools.updateMemberRole(admin, { userKey: 'u-1', role: 'OWNER' });
    expect(workspaceAdmin.updateMemberRole).toHaveBeenCalledWith(admin, WS, 'u-1', 'OWNER');
  });

  it('remove_member requires userKey, then forwards', async () => {
    const { tools, workspaceAdmin } = makeGapTools();
    await expect(tools.removeMember(admin, { userKey: '' })).rejects.toThrow(/userKey/);
    await tools.removeMember(admin, { userKey: 'u-1' });
    expect(workspaceAdmin.removeMember).toHaveBeenCalledWith(admin, WS, 'u-1');
  });

  it('member tools fail loudly when WorkspacesService is not wired', async () => {
    const workspace = { resolveAuthorized: jest.fn(async () => WS) } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
      undefined,
      undefined,
      // workspaceAdmin omitted
    );
    await expect(tools.listMembers(admin, {} as any)).rejects.toThrow(
      /Workspace administration is not enabled/,
    );
  });
});

describe('ProjectOpsTools — document update/delete MCP parity', () => {
  // REST already has PATCH/DELETE /documents/:id. These tools mirror that
  // surface for agents: safe metadata update + hard delete, with the same
  // assertCanWrite CLIENT gate and project visibility filter used by
  // get_document_content / upload_document.
  const WS_ID = 'ws-docs';

  function makeDocTools(txOverrides?: {
    findFirst?: (args: any) => Promise<any>;
    update?: (args: any) => Promise<any>;
    delete?: (args: any) => Promise<any>;
    deleteObject?: (key: string) => Promise<void>;
  }) {
    const tx = {
      document: {
        findFirst: jest.fn(
          txOverrides?.findFirst ??
            (async () => ({
              id: 'doc-1',
              fileName: 'brief.pdf',
              s3Key: 'projects/p1/brief.pdf',
              status: 'UPLOADED',
              fileSize: 1024,
              projectId: 'p1',
            })),
        ),
        update: jest.fn(
          txOverrides?.update ??
            (async (a: any) => ({
              id: 'doc-1',
              projectId: 'p1',
              fileName: a.data.fileName ?? 'brief.pdf',
              fileSize: 1024,
              mimeType: 'application/pdf',
              status: 'UPLOADED',
              description: a.data.description === undefined ? 'old' : a.data.description,
              tags: a.data.tags ?? [],
              uploadedAt: new Date(),
              updatedAt: new Date(),
            })),
        ),
        delete: jest.fn(txOverrides?.delete ?? (async () => ({ id: 'doc-1' }))),
      },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_user: User, fn: (t: any) => Promise<any>) => fn(tx),
    } as any;
    const minio = {
      deleteObject: jest.fn(
        txOverrides?.deleteObject ?? (async () => undefined),
      ),
    };
    const tools = new ProjectOpsTools(
      {} as any,
      minio as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
    return { tools, tx, minio };
  }

  const staff = baseUser({ id: 'staff-1', role: UserRole.STAFF });
  const client = baseUser({ id: 'client-1', role: UserRole.CLIENT });
  const admin = baseUser({ id: 'admin-1', role: UserRole.ADMIN });

  it('update_document rejects CLIENT before touching the DB', async () => {
    const { tools, tx } = makeDocTools();
    await expect(
      tools.updateDocument(client, { documentId: 'doc-1', description: 'x' }),
    ).rejects.toThrow(/Read-only role/);
    expect(tx.document.findFirst).not.toHaveBeenCalled();
  });

  it('update_document requires documentId and at least one field', async () => {
    const { tools } = makeDocTools();
    await expect(tools.updateDocument(staff, { documentId: '' } as any)).rejects.toThrow(
      /documentId/,
    );
    await expect(tools.updateDocument(staff, { documentId: 'doc-1' })).rejects.toThrow(
      /at least one of/,
    );
  });

  it('update_document patches description and applies project visibility for STAFF', async () => {
    const { tools, tx } = makeDocTools();
    const out = await tools.updateDocument(staff, {
      documentId: 'doc-1',
      description: 'Signed SOW',
    });
    expect(out.document.description).toBe('Signed SOW');
    expect(tx.document.findFirst).toHaveBeenCalled();
    const where = (tx.document.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where.id).toBe('doc-1');
    // STAFF visibility is OR of assignedToId / createdById on parent project
    expect(where.OR).toEqual(
      expect.arrayContaining([
        {
          project: {
            OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }],
          },
        },
      ]),
    );
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-1' },
        data: { description: 'Signed SOW' },
      }),
    );
  });

  it('update_document clears description on null, replaces tags, renames fileName', async () => {
    const { tools, tx } = makeDocTools();
    await tools.updateDocument(admin, {
      documentId: 'doc-1',
      description: null,
      tags: ['sow', 'v2'],
      fileName: 'sow-final.pdf',
    });
    expect(tx.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          description: null,
          tags: ['sow', 'v2'],
          fileName: 'sow-final.pdf',
        },
      }),
    );
  });

  it('update_document rejects empty fileName and bad tags', async () => {
    const { tools } = makeDocTools();
    await expect(
      tools.updateDocument(staff, { documentId: 'doc-1', fileName: '   ' }),
    ).rejects.toThrow(/fileName/);
    await expect(
      tools.updateDocument(staff, { documentId: 'doc-1', tags: [1 as any] }),
    ).rejects.toThrow(/tags/);
  });

  it('update_document not-found when invisible/missing', async () => {
    const { tools } = makeDocTools({ findFirst: async () => null });
    await expect(
      tools.updateDocument(staff, { documentId: 'gone', description: 'x' }),
    ).rejects.toThrow(/Document not found/);
  });

  it('delete_document rejects CLIENT before touching the DB', async () => {
    const { tools, tx, minio } = makeDocTools();
    await expect(tools.deleteDocument(client, { documentId: 'doc-1' })).rejects.toThrow(
      /Read-only role/,
    );
    expect(tx.document.findFirst).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
  });

  it('delete_document removes MinIO object then DB row for uploaded files', async () => {
    const { tools, tx, minio } = makeDocTools();
    const out = await tools.deleteDocument(staff, { documentId: 'doc-1' });
    expect(out).toEqual({
      deleted: true,
      documentId: 'doc-1',
      fileName: 'brief.pdf',
      projectId: 'p1',
    });
    expect(minio.deleteObject).toHaveBeenCalledWith('projects/p1/brief.pdf');
    expect(tx.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
  });

  it('delete_document skips MinIO when not uploaded / zero size', async () => {
    const { tools, minio, tx } = makeDocTools({
      findFirst: async () => ({
        id: 'doc-pending',
        fileName: 'pending.pdf',
        s3Key: 'projects/p1/pending.pdf',
        status: 'PENDING',
        fileSize: 0,
        projectId: 'p1',
      }),
    });
    await tools.deleteDocument(admin, { documentId: 'doc-pending' });
    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(tx.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-pending' } });
  });

  it('delete_document continues DB delete when MinIO fails', async () => {
    const { tools, tx, minio } = makeDocTools({
      deleteObject: async () => {
        throw new Error('minio down');
      },
    });
    const out = await tools.deleteDocument(staff, { documentId: 'doc-1' });
    expect(out.deleted).toBe(true);
    expect(minio.deleteObject).toHaveBeenCalled();
    expect(tx.document.delete).toHaveBeenCalled();
  });

  it('delete_document not-found when invisible/missing', async () => {
    const { tools, minio } = makeDocTools({ findFirst: async () => null });
    await expect(tools.deleteDocument(staff, { documentId: 'gone' })).rejects.toThrow(
      /Document not found/,
    );
    expect(minio.deleteObject).not.toHaveBeenCalled();
  });
});

describe('document mutate MCP PAT scopes', () => {
  // Fail-closed: unmapped tools refuse PAT calls. Keep write:documents parity
  // with upload_document.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MCP_TOOL_SCOPE_MAP } = require('../auth/pat/pat.constants');

  it('maps update_document and delete_document to write:documents', () => {
    expect(MCP_TOOL_SCOPE_MAP['update_document']).toBe('write:documents');
    expect(MCP_TOOL_SCOPE_MAP['delete_document']).toBe('write:documents');
    expect(MCP_TOOL_SCOPE_MAP['upload_document']).toBe('write:documents');
    expect(MCP_TOOL_SCOPE_MAP['list_project_documents']).toBe('read:documents');
    expect(MCP_TOOL_SCOPE_MAP['get_document_content']).toBe('read:documents');
  });
});
