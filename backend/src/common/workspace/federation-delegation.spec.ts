import { User, UserRole } from '@prisma/client';
import {
  readDelegationHeader,
  resolveFederationDelegation,
  FederationDelegationDeps,
} from './federation-delegation';
import { readTokenScopes } from './federation-token';
import { AuthService } from '../../auth/auth.service';

const WS = '019e50a3-d995-723f-ab66-0f765f92c0f4';
const member = {
  id: 'u1',
  email: 'member@example.test',
  keycloakId: 'kc-member',
  role: UserRole.ADMIN,
  isActive: true,
} as unknown as User;

function principal(overrides: Record<string, unknown> = {}) {
  return Object.assign(
    AuthService.buildFederationPrincipal('customer-ops', ['projects:read']) as any,
    { __workspaceClaim: WS },
    overrides,
  );
}

function deps(overrides: Partial<FederationDelegationDeps> = {}): FederationDelegationDeps {
  return {
    federationActors: 'meeting-ops,customer-ops',
    findActiveUserByKeycloakId: jest.fn(async (k: string) =>
      k === 'kc-member' ? { ...member } : null,
    ),
    isActiveMember: jest.fn(async (_u: User, ws: string) => ws === WS),
    ...overrides,
  };
}

describe('resolveFederationDelegation', () => {
  it('is a no-op for a human principal or a federation call without X-Uc-Uid', async () => {
    expect(
      await resolveFederationDelegation(deps(), { ...member } as any, 'kc-member', null),
    ).toEqual({
      kind: 'none',
    });
    expect(await resolveFederationDelegation(deps(), principal(), null, WS)).toEqual({
      kind: 'none',
    });
  });

  it('delegates to the named member, read-scoped and bound to the token workspace', async () => {
    const d = await resolveFederationDelegation(deps(), principal(), 'kc-member', WS);
    expect(d.kind).toBe('delegated');
    if (d.kind !== 'delegated') return;
    expect(d.user.id).toBe('u1');
    expect(d.workspaceId).toBe(WS);
    expect(d.scopes).toEqual(['read:projects']);
    expect(d.scopes.some((s) => s.startsWith('write:'))).toBe(false);
    expect(d.user.__workspaceClaim).toBe(WS);
    expect(d.user.__ucUid).toBe('kc-member');
  });

  it.each([
    [
      'actor not allow-listed',
      deps({ federationActors: 'meeting-ops' }),
      principal(),
      'kc-member',
      WS,
    ],
    [
      'actor without a delegation grant',
      deps(),
      principal({ __federationActor: 'meeting-ops' }),
      'kc-member',
      WS,
    ],
    [
      'token lacks projects:read',
      deps(),
      principal({ __federationScopes: ['contacts:read'] }),
      'kc-member',
      WS,
    ],
    ['no workspace claim', deps(), principal({ __workspaceClaim: null }), 'kc-member', null],
    ['request addresses another workspace', deps(), principal(), 'kc-member', 'other-ws'],
    ['unknown user', deps(), principal(), 'kc-nobody', WS],
    [
      'CLIENT user',
      deps({
        findActiveUserByKeycloakId: async () => ({ ...member, role: UserRole.CLIENT }) as User,
      }),
      principal(),
      'kc-member',
      WS,
    ],
    [
      'not a member of the token workspace',
      deps({ isActiveMember: async () => false }),
      principal(),
      'kc-member',
      WS,
    ],
  ])('refuses: %s', async (_label, d, p, uc, ws) => {
    expect((await resolveFederationDelegation(d as any, p, uc as any, ws as any)).kind).toBe(
      'denied',
    );
  });
});

describe('helpers', () => {
  it('reads Brigade scopes[] and space-separated scope', () => {
    expect(readTokenScopes({ scopes: ['projects:read', ' '] })).toEqual(['projects:read']);
    expect(readTokenScopes({ scope: 'a b' })).toEqual(['a', 'b']);
    expect(readTokenScopes(null)).toEqual([]);
  });
  it('reads the X-Uc-Uid header case-insensitively as Express lowercases it', () => {
    expect(readDelegationHeader({ 'x-uc-uid': ' kc ' })).toBe('kc');
    expect(readDelegationHeader({ 'x-uc-uid': ['kc', 'x'] })).toBe('kc');
    expect(readDelegationHeader({})).toBeNull();
  });
});
