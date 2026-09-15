import {
  isHumanSessionPayload,
  isKeycloakServiceAccountPayload,
  isMachineFederationPayload,
  parseFederationActors,
  readActorClientId,
} from './federation-token';

describe('parseFederationActors', () => {
  it('is empty for unset / blank (zero trust)', () => {
    expect(parseFederationActors(undefined).size).toBe(0);
    expect(parseFederationActors('').size).toBe(0);
    expect(parseFederationActors('  , , ').size).toBe(0);
  });

  it('parses the dogfood CSV (meeting-ops, customer-ops)', () => {
    expect(parseFederationActors('meeting-ops,customer-ops')).toEqual(
      new Set(['meeting-ops', 'customer-ops']),
    );
    expect(parseFederationActors(' contact-ops, meeting-ops ')).toEqual(
      new Set(['contact-ops', 'meeting-ops']),
    );
  });
});

describe('isHumanSessionPayload / readActorClientId', () => {
  it('detects a browser SSO token (email + sid)', () => {
    const human = {
      sub: 'user-uuid',
      email: 'aaron@magicunicorn.tech',
      azp: 'project-ops',
      sid: 'session-1',
      session_state: 'state-1',
    };
    expect(isHumanSessionPayload(human)).toBe(true);
    expect(isMachineFederationPayload(human)).toBe(false);
  });

  it('detects an on-behalf-of Brigade token (sub looks like an email)', () => {
    const obo = {
      sub: 'aaron@magicunicorn.tech',
      act: { client_id: 'meeting-ops' },
      aud: 'project-ops',
    };
    expect(isHumanSessionPayload(obo)).toBe(true);
    expect(readActorClientId(obo)).toBe('meeting-ops');
    expect(isMachineFederationPayload(obo)).toBe(false);
  });

  it('classifies a Keycloak client-credentials token (azp, no human session)', () => {
    const cc = {
      sub: 'b3b1f0a2-0000-7000-8000-000000000001',
      azp: 'meeting-ops',
      aud: 'account',
      preferred_username: 'service-account-meeting-ops',
    };
    expect(isHumanSessionPayload(cc)).toBe(false);
    expect(readActorClientId(cc)).toBe('meeting-ops');
    expect(isMachineFederationPayload(cc)).toBe(true);
  });

  it('prefers act.client_id over azp (Brigade token-exchange)', () => {
    const brigade = {
      sub: 'svc-uuid',
      azp: 'ignored-azp',
      act: { client_id: 'customer-ops' },
      aud: 'project-ops',
    };
    expect(readActorClientId(brigade)).toBe('customer-ops');
    expect(isMachineFederationPayload(brigade)).toBe(true);
  });

  it('falls back to client_id when azp is absent', () => {
    expect(readActorClientId({ sub: 'svc', client_id: 'customer-ops' })).toBe('customer-ops');
  });

  it('does not treat an empty email as a human identity', () => {
    const cc = { sub: 'svc-uuid', azp: 'customer-ops', email: '' };
    expect(isHumanSessionPayload(cc)).toBe(false);
    expect(isMachineFederationPayload(cc)).toBe(true);
  });
});

/**
 * L2c — uchub service-account tokens CARRY an email, so email must NEVER be a
 * machine-vs-human discriminator. These pin the REALISTIC uchub client_credentials
 * payload (decoded-claims evidence from Persephone, 2026-09-15) and the
 * service-account markers that must classify it as a machine token.
 */
describe('isHumanSessionPayload — uchub service-account tokens carry email (L2c)', () => {
  const uchubServiceAccount = (overrides: Record<string, unknown> = {}) => ({
    // Real uchub client_credentials token for the `project-ops` client:
    exp: 9999999999,
    iat: 9999999600,
    jti: '00000000-0000-0000-0000-000000000001',
    iss: 'https://auth.unicorncommander.ai/realms/uchub',
    aud: ['broker', 'account'],
    sub: '00000000-0000-7000-8000-000000000001',
    typ: 'Bearer',
    azp: 'project-ops',
    client_id: 'project-ops',
    scope: 'email user-attributes profile uc-identity',
    email_verified: true,
    name: 'service-account-project-ops',
    preferred_username: 'service-account-project-ops',
    given_name: 'service-account',
    family_name: 'project-ops',
    email: 'service-account-project-ops@magicunicorn.tech',
    clientHost: '10.10.0.11',
    clientAddress: '10.10.0.11',
    // NOTE: no sid / session_state.
    ...overrides,
  });

  it('classifies a REAL uchub service-account token (WITH email) as a MACHINE token', () => {
    const sa = uchubServiceAccount();
    expect(sa.email).toContain('@'); // the crux: email is present
    expect(isKeycloakServiceAccountPayload(sa)).toBe(true);
    expect(isHumanSessionPayload(sa)).toBe(false);
    expect(readActorClientId(sa)).toBe('project-ops');
    expect(isMachineFederationPayload(sa)).toBe(true);
  });

  it('classifies an allow-listed service-account token (azp=meeting-ops, WITH email) as machine', () => {
    const sa = uchubServiceAccount({
      azp: 'meeting-ops',
      client_id: 'meeting-ops',
      preferred_username: 'service-account-meeting-ops',
      email: 'service-account-meeting-ops@magicunicorn.tech',
    });
    expect(isHumanSessionPayload(sa)).toBe(false);
    expect(readActorClientId(sa)).toBe('meeting-ops');
    expect(isMachineFederationPayload(sa)).toBe(true);
  });

  it('classifies via clientHost when preferred_username is absent', () => {
    const sa = {
      sub: '00000000-0000-7000-8000-000000000001',
      azp: 'customer-ops',
      client_id: 'customer-ops',
      clientHost: '10.10.0.12',
      email: 'service-account-customer-ops@magicunicorn.tech',
    };
    expect(isKeycloakServiceAccountPayload(sa)).toBe(true);
    expect(isHumanSessionPayload(sa)).toBe(false);
    expect(readActorClientId(sa)).toBe('customer-ops');
  });

  it('classifies via client_id + no sid/session_state when other markers are absent', () => {
    const sa = {
      sub: '00000000-0000-7000-8000-000000000001',
      azp: 'meeting-ops',
      client_id: 'meeting-ops',
      email: 'service-account-meeting-ops@magicunicorn.tech',
    };
    expect(isKeycloakServiceAccountPayload(sa)).toBe(true);
    expect(isHumanSessionPayload(sa)).toBe(false);
  });

  it('still classifies a HUMAN browser SSO token with sid as human (even with email)', () => {
    const human = {
      sub: '00000000-0000-7000-8000-0000000000aa',
      azp: 'project-ops',
      email: 'aaron@magicunicorn.tech',
      preferred_username: 'aaron',
      sid: 'session-abc',
      session_state: 'state-abc',
    };
    expect(isKeycloakServiceAccountPayload(human)).toBe(false);
    expect(isHumanSessionPayload(human)).toBe(true);
    expect(isMachineFederationPayload(human)).toBe(false);
  });
});
