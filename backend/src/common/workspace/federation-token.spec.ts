import {
  isHumanSessionPayload,
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
