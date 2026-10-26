import { generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AuthService } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

let jwksPublicKey = '';

// The strategy receives a test JWKS client, never a live endpoint. The key is
// generated below for this test process and is not a repository credential.
jest.mock('jwks-rsa', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    getSigningKey: (_kid: string, callback: (error: Error | null, key?: any) => void) =>
      callback(null, { getPublicKey: () => jwksPublicKey }),
  })),
}));

const publicKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
jwksPublicKey = publicKeyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();

const REALM_ISSUER = 'https://auth.example.com/realms/uchub';
const LOCAL_SECRET = 'synthetic-local-secret-for-signature-tests';

function makeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_SECRET: LOCAL_SECRET,
    KEYCLOAK_URL: 'https://auth.example.com',
    KEYCLOAK_REALM: 'uchub',
    KEYCLOAK_CLIENT_ID: 'project-ops',
    BRIGADE_TRUSTED_ISSUERS: '',
  };
  return {
    get: <T>(key: string, fallback?: T) => (values[key] ?? fallback) as T,
  } as unknown as ConfigService;
}

function makeStrategy(validate = jest.fn(async () => ({ id: 'synthetic-user' }) as any)) {
  return {
    strategy: new JwtStrategy(makeConfig(), {
      validateJwtPayload: validate,
    } as unknown as AuthService),
    validate,
  };
}

function signedRealmToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: 'synthetic-user',
      iss: REALM_ISSUER,
      azp: 'project-ops',
      aud: 'account',
      iat: now - 10,
      exp: now + 300,
      ...overrides,
    },
    publicKeyPair.privateKey,
    { algorithm: 'RS256', keyid: 'test-jwks-key' },
  );
}

function authenticate(
  strategy: JwtStrategy,
  token: string,
): Promise<{
  kind: 'success' | 'fail' | 'error';
  value: unknown;
}> {
  return new Promise((resolve) => {
    const instance = strategy as any;
    instance.success = (user: unknown) => resolve({ kind: 'success', value: user });
    instance.fail = (info: unknown) => resolve({ kind: 'fail', value: info });
    instance.error = (error: unknown) => resolve({ kind: 'error', value: error });
    instance.authenticate({ headers: { authorization: `Bearer ${token}` } });
  });
}

describe('JwtStrategy signed Keycloak verification', () => {
  it('accepts a signed RS256 realm token whose azp targets Project Ops', async () => {
    const { strategy, validate } = makeStrategy();
    const result = await authenticate(strategy, signedRealmToken());

    expect(result.kind).toBe('success');
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('rejects a signed realm token with a sibling audience after signature verification', async () => {
    const { strategy, validate } = makeStrategy();
    const result = await authenticate(strategy, signedRealmToken({ azp: 'sibling-app' }));

    expect(result.kind).toBe('error');
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects an expired signed realm token before user resolution', async () => {
    const { strategy, validate } = makeStrategy();
    const result = await authenticate(
      strategy,
      signedRealmToken({
        iat: Math.floor(Date.now() / 1000) - 600,
        exp: Math.floor(Date.now() / 1000) - 300,
      }),
    );

    expect(result.kind).toBe('fail');
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects an HS256 token that claims the Keycloak issuer', async () => {
    const { strategy, validate } = makeStrategy();
    const token = jwt.sign(
      { sub: 'synthetic-user', iss: REALM_ISSUER, azp: 'project-ops' },
      LOCAL_SECRET,
      { algorithm: 'HS256' },
    );
    const result = await authenticate(strategy, token);

    expect(result.kind).toBe('fail');
    expect(validate).not.toHaveBeenCalled();
  });

  it('keeps the separate local HS256 session path working', async () => {
    const { strategy, validate } = makeStrategy();
    const token = jwt.sign({ sub: 'synthetic-user' }, LOCAL_SECRET, { algorithm: 'HS256' });
    const result = await authenticate(strategy, token);

    expect(result.kind).toBe('success');
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('rejects a signed RS256 token from an unconfigured issuer', async () => {
    const { strategy, validate } = makeStrategy();
    const result = await authenticate(
      strategy,
      jwt.sign(
        { sub: 'synthetic-user', iss: 'https://other.example.com', azp: 'project-ops' },
        publicKeyPair.privateKey,
        { algorithm: 'RS256', keyid: 'test-jwks-key' },
      ),
    );

    expect(result.kind).toBe('fail');
    expect(validate).not.toHaveBeenCalled();
  });
});
