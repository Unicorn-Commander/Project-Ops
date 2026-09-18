import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ProjectsController } from '../../projects/projects.controller';
import { TasksController } from '../../tasks/tasks.controller';
import { RolesGuard } from './roles.guard';

const routes = [
  [TasksController, 'update'],
  [TasksController, 'updateStatus'],
  [TasksController, 'markComplete'],
  [ProjectsController, 'update'],
  [ProjectsController, 'updateStatus'],
] as const;

describe.each(routes)('%p.%s human write boundary', (controller, method) => {
  it.each([UserRole.CLIENT, UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN])(
    'enforces the route contract for %s',
    (role) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(RolesGuard);
      const context = {
        getHandler: () => controller.prototype[method],
        getClass: () => controller,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext;
      expect(new RolesGuard(new Reflector()).canActivate(context)).toBe(role !== UserRole.CLIENT);
    },
  );
});
