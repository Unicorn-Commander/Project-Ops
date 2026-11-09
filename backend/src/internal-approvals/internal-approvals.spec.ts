import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { User, UserRole, WorkspaceRole } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { McpService } from '../mcp/mcp.service';
import { setMcpToolRegistration } from '../test-compat/mcp';
import { RecordInternalApprovalDto } from './dto/internal-approval.dto';
import { InternalApprovalsController } from './internal-approvals.controller';
import { InternalApprovalsService } from './internal-approvals.service';

const projectId = '10000000-0000-4000-8000-000000000001';
const otherProjectId = '10000000-0000-4000-8000-000000000002';
const workspaceId = 'workspace-example';
const user = {
  id: 'avery',
  email: 'avery@example.com',
  role: UserRole.STAFF,
  keycloakId: null,
} as User;
const binding = {
  projectId,
  entity: 'pr' as const,
  entityRef: 'https://example.com/repo/pull/17',
  versionHash: 'a'.repeat(40),
};
const approval: RecordInternalApprovalDto = {
  ...binding,
  decision: 'APPROVE',
  reason: 'Reviewed this exact revision.',
};

describe('internal approvals (network-free REST/service/MCP contract)', () => {
  let rows: any[];
  let member: boolean;
  let memberRole: WorkspaceRole;
  let prisma: any;
  let workspace: WorkspaceContextService;
  let membership: MembershipService;
  let service: InternalApprovalsService;
  let controller: InternalApprovalsController;
  let tx: any;
  const registered = new Map<string, { schema: any; handler: (args: any) => Promise<any> }>();

  beforeEach(() => {
    rows = [];
    member = true;
    memberRole = WorkspaceRole.MEMBER;
    registered.clear();
    const matches = (row: any, where: any) =>
      Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
    const query = ({ where, orderBy, take, skip = 0 }: any) => {
      expect(orderBy).toEqual({ sequence: 'desc' });
      return rows
        .filter((row) => matches(row, where))
        .sort((a, b) => b.sequence - a.sequence)
        .slice(skip, take === undefined ? undefined : skip + take);
    };
    tx = {
      project: {
        findFirst: jest.fn(async ({ where }) =>
          [projectId, otherProjectId].includes(where.id) && where.workspaceId === workspaceId
            ? { id: where.id }
            : null,
        ),
      },
      task: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'task-example' &&
          where.projectId === projectId &&
          where.workspaceId === workspaceId
            ? { id: where.id }
            : null,
        ),
      },
      document: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'document-example' &&
          where.projectId === projectId &&
          where.workspaceId === workspaceId
            ? { id: where.id }
            : null,
        ),
      },
      internalApproval: {
        create: jest.fn(async ({ data }) => {
          const row = {
            ...data,
            id: `approval-${rows.length + 1}`,
            sequence: rows.length + 1,
            createdAt: new Date('2026-11-09T12:00:00Z'),
          };
          rows.push(row);
          return row;
        }),
        findMany: jest.fn(async (args) => query(args)),
        findFirst: jest.fn(async (args) => query(args)[0] ?? null),
      },
    };
    prisma = {
      membership: {
        // Existing identity avoids the unrelated allow-list bootstrap path.
        findFirst: jest.fn(async () => ({ userKey: user.id })),
        findMany: jest.fn(async () =>
          member ? [{ workspaceId, status: 'ACTIVE', isDefault: true }] : [],
        ),
        findUnique: jest.fn(async () =>
          member
            ? { workspaceId, status: 'ACTIVE', role: memberRole, workspace: { status: 'active' } }
            : null,
        ),
      },
      withWorkspace: jest.fn(async (id, _uid, fn) => {
        expect(id).toBe(workspaceId);
        return fn(tx);
      }),
    };
    const config = {
      get: (key: string, fallback?: string) =>
        key === 'PROJECT_OPS_TENANCY_ENABLED' ? 'true' : fallback,
    } as ConfigService;
    membership = new MembershipService(prisma, config);
    workspace = new WorkspaceContextService(config, prisma, membership);
    service = new InternalApprovalsService(workspace);
    controller = new InternalApprovalsController(service);
    setMcpToolRegistration((name, schema, handler) => registered.set(name, { schema, handler }));
  });

  async function mcp(caller = user, scopes?: string[]) {
    const noop = {} as any;
    const server = new McpService(
      prisma,
      noop,
      noop,
      workspace,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      undefined,
      undefined,
      undefined,
      service,
    );
    await server.createServerForUser(caller, scopes, null, null, null, workspaceId);
    return (name: string, args: any) => registered.get(name)!.handler(args);
  }

  it('records type INTERNAL and derives the approver from each authenticated caller', async () => {
    const first = await controller.record(workspaceId, user, approval);
    const second = await controller.record(
      workspaceId,
      { ...user, id: 'agent-jules', email: 'jules@example.com' },
      approval,
    );
    expect(first).toMatchObject({
      type: 'INTERNAL',
      approverId: 'avery',
      workspaceId,
      ...approval,
    });
    expect(second.approverId).toBe('agent-jules');
  });

  it.each(['approverId', 'createdById', 'userId', 'workspaceId', 'type', 'sequence', 'createdAt'])(
    'rejects a supplied %s rather than trusting identity/order from input',
    async (field) => {
      await expect(
        controller.record(workspaceId, user, { ...approval, [field]: 'forged' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(tx.internalApproval.create).not.toHaveBeenCalled();
    },
  );

  it('a later REJECT supersedes APPROVE even with tied timestamps and preserves both audit rows', async () => {
    const first = await controller.record(workspaceId, user, approval);
    const second = await controller.record(workspaceId, user, {
      ...approval,
      decision: 'REJECT',
      reason: 'Found a regression.',
    });
    expect(await controller.latest(workspaceId, user, binding)).toEqual(second);
    expect(await controller.list(workspaceId, user, { projectId })).toEqual([second, first]);
    expect(first.decision).toBe('APPROVE');
  });

  it('version, entity, reference, project, and workspace isolate the binding', async () => {
    const first = await service.record(workspaceId, user, approval);
    const otherVersion = { ...binding, versionHash: 'b'.repeat(40) };
    const rejected = await service.record(workspaceId, user, {
      ...approval,
      ...otherVersion,
      decision: 'REJECT',
    });
    await service.record(workspaceId, user, {
      ...approval,
      projectId: otherProjectId,
      decision: 'DEFER',
    });
    rows.push({ ...first, workspaceId: 'other-workspace', sequence: 999, decision: 'REJECT' });
    expect(await service.latest(workspaceId, user, binding)).toEqual(first);
    expect(await service.latest(workspaceId, user, otherVersion)).toEqual(rejected);
    expect(
      await service.latest(workspaceId, user, { ...binding, entityRef: 'different' }),
    ).toBeNull();
    expect(await service.latest(workspaceId, user, { ...binding, entity: 'task' })).toBeNull();
    expect(
      await service.list(workspaceId, user, {
        projectId,
        entity: 'pr',
        entityRef: binding.entityRef,
        limit: 1,
        offset: 1,
      }),
    ).toEqual([first]);
    expect(
      await service.list(workspaceId, user, { projectId, versionHash: otherVersion.versionHash }),
    ).toEqual([rejected]);
  });

  it.each(['task', 'document'] as const)(
    'requires a %s to belong to the selected project and workspace',
    async (entity) => {
      const input = { ...approval, entity, entityRef: `${entity}-example` };
      await expect(service.record(workspaceId, user, input)).resolves.toMatchObject(input);
      await expect(
        service.record(workspaceId, user, { ...input, projectId: otherProjectId }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.record(workspaceId, user, { ...input, entityRef: 'missing' }),
      ).rejects.toMatchObject({ status: 404 });
    },
  );

  it('rejects a project outside this workspace', async () => {
    await expect(
      service.record(workspaceId, user, {
        ...approval,
        projectId: '10000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    { versionHash: '' },
    { entityRef: '  ' },
    { reason: '  ' },
    { decision: 'PENDING' },
    { entity: 'project' },
  ])('rejects invalid decision inputs %j', async (invalid) => {
    await expect(
      service.record(workspaceId, user, { ...approval, ...invalid } as any),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('has only POST, list GET, and latest GET routes, with task-comment guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, InternalApprovalsController)).toBe(
      'internal-approvals',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, InternalApprovalsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
      WorkspaceMembershipGuard,
    ]);
    const proto = InternalApprovalsController.prototype;
    expect(Object.getOwnPropertyNames(proto).filter((key) => key !== 'constructor')).toEqual([
      'record',
      'list',
      'latest',
    ]);
    expect(Reflect.getMetadata(METHOD_METADATA, proto.record)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, proto.list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, proto.latest)).toBe('latest');
  });

  it('returns 403 for a non-member at the REST guard and all service entrypoints', async () => {
    member = false;
    const request = { user, method: 'POST', headers: { 'x-workspace-id': workspaceId } };
    const context = {
      getType: () => 'http',
      getClass: () => InternalApprovalsController,
      getHandler: () => controller.record,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new WorkspaceMembershipGuard(membership, new Reflector());
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    for (const operation of [
      () => service.record(workspaceId, user, approval),
      () => service.list(workspaceId, user, {}),
      () => service.latest(workspaceId, user, binding),
    ]) {
      await expect(operation()).rejects.toMatchObject({ status: 403 });
    }
    expect(prisma.withWorkspace).not.toHaveBeenCalled();
  });

  it('denies clients and viewer writes without inserting', async () => {
    const client = { ...user, role: UserRole.CLIENT };
    await expect(service.record(workspaceId, client, approval)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.list(workspaceId, client, {})).rejects.toMatchObject({ status: 403 });
    await expect(service.latest(workspaceId, client, binding)).rejects.toMatchObject({
      status: 403,
    });
    memberRole = WorkspaceRole.VIEWER;
    await expect(service.record(workspaceId, user, approval)).rejects.toMatchObject({
      status: 403,
    });
    expect(tx.internalApproval.create).not.toHaveBeenCalled();
  });

  it('MCP records as the caller, supersedes, and uses the same audit/latest service', async () => {
    const call = await mcp(user, ['read:approvals', 'write:approvals']);
    const payload = (result: any) => JSON.parse(result.content[0].text);
    const first = payload(await call('record_internal_approval', approval));
    const second = payload(
      await call('record_internal_approval', { ...approval, decision: 'REJECT' }),
    );
    expect(first.approverId).toBe(user.id);
    expect(payload(await call('get_latest_internal_approval', binding))).toEqual(second);
    expect(payload(await call('list_internal_approvals', { projectId }))).toEqual([second, first]);
    expect(
      await call('record_internal_approval', { ...approval, approverId: 'another-user' }),
    ).toMatchObject({ isError: true });
  });

  it('MCP schemas validate required binding fields and decisions', async () => {
    await mcp();
    const schema = z.object(registered.get('record_internal_approval')!.schema.inputSchema);
    expect(schema.safeParse(approval).success).toBe(true);
    expect(schema.safeParse({ ...approval, versionHash: '' }).success).toBe(false);
    expect(schema.safeParse({ ...approval, decision: 'PENDING' }).success).toBe(false);
    expect(
      z
        .object(registered.get('get_latest_internal_approval')!.schema.inputSchema)
        .safeParse({ projectId }).success,
    ).toBe(false);
  });

  it.each(['record_internal_approval', 'list_internal_approvals', 'get_latest_internal_approval'])(
    'MCP scope and membership gates protect %s',
    async (name) => {
      const args =
        name === 'record_internal_approval'
          ? approval
          : name === 'get_latest_internal_approval'
            ? binding
            : { projectId };
      const denied = await mcp(user, ['read:projects']);
      expect(await denied(name, args)).toMatchObject({ isError: true });
      member = false;
      const noMember = await mcp();
      expect(await noMember(name, args)).toMatchObject({ isError: true });
      expect(prisma.withWorkspace).not.toHaveBeenCalled();
    },
  );

  it('a read-only PAT cannot append an internal decision', async () => {
    const call = await mcp(user, ['read:approvals']);
    expect(await call('record_internal_approval', approval)).toMatchObject({ isError: true });
    expect(tx.internalApproval.create).not.toHaveBeenCalled();
  });
});
