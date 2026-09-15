import { AuthService } from './auth.service';

/**
 * The federation-actor branch of validateJwtPayload (the security-critical
 * decision: synthetic app principal vs. human). A Brigade token-exchange minted
 * for a sibling APP carries `act.client_id` + a non-email service `sub`; it must
 * resolve to a synthetic, non-DB principal (so it is NOT forced through the
 * human access-list and never becomes a human). A Brigade token that DOES carry
 * a human identity (even with `act.client_id`) must still route to the human
 * path (on-behalf-of-user) so the human's membership governs.
 */
describe('AuthService federation-actor resolution', () => {
  const ISSUER = 'https://brigade.test';
  let svc: AuthService;
  let prevIssuers: string | undefined;
  let prevAud: string | undefined;

  beforeAll(() => {
    prevIssuers = process.env.BRIGADE_TRUSTED_ISSUERS;
    prevAud = process.env.BRIGADE_EXPECTED_AUDIENCE;
    process.env.BRIGADE_TRUSTED_ISSUERS = ISSUER;
    process.env.BRIGADE_EXPECTED_AUDIENCE = 'project-ops';
  });
  afterAll(() => {
    process.env.BRIGADE_TRUSTED_ISSUERS = prevIssuers;
    process.env.BRIGADE_EXPECTED_AUDIENCE = prevAud;
  });

  beforeEach(() => {
    // The federation branch returns before touching any injected dep, so empty
    // stubs suffice; the human-routing test spies on validateKeycloakUser.
    svc = new AuthService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('buildFederationPrincipal makes a synthetic, role-less, non-DB actor', () => {
    const p = AuthService.buildFederationPrincipal('meeting-ops') as any;
    expect(p.id).toBe('federation:meeting-ops');
    expect(p.__isFederationActor).toBe(true);
    expect(p.__federationActor).toBe('meeting-ops');
    expect(p.role).toBeNull();
    expect(p.isActive).toBe(true);
    expect(p.keycloakId).toBeNull();
  });

  it('resolves a Brigade APP-actor token (act.client_id + service sub) to a synthetic principal, NOT a human', async () => {
    const spy = jest.spyOn(svc, 'validateKeycloakUser' as any);
    const user = (await svc.validateJwtPayload({
      iss: ISSUER,
      aud: 'project-ops',
      sub: 'b3b1f0a2-0000-7000-8000-000000000001', // service account uuid, not an email
      act: { client_id: 'meeting-ops', sub: 'svc' },
      workspace_id: '01924a3c-0000-7f1a-beef-67f1ab5c0001',
    } as any)) as any;

    expect(user.__isFederationActor).toBe(true);
    expect(user.__federationActor).toBe('meeting-ops');
    expect(user.id).toBe('federation:meeting-ops');
    // The human JIT/access-list path must NOT be consulted for an app actor.
    expect(spy).not.toHaveBeenCalled();
  });

  it('routes a Brigade token that carries a HUMAN identity to the human path (on-behalf-of-user), even with act.client_id', async () => {
    const human = { id: 'u-human', role: 'STAFF' };
    const spy = jest
      .spyOn(svc, 'validateKeycloakUser' as any)
      .mockResolvedValue(human as any);

    const user = (await svc.validateJwtPayload({
      iss: ISSUER,
      aud: 'project-ops',
      sub: 'aaron@magicunicorn.tech', // sub looks like an email → human
      act: { client_id: 'meeting-ops', sub: 'svc' },
      workspace_id: '0190a000-7e57-7000-8000-00000000b007',
    } as any)) as any;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(user).toBe(human);
    expect(user.__isFederationActor).toBeUndefined();
  });

  it('rejects a Brigade APP-actor token whose audience is not project-ops (no synthetic bypass of aud binding)', async () => {
    await expect(
      svc.validateJwtPayload({
        iss: ISSUER,
        aud: 'accounting-ops',
        sub: 'b3b1f0a2-0000-7000-8000-000000000001',
        act: { client_id: 'meeting-ops' },
        workspace_id: '01924a3c-0000-7f1a-beef-67f1ab5c0001',
      } as any),
    ).rejects.toThrow();
  });

  it('resolves a Keycloak client-credentials token (azp, no human session) to a synthetic principal', async () => {
    const spy = jest.spyOn(svc, 'validateKeycloakUser' as any);
    const user = (await svc.validateJwtPayload({
      iss: 'https://auth.unicorncommander.ai/realms/uchub',
      azp: 'customer-ops',
      aud: 'account',
      sub: 'b3b1f0a2-0000-7000-8000-000000000002',
      preferred_username: 'service-account-customer-ops',
      workspace_id: '01924a3c-0000-7f1a-beef-67f1ab5c0001',
    } as any)) as any;

    expect(user.__isFederationActor).toBe(true);
    expect(user.__federationActor).toBe('customer-ops');
    expect(user.id).toBe('federation:customer-ops');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT treat a Keycloak HUMAN session (email + sid, azp=project-ops) as a federation actor', async () => {
    const human = { id: 'u-human', role: 'ADMIN' };
    const spy = jest
      .spyOn(svc, 'validateKeycloakUser' as any)
      .mockResolvedValue(human as any);

    const user = (await svc.validateJwtPayload({
      iss: 'https://auth.unicorncommander.ai/realms/uchub',
      azp: 'project-ops',
      aud: 'account',
      sub: 'aaron-uuid',
      email: 'aaron@magicunicorn.tech',
      sid: 'session-1',
    } as any)) as any;

    expect(spy).toHaveBeenCalledTimes(1);
    expect(user).toBe(human);
    expect(user.__isFederationActor).toBeUndefined();
  });
});
