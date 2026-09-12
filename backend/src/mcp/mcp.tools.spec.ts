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

import { ForbiddenException } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import {
  ProjectOpsTools,
  buildVisibilityFilter,
  normalizeProjectStatus,
  normalizeTaskPriority,
  normalizeTaskStatus,
  withProjectQuote,
  CLIENT_MASKED_PROJECT_FIELDS,
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

  it('submit_candidate_action_items resolves workspace via resolveAuthorized (not env default)', async () => {
    // Partner-user parity: claimless callers must land on DEFAULT MEMBERSHIP,
    // never DEFAULT_WORKSPACE_ID. Pins the membership-aware chokepoint.
    const resolveAuthorized = jest.fn(async () => 'ws-partner-default');
    const ingestCandidates = jest.fn(async () => ({ created: 1, skipped: 0, proposals: [] }));
    const triage = { ingestCandidates } as any;
    const workspace = { resolveAuthorized } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      triage,
      undefined,
      null,
      workspace,
    );
    const staffUser = baseUser({ role: UserRole.STAFF });
    await tools.submitCandidateActionItems(staffUser, {
      items: [{ text: 'Ship MCP parity docs' }],
      sourceType: 'MANUAL',
    });
    // Second arg = the request-addressed (X-Workspace-Id) workspace; null here
    // because none was threaded in — claim/default-membership resolution.
    expect(resolveAuthorized).toHaveBeenCalledWith(staffUser, null);
    expect(ingestCandidates).toHaveBeenCalledWith(
      'ws-partner-default',
      staffUser,
      expect.arrayContaining([expect.objectContaining({ text: 'Ship MCP parity docs' })]),
    );
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

describe('normalizeTaskStatus / normalizeTaskPriority — forgiving filters', () => {
  it('returns undefined for empty / missing input (no filter)', () => {
    expect(normalizeTaskStatus(undefined)).toBeUndefined();
    expect(normalizeTaskStatus('')).toBeUndefined();
    expect(normalizeTaskPriority(undefined)).toBeUndefined();
    expect(normalizeTaskPriority('   ')).toBeUndefined();
  });

  it('case-normalizes valid TaskStatus values', () => {
    expect(normalizeTaskStatus('pending')).toBe('PENDING');
    expect(normalizeTaskStatus('in_progress')).toBe('IN_PROGRESS');
    expect(normalizeTaskStatus('  Completed ')).toBe('COMPLETED');
  });

  it('case-normalizes valid TaskPriority values', () => {
    expect(normalizeTaskPriority('high')).toBe('HIGH');
    expect(normalizeTaskPriority('URGENT')).toBe('URGENT');
  });

  it('throws self-correcting errors for unknown status/priority', () => {
    expect(() => normalizeTaskStatus('active')).toThrow(
      /Invalid task status "active"\. Valid values: PENDING, IN_PROGRESS, WAITING_FOR_CLIENT, COMPLETED, CANCELLED\./,
    );
    expect(() => normalizeTaskPriority('critical')).toThrow(
      /Invalid task priority "critical"\. Valid values: LOW, MEDIUM, HIGH, URGENT\./,
    );
  });
});

describe('ProjectOpsTools.getTask — full detail + visibility', () => {
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    taskFindFirst?: jest.Mock;
    depFindMany?: jest.Mock;
  }) {
    const taskFindFirst =
      overrides?.taskFindFirst ??
      jest.fn(async () => ({
        id: 't1',
        title: 'Ship MCP',
        description: 'full body',
        type: 'TASK',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        dueDate: null,
        completedAt: null,
        parentTaskId: null,
        recurrenceRule: null,
        estimatedHours: 4,
        metadata: { customFields: { score: 1 } },
        billable: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        project: {
          id: 'p1',
          projectNumber: 'P-00110',
          title: 'Project Ops',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
        },
        createdBy: {
          id: 'u1',
          email: 'a@x.com',
          firstName: 'A',
          lastName: 'B',
          role: UserRole.STAFF,
        },
        assignedTo: {
          id: 'u2',
          email: 'b@x.com',
          firstName: 'B',
          lastName: 'C',
          role: UserRole.STAFF,
        },
        parentTask: null,
        _count: { comments: 3, subtasks: 1 },
      }));
    const depFindMany =
      overrides?.depFindMany ??
      jest
        .fn()
        // first call: dependsOn; second: blocks
        .mockResolvedValueOnce([
          {
            id: 'd1',
            type: 'FINISH_TO_START',
            createdAt: new Date(),
            predecessor: {
              id: 'pred1',
              title: 'Predecessor',
              status: 'PENDING',
              priority: 'MEDIUM',
              projectId: 'p1',
            },
          },
        ])
        .mockResolvedValueOnce([]);
    const tx = {
      task: { findFirst: taskFindFirst },
      taskDependency: { findMany: depFindMany },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn(tx, WS_ID),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
    return { tools, taskFindFirst, depFindMany };
  }

  it('requires taskId', async () => {
    const { tools, taskFindFirst } = makeTools();
    await expect(tools.getTask(baseUser({ role: UserRole.STAFF }), { taskId: '' })).rejects.toThrow(
      /taskId is required/,
    );
    expect(taskFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the lookup by visibility filter on the parent project', async () => {
    const { tools, taskFindFirst } = makeTools();
    const user = baseUser({ id: 'staff-1', role: UserRole.STAFF });
    const result = await tools.getTask(user, { taskId: 't1' });

    const where = (taskFindFirst.mock.calls[0] as any[])[0].where;
    expect(where.id).toBe('t1');
    expect(where.project).toEqual({
      OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }],
    });
    // Flattened counters + dependency graph for agents.
    expect(result.commentsCount).toBe(3);
    expect(result.subtasksCount).toBe(1);
    expect(result.dependencies.dependsOn).toHaveLength(1);
    expect(result.dependencies.blocks).toEqual([]);
    expect(result.description).toBe('full body');
    expect(result.project.projectNumber).toBe('P-00110');
    expect(result.assignedTo?.id).toBe('u2');
    // Raw Prisma _count bag is not leaked.
    expect((result as any)._count).toBeUndefined();
  });

  it('throws when the task is missing or not visible', async () => {
    const { tools } = makeTools({
      taskFindFirst: jest.fn(async () => null),
      depFindMany: jest.fn(),
    });
    await expect(
      tools.getTask(baseUser({ role: UserRole.STAFF }), { taskId: 'missing' }),
    ).rejects.toThrow(/Task not found or you don't have access/);
  });
});

describe('ProjectOpsTools.listProjectTasks — filters + pagination window', () => {
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    projectFindFirst?: jest.Mock;
    taskFindMany?: jest.Mock;
    taskCount?: jest.Mock;
  }) {
    const projectFindFirst =
      overrides?.projectFindFirst ??
      jest.fn(async () => ({
        id: 'p1',
        projectNumber: 'P-00110',
        title: 'Project Ops',
        status: 'IN_PROGRESS',
      }));
    const taskFindMany =
      overrides?.taskFindMany ??
      jest.fn(async () => [
        {
          id: 't1',
          title: 'A',
          description: null,
          type: 'TASK',
          status: 'PENDING',
          priority: 'HIGH',
          dueDate: null,
          completedAt: null,
          estimatedHours: null,
          parentTaskId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          assignedTo: null,
          createdBy: { id: 'u1', firstName: 'A', lastName: 'B', email: 'a@x.com' },
          _count: { comments: 0, subtasks: 0 },
        },
      ]);
    const taskCount = overrides?.taskCount ?? jest.fn(async () => 42);
    const tx = {
      project: { findFirst: projectFindFirst },
      task: { findMany: taskFindMany, count: taskCount },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn(tx, WS_ID),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
    return { tools, projectFindFirst, taskFindMany, taskCount };
  }

  it('requires projectId or projectNumber', async () => {
    const { tools, projectFindFirst } = makeTools();
    await expect(
      tools.listProjectTasks(baseUser({ role: UserRole.STAFF }), {}),
    ).rejects.toThrow(/Either projectId or projectNumber/);
    expect(projectFindFirst).not.toHaveBeenCalled();
  });

  it('matches project key against EITHER id or projectNumber (dual-key)', async () => {
    const { tools, projectFindFirst, taskFindMany, taskCount } = makeTools();
    const user = baseUser({ id: 'staff-1', role: UserRole.STAFF });

    const result = await tools.listProjectTasks(user, {
      projectNumber: 'P-00110',
      status: 'pending',
      priority: 'high',
      limit: 10,
      offset: 5,
    });

    const projWhere = (projectFindFirst.mock.calls[0] as any[])[0].where;
    expect(projWhere.AND).toEqual([
      { OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }] },
      { OR: [{ id: 'P-00110' }, { projectNumber: 'P-00110' }] },
    ]);

    const taskArgs = (taskFindMany.mock.calls[0] as any[])[0];
    expect(taskArgs.where).toEqual({
      projectId: 'p1',
      status: 'PENDING',
      priority: 'HIGH',
    });
    expect(taskArgs.skip).toBe(5);
    expect(taskArgs.take).toBe(10);
    expect(taskArgs.orderBy).toEqual([
      { priority: 'desc' },
      { dueDate: 'asc' },
      { createdAt: 'desc' },
    ]);
    expect(taskCount).toHaveBeenCalledWith({ where: taskArgs.where });

    // Explicit window echoed in the response for agents.
    expect(result).toMatchObject({
      project: { id: 'p1', projectNumber: 'P-00110' },
      count: 1,
      total: 42,
      offset: 5,
      limit: 10,
    });
    expect(result.tasks[0].commentsCount).toBe(0);
    expect((result.tasks[0] as any)._count).toBeUndefined();
  });

  it('defaults limit=25 offset=0 and caps limit at 100', async () => {
    const { tools, taskFindMany } = makeTools();
    await tools.listProjectTasks(baseUser({ role: UserRole.ADMIN }), {
      projectId: 'p1',
      limit: 999,
      offset: -3,
    });
    const taskArgs = (taskFindMany.mock.calls[0] as any[])[0];
    expect(taskArgs.take).toBe(100);
    expect(taskArgs.skip).toBe(0);
  });

  it('rejects unknown status before hitting the DB', async () => {
    const { tools, projectFindFirst } = makeTools();
    await expect(
      tools.listProjectTasks(baseUser({ role: UserRole.STAFF }), {
        projectId: 'p1',
        status: 'active',
      }),
    ).rejects.toThrow(/Invalid task status "active"/);
    expect(projectFindFirst).not.toHaveBeenCalled();
  });

  it('throws when the project is missing or not visible', async () => {
    const { tools } = makeTools({
      projectFindFirst: jest.fn(async () => null),
    });
    await expect(
      tools.listProjectTasks(baseUser({ role: UserRole.STAFF }), {
        projectId: 'missing',
      }),
    ).rejects.toThrow(/Project not found or you don't have access/);
  });
});

describe('ProjectOpsTools.createTask — parentTaskId subtask validation', () => {
  // Mirrors TasksService.createInTx: parent must resolve under the workspace
  // tx (cross-workspace → not found) and must share the same project.
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    parent?: { id: string; projectId: string } | null;
    projectId?: string;
  }) {
    const taskCreate = jest.fn(async (arg: any) => ({
      id: 'child-1',
      parentTaskId: arg.data.parentTaskId ?? null,
      ...arg.data,
      project: { projectNumber: 'P-00001', title: 'Proj' },
    }));
    const taskFindUnique = jest.fn(async () =>
      overrides && 'parent' in overrides ? overrides.parent : { id: 'parent-1', projectId: 'p1' },
    );
    const tx = {
      project: {
        findFirst: async () => ({
          id: overrides?.projectId ?? 'p1',
          projectNumber: 'P-00001',
        }),
      },
      task: { create: taskCreate, findUnique: taskFindUnique },
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
    );
    return { tools, taskCreate, taskFindUnique };
  }

  it('rejects a missing parent task', async () => {
    const { tools, taskCreate, taskFindUnique } = makeTools({ parent: null });
    await expect(
      tools.createTask(baseUser({ role: UserRole.STAFF }), {
        projectId: 'p1',
        title: 'Child',
        parentTaskId: 'missing',
      }),
    ).rejects.toThrow(/Parent task with ID missing not found/);
    expect(taskFindUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
      select: { id: true, projectId: true },
    });
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('rejects a parent in a different project', async () => {
    const { tools, taskCreate } = makeTools({
      parent: { id: 'parent-1', projectId: 'OTHER' },
    });
    await expect(
      tools.createTask(baseUser({ role: UserRole.STAFF }), {
        projectId: 'p1',
        title: 'Child',
        parentTaskId: 'parent-1',
      }),
    ).rejects.toThrow(/Parent task must belong to the same project as the subtask/);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('accepts a same-project parent and persists parentTaskId', async () => {
    const { tools, taskCreate } = makeTools({
      parent: { id: 'parent-1', projectId: 'p1' },
    });
    const result = await tools.createTask(baseUser({ role: UserRole.STAFF }), {
      projectId: 'p1',
      title: 'Child',
      parentTaskId: 'parent-1',
    });
    expect(taskCreate).toHaveBeenCalled();
    const data = taskCreate.mock.calls[0][0].data;
    expect(data.parentTaskId).toBe('parent-1');
    expect(data.projectId).toBe('p1');
    expect(result.parentTaskId).toBe('parent-1');
  });

  it('omits parentTaskId when not provided', async () => {
    const { tools, taskCreate, taskFindUnique } = makeTools();
    await tools.createTask(baseUser({ role: UserRole.STAFF }), {
      projectId: 'p1',
      title: 'Root',
    });
    expect(taskFindUnique).not.toHaveBeenCalled();
    expect(taskCreate.mock.calls[0][0].data.parentTaskId).toBeUndefined();
  });
});

describe('ProjectOpsTools.listTaskSubtasks', () => {
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    parentFindFirst?: jest.Mock;
    taskFindMany?: jest.Mock;
  }) {
    const parentFindFirst =
      overrides?.parentFindFirst ??
      jest.fn(async () => ({
        id: 'parent-1',
        title: 'Parent',
        status: 'IN_PROGRESS',
        project: { id: 'p1', projectNumber: 'P-00001', title: 'Proj' },
      }));
    const taskFindMany =
      overrides?.taskFindMany ??
      jest.fn(async () => [
        {
          id: 'child-1',
          title: 'Sub A',
          description: null,
          type: 'OTHER',
          status: 'PENDING',
          priority: 'HIGH',
          dueDate: null,
          completedAt: null,
          estimatedHours: null,
          parentTaskId: 'parent-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          assignedTo: { id: 'u2', email: 'b@x.com', firstName: 'B', lastName: 'C' },
          createdBy: { id: 'u1', email: 'a@x.com', firstName: 'A', lastName: 'B' },
          _count: { comments: 2, subtasks: 0 },
        },
      ]);
    // listTaskSubtasks: first findFirst = parent, then findMany = children
    let findFirstCalls = 0;
    const tx = {
      task: {
        findFirst: async (args: any) => {
          findFirstCalls += 1;
          return parentFindFirst(args);
        },
        findMany: taskFindMany,
      },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn(tx, WS_ID),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
    return { tools, parentFindFirst, taskFindMany, getFindFirstCalls: () => findFirstCalls };
  }

  it('requires taskId', async () => {
    const { tools } = makeTools();
    await expect(
      tools.listTaskSubtasks(baseUser({ role: UserRole.STAFF }), { taskId: '' }),
    ).rejects.toThrow(/taskId is required/);
  });

  it('returns parent summary + direct children with flattened counts', async () => {
    const { tools, parentFindFirst, taskFindMany } = makeTools();
    const user = baseUser({ id: 'staff-1', role: UserRole.STAFF });
    const result = await tools.listTaskSubtasks(user, { taskId: 'parent-1' });

    const parentWhere = (parentFindFirst.mock.calls[0] as any[])[0].where;
    expect(parentWhere.id).toBe('parent-1');
    expect(parentWhere.project).toEqual({
      OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }],
    });

    expect(taskFindMany.mock.calls[0][0].where).toEqual({ parentTaskId: 'parent-1' });
    expect(taskFindMany.mock.calls[0][0].orderBy).toEqual([
      { priority: 'desc' },
      { dueDate: 'asc' },
      { createdAt: 'desc' },
    ]);

    expect(result.parent.id).toBe('parent-1');
    expect(result.parent.project.projectNumber).toBe('P-00001');
    expect(result.count).toBe(1);
    expect(result.subtasks[0].id).toBe('child-1');
    expect(result.subtasks[0].commentsCount).toBe(2);
    expect(result.subtasks[0].subtasksCount).toBe(0);
    expect((result.subtasks[0] as any)._count).toBeUndefined();
  });

  it('throws when parent is missing or not visible', async () => {
    const { tools } = makeTools({
      parentFindFirst: jest.fn(async () => null),
    });
    await expect(
      tools.listTaskSubtasks(baseUser({ role: UserRole.STAFF }), { taskId: 'missing' }),
    ).rejects.toThrow(/Task not found or you don't have access/);
  });
});

describe('ProjectOpsTools — task comment list/update/delete parity (G-05)', () => {
  const WS_ID = 'ws-1';

  function makeCommentTools(txOverrides?: {
    taskFindFirst?: () => Promise<any>;
    commentFindFirst?: () => Promise<any>;
    commentFindMany?: (args: any) => Promise<any[]>;
    commentCount?: () => Promise<number>;
    commentUpdate?: (args: any) => Promise<any>;
    commentDelete?: (args: any) => Promise<any>;
  }) {
    const tx = {
      task: {
        findFirst: jest.fn(
          txOverrides?.taskFindFirst ?? (async () => ({ id: 'task1', projectId: 'p1' })),
        ),
      },
      taskComment: {
        findFirst: jest.fn(
          txOverrides?.commentFindFirst ??
            (async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' })),
        ),
        findMany: jest.fn(
          txOverrides?.commentFindMany ??
            (async () => [
              {
                id: 'c1',
                taskId: 'task1',
                content: 'hello',
                authorId: 'u1',
                createdAt: new Date(),
                updatedAt: new Date(),
                author: { id: 'u1', firstName: 'A', lastName: 'B', email: 'a@x.co' },
              },
            ]),
        ),
        count: jest.fn(txOverrides?.commentCount ?? (async () => 1)),
        update: jest.fn(
          txOverrides?.commentUpdate ??
            (async (a: any) => ({
              id: 'c1',
              taskId: 'task1',
              content: a.data.content,
              authorId: 'u1',
              createdAt: new Date(),
              updatedAt: new Date(),
              author: { firstName: 'A', lastName: 'B' },
            })),
        ),
        delete: jest.fn(txOverrides?.commentDelete ?? (async () => ({}))),
      },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_user: User, fn: (t: any) => Promise<any>) => fn(tx),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
    return { tools, tx };
  }

  const author = baseUser({ id: 'u1', role: UserRole.STAFF });
  const otherStaff = baseUser({ id: 'u2', role: UserRole.STAFF });
  const admin = baseUser({ id: 'admin', role: UserRole.ADMIN });
  const manager = baseUser({ id: 'mgr', role: UserRole.MANAGER });

  it('list_task_comments returns paginated thread for a visible task', async () => {
    const { tools, tx } = makeCommentTools();
    const out = await tools.listTaskComments(author, { taskId: 'task1', limit: 10, offset: 0 });
    expect(out.taskId).toBe('task1');
    expect(out.total).toBe(1);
    expect(out.comments).toHaveLength(1);
    expect(out.limit).toBe(10);
    expect(out.offset).toBe(0);
    expect(tx.task.findFirst).toHaveBeenCalled();
    // Visibility filter is ANDed via project: buildVisibilityFilter
    const where = (tx.task.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where.id).toBe('task1');
    expect(where.project).toEqual({
      OR: [{ assignedToId: 'u1' }, { createdById: 'u1' }],
    });
  });

  it('list_task_comments rejects missing/inaccessible task', async () => {
    const { tools } = makeCommentTools({ taskFindFirst: async () => null });
    await expect(
      tools.listTaskComments(author, { taskId: 'missing' }),
    ).rejects.toThrow(/Task not found/);
  });

  it('update_task_comment allows author', async () => {
    const { tools } = makeCommentTools();
    const out = await tools.updateTaskComment(author, {
      commentId: 'c1',
      content: 'fixed typo',
    });
    expect(out.content).toBe('fixed typo');
    expect(out.id).toBe('c1');
  });

  it('update_task_comment allows ADMIN on others\' comments', async () => {
    const { tools } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    const out = await tools.updateTaskComment(admin, {
      commentId: 'c1',
      content: 'admin fix',
    });
    expect(out.content).toBe('admin fix');
  });

  it('update_task_comment denies non-author STAFF', async () => {
    const { tools } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    await expect(
      tools.updateTaskComment(otherStaff, { commentId: 'c1', content: 'nope' }),
    ).rejects.toThrow(/Only the author or an ADMIN/);
  });

  it('update_task_comment denies MANAGER on others\' comments', async () => {
    const { tools } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    await expect(
      tools.updateTaskComment(manager, { commentId: 'c1', content: 'nope' }),
    ).rejects.toThrow(/Only the author or an ADMIN/);
  });

  it('delete_task_comment allows author, ADMIN, MANAGER; denies other STAFF', async () => {
    const { tools: t1 } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    await expect(t1.deleteTaskComment(author, { commentId: 'c1' })).resolves.toEqual({
      deleted: true,
      commentId: 'c1',
      taskId: 'task1',
    });

    const { tools: t2 } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    await expect(t2.deleteTaskComment(admin, { commentId: 'c1' })).resolves.toMatchObject({
      deleted: true,
    });

    const { tools: t3 } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    await expect(t3.deleteTaskComment(manager, { commentId: 'c1' })).resolves.toMatchObject({
      deleted: true,
    });

    const { tools: t4 } = makeCommentTools({
      commentFindFirst: async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' }),
    });
    await expect(t4.deleteTaskComment(otherStaff, { commentId: 'c1' })).rejects.toThrow(
      /Only the author, ADMIN, or MANAGER/,
    );
  });

  it('delete_task_comment not-found when invisible/missing', async () => {
    const { tools } = makeCommentTools({ commentFindFirst: async () => null });
    await expect(tools.deleteTaskComment(author, { commentId: 'gone' })).rejects.toThrow(
      /Comment not found/,
    );
  });
});

describe('ProjectOpsTools.deleteTask', () => {
  // Mirrors REST DELETE /tasks/:id (@Roles ADMIN only). Gate fires before DB;
  // happy path + not-found exercise the runScoped mock service surface.
  const WS_ID = 'ws-delete';

  function makeDeleteTools(opts?: {
    findFirst?: jest.Mock;
    deleteFn?: jest.Mock;
  }) {
    const findFirst = opts?.findFirst ?? jest.fn(async () => ({ id: 'task-1' }));
    const deleteFn = opts?.deleteFn ?? jest.fn(async () => ({}));
    const workspace = {
      resolveAuthorized: jest.fn(async () => WS_ID),
      runForUser: jest.fn(async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn({ task: { findFirst, delete: deleteFn } }, WS_ID),
      ),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      undefined,
      null,
      workspace,
    );
    return { tools, findFirst, deleteFn, workspace };
  }

  const admin = baseUser({ role: UserRole.ADMIN });
  const client = baseUser({ role: UserRole.CLIENT });

  it('rejects CLIENT (ADMIN-only RBAC, same as REST)', async () => {
    const { tools, findFirst, deleteFn } = makeDeleteTools();
    await expect(tools.deleteTask(client, { taskId: 'task-1' })).rejects.toThrow(/Only ADMIN/);
    expect(findFirst).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it.each([UserRole.STAFF, UserRole.MANAGER])(
    'rejects %s (REST is ADMIN only, not assertCanWrite)',
    async (role) => {
      const { tools, findFirst, deleteFn } = makeDeleteTools();
      await expect(tools.deleteTask(baseUser({ role }), { taskId: 'task-1' })).rejects.toThrow(
        /Only ADMIN/,
      );
      expect(findFirst).not.toHaveBeenCalled();
      expect(deleteFn).not.toHaveBeenCalled();
    },
  );

  it('requires taskId before touching the DB', async () => {
    const { tools, findFirst } = makeDeleteTools();
    await expect(tools.deleteTask(admin, { taskId: '' })).rejects.toThrow(/taskId/);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('not-found when the task is missing or not visible', async () => {
    const { tools, deleteFn } = makeDeleteTools({
      findFirst: jest.fn(async () => null),
    });
    await expect(tools.deleteTask(admin, { taskId: 'missing' })).rejects.toThrow(
      /Task not found or no access/,
    );
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('happy path: ADMIN deletes via findFirst + delete (mock service)', async () => {
    const { tools, findFirst, deleteFn, workspace } = makeDeleteTools();
    const res = await tools.deleteTask(admin, { taskId: 'task-1' });
    expect(res).toEqual({ message: 'Task deleted successfully', id: 'task-1' });
    expect(workspace.resolveAuthorized).toHaveBeenCalledWith(admin, null);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'task-1' }),
        select: { id: true },
      }),
    );
    // ADMIN visibility filter is open ({}); project key is still present.
    const where = (findFirst.mock.calls[0] as any[])[0].where;
    expect(where.project).toEqual({});
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'task-1' } });
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

describe('ProjectOpsTools.deleteTimeEntry — REST parity thin wrapper', () => {
  // delete_time_entry is a pure delegate to TimeEntryService.remove (same path
  // as REST DELETE /time-entries/:id). Immutability (DRAFT/unlocked/unbilled)
  // and ownership live in the service; here we pin wiring + id validation.
  const WS = 'ws-time';
  const staff = baseUser({ role: UserRole.STAFF });

  function makeDeleteTools(removeImpl?: (ws: string, user: any, id: string) => Promise<any>) {
    const remove = jest.fn(
      removeImpl ?? (async () => ({ message: 'Time entry deleted' })),
    );
    const workspace = { resolveAuthorized: jest.fn(async () => WS) } as any;
    const tt = {
      timer: {},
      timeEntry: { remove },
      timesheet: {},
      reports: {},
      rollup: {},
      workspace,
    } as any;
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined,
      tt,
      null,
      workspace,
    );
    return { tools, remove, workspace };
  }

  it('requires id', async () => {
    const { tools, remove } = makeDeleteTools();
    await expect(tools.deleteTimeEntry(staff, { id: '' })).rejects.toThrow(/id is required/);
    await expect(tools.deleteTimeEntry(staff, {} as any)).rejects.toThrow(/id is required/);
    expect(remove).not.toHaveBeenCalled();
  });

  it('delegates to TimeEntryService.remove with resolved workspace + id', async () => {
    const { tools, remove, workspace } = makeDeleteTools();
    const out = await tools.deleteTimeEntry(staff, { id: 'e-42' });
    expect(out).toEqual({ message: 'Time entry deleted' });
    expect(workspace.resolveAuthorized).toHaveBeenCalledWith(staff, null);
    expect(remove).toHaveBeenCalledWith(WS, staff, 'e-42');
  });

  it('surfaces service ForbiddenException (locked/billed/non-DRAFT) unchanged', async () => {
    const { tools } = makeDeleteTools(async () => {
      throw new ForbiddenException('This time entry is billed and cannot be changed');
    });
    await expect(tools.deleteTimeEntry(staff, { id: 'e-billed' })).rejects.toThrow(
      /billed and cannot be changed/,
    );
  });

  it('fails loudly when time tracking is not wired', async () => {
    const tools = new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      // tt omitted
    );
    await expect(tools.deleteTimeEntry(staff, { id: 'e1' })).rejects.toThrow(
      /Time tracking is not enabled/,
    );
  });
});

describe('ProjectOpsTools.searchProjects — visibility filter must survive the text-search OR', () => {
  // Regression guard for an access-predicate clobber: the old
  // `{ ...buildVisibilityFilter(user), OR: [terms] }` shape let the search
  // terms OVERWRITE the visibility `OR` for STAFF/CLIENT callers, so any
  // STAFF/CLIENT token could enumerate every project in the database through
  // free-text search. The where MUST AND-nest: [visibility, { OR: terms }].
  const WS_ID = 'ws-1';

  function makeTools(findMany: jest.Mock) {
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn({ project: { findMany } }, WS_ID),
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

  it('a STAFF caller cannot match projects outside their visibility filter', async () => {
    const findMany = jest.fn(async () => []);
    const tools = makeTools(findMany);

    await tools.searchProjects(baseUser({ role: UserRole.STAFF, id: 'staff-1' }), {
      query: 'corporal',
    });

    const where = (findMany.mock.calls[0] as any[])[0].where;
    // The access predicate is ANDed with the search terms — not clobbered.
    expect(where.AND[0]).toEqual({
      OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }],
    });
    expect(where.AND[1].OR).toEqual(
      expect.arrayContaining([
        { title: { contains: 'corporal', mode: 'insensitive' } },
        { projectNumber: { contains: 'corporal', mode: 'insensitive' } },
      ]),
    );
    // And the search terms must NOT sit at the top level where they could
    // replace the visibility OR (the original bug shape).
    expect(where.OR).toBeUndefined();
  });

  it('ADMIN (empty visibility filter) still composes and searches everything', async () => {
    const findMany = jest.fn(async () => []);
    const tools = makeTools(findMany);

    await tools.searchProjects(baseUser({ role: UserRole.ADMIN, id: 'admin-1' }), {
      query: 'qwen',
    });

    const where = (findMany.mock.calls[0] as any[])[0].where;
    expect(where.AND[0]).toEqual({});
    expect(where.AND[1].OR.length).toBe(5);
  });
});

describe('ProjectOpsTools — request-addressed workspace (X-Workspace-Id) threading', () => {
  // The controller threads the guard-resolved `req.workspaceId` (SUITE-IDENTITY
  // §D4: path param → X-Workspace-Id header → token claim) into ProjectOpsTools
  // as `requestWorkspaceId`. runScoped MUST hand it to resolveAuthorized as the
  // requested workspace — this is what makes an explicit X-Workspace-Id from a
  // JWT-auth'd MCP client actually re-scope the tools instead of being
  // silently dropped at the controller/tools seam.

  function makeWorkspaceMock(resolvedId: string) {
    const resolveAuthorized = jest.fn(async () => resolvedId);
    const runForUser = jest.fn(
      async (
        _u: User,
        fn: (t: any, ws: string) => Promise<any>,
        _requested?: string | null,
      ) => fn({ project: { findMany: jest.fn(async () => []) } }, resolvedId),
    );
    return { workspace: { resolveAuthorized, runForUser } as any, resolveAuthorized, runForUser };
  }

  function makeTools(workspace: any, requestWorkspaceId: string | null) {
    return new ProjectOpsTools(
      {} as any,
      {} as any,
      { log: () => {}, warn: () => {} },
      undefined, // triage
      undefined, // tt
      null, // bearerToken
      workspace,
      undefined, // events
      undefined, // wave2
      undefined, // workspaceAdmin
      requestWorkspaceId,
    );
  }

  it('passes the request-addressed workspace into resolveAuthorized and runForUser', async () => {
    const { workspace, resolveAuthorized, runForUser } = makeWorkspaceMock('ws-mu');
    const tools = makeTools(workspace, 'ws-mu');
    const user = baseUser({ role: UserRole.STAFF, id: 'staff-1' });

    await tools.listMyProjects(user, {});

    expect(resolveAuthorized).toHaveBeenCalledWith(user, 'ws-mu');
    // runForUser is re-authorized against the SAME resolved id (3rd arg).
    expect(runForUser.mock.calls[0][2]).toBe('ws-mu');
  });

  it('falls back to claim/default resolution (null requested) when no workspace was addressed', async () => {
    const { workspace, resolveAuthorized } = makeWorkspaceMock('ws-default');
    const tools = makeTools(workspace, null);
    const user = baseUser({ role: UserRole.STAFF, id: 'staff-1' });

    await tools.listMyProjects(user, {});

    expect(resolveAuthorized).toHaveBeenCalledWith(user, null);
  });
});

describe('ProjectOpsTools.getProject — metadata.quote exposure (QUOTES-CONTRACT-v1 §3)', () => {
  const WS_ID = 'ws-1';
  const META = {
    quote: {
      customer_ops_quote_id: 'q-0001',
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok_synthetic',
      schedule_ids: ['sched-deposit'],
    },
    quoteSummary: { title: 'Order Pad for the apparel client', currency: 'USD', status: 'accepted', totals: { one_time_total_cents: 140000 } },
    customFields: { tier: 'gold' },
  };

  /**
   * A row shaped like the one `getProject` actually loads: `include` with no
   * `select` returns EVERY Project scalar, including the studio's commercial
   * columns. The quotes seam writes the A14 hourly rate into `defaultBillRate`,
   * so this fixture is what a CLIENT would receive unmasked.
   */
  const BILLING_ROW = {
    id: 'p1',
    projectNumber: 'PROJ-1',
    metadata: META,
    billingAmount: '4300.00',
    paymentStatus: 'UNPAID',
    invoiceNumber: 'INV-1',
    defaultBillRate: '150.0000',
    budgetAmount: '4300.00',
    budgetHours: '48.00',
    billByDefault: true,
    billingNotes: 'Quote Q-2026-0001 v1: 50% on acceptance, 50% per milestone.',
  };

  function makeTools(findFirst: jest.Mock) {
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_u: User, fn: (t: any, ws: string) => Promise<any>) =>
        fn({ project: { findFirst } }, WS_ID),
    } as any;
    return new ProjectOpsTools({} as any, {} as any, { log: () => {}, warn: () => {} }, undefined, undefined, null, workspace);
  }

  it('staff/admin: `quote` mirrors metadata.quote (ids, number, version, share_url, schedule_ids) and metadata is untouched', async () => {
    const findFirst = jest.fn(async () => ({ id: 'p1', projectNumber: 'PROJ-1', metadata: META }));
    const out: any = await makeTools(findFirst).getProject(baseUser({ role: UserRole.ADMIN }), { id: 'p1' });
    expect(out.quote).toEqual(META.quote);
    expect(out.metadata).toEqual(META);
  });

  it('client: `quote` and metadata.quote are masked to number/version/share_url; other metadata keys survive', async () => {
    const findFirst = jest.fn(async () => ({ ...BILLING_ROW }));
    const out: any = await makeTools(findFirst).getProject(baseUser({ role: UserRole.CLIENT, id: 'client-1' }), { id: 'p1' });
    const masked = { number: 'Q-2026-0001', version: 1, share_url: 'https://customers.example.dev/q/tok_synthetic' };
    expect(out.quote).toEqual(masked);
    expect(out.metadata.quote).toEqual(masked);
    expect(out.metadata.customFields).toEqual({ tier: 'gold' });
    expect(out.metadata.quoteSummary).toEqual(META.quoteSummary); // cache is client-whitelisted by construction
    expect(JSON.stringify(out)).not.toContain('customer_ops_quote_id');
    expect(JSON.stringify(out)).not.toContain('sched-deposit');
  });

  it('client: the studio commercial columns never reach a CLIENT — above all the A14 hourly rate', async () => {
    const findFirst = jest.fn(async () => ({ ...BILLING_ROW }));
    const out: any = await makeTools(findFirst).getProject(baseUser({ role: UserRole.CLIENT, id: 'client-1' }), { id: 'p1' });

    for (const field of CLIENT_MASKED_PROJECT_FIELDS) {
      expect(out).not.toHaveProperty(field);
    }
    // The rate is staff-only (A14) wherever it appears, not merely absent by key.
    expect(JSON.stringify(out)).not.toContain('150.0000');
    expect(JSON.stringify(out)).not.toContain('48.00');
    expect(JSON.stringify(out)).not.toContain('50% on acceptance');

    // …and the client's OWN invoice-facing fields still come through, exactly
    // as the client portal hands them over.
    expect(out.billingAmount).toBe('4300.00');
    expect(out.paymentStatus).toBe('UNPAID');
    expect(out.invoiceNumber).toBe('INV-1');
  });

  it('staff keep every commercial column', async () => {
    const findFirst = jest.fn(async () => ({ ...BILLING_ROW }));
    const out: any = await makeTools(findFirst).getProject(baseUser({ role: UserRole.STAFF, id: 'staff-1' }), { id: 'p1' });
    for (const field of CLIENT_MASKED_PROJECT_FIELDS) {
      expect(out).toHaveProperty(field);
    }
    expect(out.defaultBillRate).toBe('150.0000');
  });

  it('a CLIENT never reads an internal comment on this surface; staff do', async () => {
    const seen: any[] = [];
    const findFirst = jest.fn(async (args: any) => {
      seen.push(args.include.comments.where);
      return { ...BILLING_ROW };
    });
    const tools = makeTools(findFirst);
    await tools.getProject(baseUser({ role: UserRole.CLIENT, id: 'client-1' }), { id: 'p1' });
    await tools.getProject(baseUser({ role: UserRole.ADMIN }), { id: 'p1' });
    expect(seen[0]).toEqual({ isInternal: false });
    expect(seen[1]).toBeUndefined();
  });

  it('quote is null when the project did not come from a quote', async () => {
    const findFirst = jest.fn(async () => ({ id: 'p1', projectNumber: 'PROJ-1', metadata: { customFields: {} } }));
    const out: any = await makeTools(findFirst).getProject(baseUser({ role: UserRole.STAFF, id: 'staff-1' }), { id: 'p1' });
    expect(out.quote).toBeNull();
    expect(out.metadata).toEqual({ customFields: {} });
  });

  it('withProjectQuote drops an unparseable metadata.quote for a CLIENT rather than passing it through', () => {
    const out: any = withProjectQuote({ metadata: { quote: { number: 'Q-1' }, keep: true } }, { role: UserRole.CLIENT });
    expect(out.quote).toBeNull();
    expect(out.metadata).toEqual({ keep: true });
  });
});
