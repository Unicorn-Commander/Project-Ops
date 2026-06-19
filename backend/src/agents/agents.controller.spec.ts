import 'reflect-metadata';
import { AgentsController } from './agents.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

/**
 * Gate tests: the agents surface is internal agent spend, so it must sit behind
 * JwtAuthGuard + RolesGuard (ADMIN/MANAGER) + WorkspaceMembershipGuard (the
 * workspace-RLS chokepoint). We assert the controller-level metadata rather than
 * booting Nest — same guards the reporting/capacity controllers carry.
 */
describe('AgentsController gating', () => {
  it('is guarded by Jwt + Roles + WorkspaceMembership at the class level', () => {
    const guards = Reflect.getMetadata('__guards__', AgentsController) ?? [];
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard]),
    );
  });

  it('restricts the surface to ADMIN/MANAGER via @Roles at the class level', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AgentsController);
    expect(roles).toEqual([UserRole.ADMIN, UserRole.MANAGER]);
  });

  it('delegates each route to the service (no business logic in the controller)', () => {
    const agents = {
      getRoster: jest.fn(() => 'roster'),
      getActivity: jest.fn(() => 'activity'),
      getUsage: jest.fn(() => 'usage'),
      getAgent: jest.fn(() => 'agent'),
      setBillable: jest.fn(() => 'billable'),
    } as any;
    const c = new AgentsController(agents);
    const user = { id: 'u1' } as any;

    expect(c.roster('ws', user)).toBe('roster');
    expect(c.usage('ws', user, { from: 'a', to: 'b' } as any)).toBe('usage');
    expect(c.agent('ws', user, 'pat-1', {} as any)).toBe('agent');
    expect(c.setBillable('ws', user, 'e1', { billable: true })).toBe('billable');

    c.activity('ws', user, { actorKey: 'pat-1' } as any, 50, 0);
    expect(agents.getActivity).toHaveBeenCalledWith(
      'ws',
      user,
      expect.objectContaining({ actorKey: 'pat-1', limit: 50, offset: 0 }),
    );
  });

  it('clamps limit/offset to sane bounds', () => {
    const agents = { getActivity: jest.fn() } as any;
    const c = new AgentsController(agents);
    c.activity('ws', { id: 'u1' } as any, {} as any, 9999, -5);
    expect(agents.getActivity).toHaveBeenCalledWith(
      'ws',
      expect.anything(),
      expect.objectContaining({ limit: 200, offset: 0 }),
    );
  });
});
