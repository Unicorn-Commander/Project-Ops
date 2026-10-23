import 'reflect-metadata';
import { ProjectsController } from './projects.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

const unsupportedViewerRole = 'VIEWER' as UserRole;

/**
 * Gate tests for the project create route. `RolesGuard` returns true when a
 * route carries no `@Roles` metadata, so `POST /projects` was previously
 * reachable by a CLIENT. It must now require ADMIN/MANAGER/STAFF, matching the
 * other non-read project routes.
 */
describe('ProjectsController gating', () => {
  it('is guarded by Jwt + Roles + WorkspaceMembership at the class level', () => {
    const guards = Reflect.getMetadata('__guards__', ProjectsController) ?? [];
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard]),
    );
  });

  it('restricts POST /projects to ADMIN/MANAGER/STAFF (not CLIENT)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ProjectsController.prototype.create);
    expect(roles).toEqual([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]);
    expect(roles).not.toContain(UserRole.CLIENT);
  });

  it('delegates create to the service with workspace, user and body', () => {
    const projects = { create: jest.fn(() => 'created') } as any;
    const c = new ProjectsController(projects);
    const user = { id: 'u1', role: UserRole.STAFF } as any;
    const dto = { title: 'New project' } as any;

    expect(c.create('ws', user, dto)).toBe('created');
    expect(projects.create).toHaveBeenCalledWith('ws', user, dto);
  });
});

describe('ProjectsController item route role gates', () => {
  const routes = ['findOne', 'getBudget', 'update', 'updateStatus'] as const;
  const requiredRoles = [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF];

  function canActivate(method: (typeof routes)[number], role: UserRole): boolean {
    const reflector = {
      getAllAndOverride: (key: string, targets: unknown[]) => {
        const [handler, controller] = targets as [object, object];
        return Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
      },
    } as unknown as Reflector;
    const context = {
      getHandler: () => ProjectsController.prototype[method],
      getClass: () => ProjectsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as any;
    return new RolesGuard(reflector).canActivate(context);
  }

  it.each(routes)('requires ADMIN/MANAGER/STAFF on %s', (method) => {
    expect(Reflect.getMetadata(ROLES_KEY, ProjectsController.prototype[method])).toEqual(
      requiredRoles,
    );
  });

  it.each(routes)('denies CLIENT and unsupported VIEWER on %s', (method) => {
    expect(canActivate(method, UserRole.CLIENT)).toBe(false);
    expect(canActivate(method, unsupportedViewerRole)).toBe(false);
  });

  it.each(routes)('allows staff roles on %s', (method) => {
    for (const role of [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]) {
      expect(canActivate(method, role)).toBe(true);
    }
  });
});

describe('ProjectsController.findAll — federated id filters', () => {
  it('passes exact federated filters alongside existing filters to the workspace-scoped service', async () => {
    const findAll = jest.fn().mockResolvedValue({ projects: [], total: 0 });
    const controller = new ProjectsController({ findAll } as any);
    const user = { id: 'u1', role: UserRole.ADMIN } as any;
    const customerOpsCustomerId = '550e8400-e29b-41d4-a716-446655440000';
    const contactOpsContactId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

    await controller.findAll('ws-1', user, {
      page: 2,
      limit: 10,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignedToId: 'u2',
      customerOpsCustomerId,
      contactOpsContactId,
      sortBy: 'title',
      sortDir: 'asc',
    } as any);

    expect(findAll).toHaveBeenCalledWith('ws-1', user, {
      skip: 10,
      take: 10,
      where: {
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        assignedToId: 'u2',
        customerOpsCustomerId,
        contactOpsContactId,
      },
      orderBy: { title: 'asc' },
    });
  });
});

/**
 * Behavioral check of the guard that actually decides the route: build an
 * ExecutionContext whose handler is `ProjectsController.prototype.create`, with
 * a Reflector that returns the real `@Roles` metadata, and assert the CLIENT
 * is denied while STAFF is allowed.
 */
describe('RolesGuard on POST /projects create', () => {
  function contextFor(role: UserRole) {
    const req = { user: { id: 'u1', role } };
    return {
      getHandler: () => ProjectsController.prototype.create,
      getClass: () => ProjectsController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
  }

  function guard(): RolesGuard {
    const reflector = {
      getAllAndOverride: (key: string, targets: unknown[]) => {
        const [handler, cls] = targets as [object, object];
        return Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, cls);
      },
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('denies a CLIENT', () => {
    expect(guard().canActivate(contextFor(UserRole.CLIENT))).toBe(false);
  });

  it('allows ADMIN, MANAGER and STAFF', () => {
    for (const role of [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF]) {
      expect(guard().canActivate(contextFor(role))).toBe(true);
    }
  });
});
