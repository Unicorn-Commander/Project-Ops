import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { UsersController } from './users.controller';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

const unsupportedViewerRole = 'VIEWER' as UserRole;

function guard(): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: string, targets: unknown[]) => {
      const [handler, controller] = targets as [object, object];
      return Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
    },
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function contextFor(role: UserRole): ExecutionContext {
  const request = { user: { role } };
  return {
    getHandler: () => UsersController.prototype.findOne,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('UsersController GET /users/:id role gate', () => {
  it('requires ADMIN or MANAGER metadata on findOne', () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.findOne)).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
    ]);
  });

  it.each([UserRole.STAFF, UserRole.CLIENT, unsupportedViewerRole])('denies %s', (role) => {
    expect(guard().canActivate(contextFor(role))).toBe(false);
  });

  it.each([UserRole.ADMIN, UserRole.MANAGER])('allows %s', (role) => {
    expect(guard().canActivate(contextFor(role))).toBe(true);
  });
});
