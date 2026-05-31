import { ConfigService } from '@nestjs/config';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
  type JsonWebKey,
} from 'crypto';
import { BrigadeJwtVerifier, type JwksFetcher } from './brigade-jwt.verifier';

/**
 * Verifier unit tests against a MOCKED JWKS (in-memory key set). These cover
 * the spec test cases that do not require a live Brigade broker:
 *   3. forged/wrong-key JWT -> rejected
 *   5. wrong audience       -> rejected
 *   6. expired              -> rejected
 *   7. wrong key            -> rejected
 *   + wrong issuer + unknown kid + caching + scope helper
 * Cases 1/2/4/8 (real PAT path unchanged, real Brigade JWT, JWKS rotation in
 * prod) are validated against the real broker once it ships its JWKS.
 *
 * Tokens are EdDSA-signed by hand with node crypto because jsonwebtoken cannot
 * sign or verify EdDSA -- which is exactly why the verifier itself uses raw
 * crypto rather than jsonwebtoken.
 */

const ISSUER = 'https://brigade.unicorncommander.ai';
const AUDIENCE = 'project-ops';
const KID = 'brigade-test-key-1';

const config = {
  get: (key: string, def?: unknown) =>
    (({
      BRIGADE_TRUSTED_ISSUER: ISSUER,
      BRIGADE_EXPECTED_AUDIENCE: AUDIENCE,
    } as Record<string, unknown>)[key] ?? def),
} as unknown as ConfigService;

const b64url = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

// "5m" -> 300, "-60s" -> -60
function durSeconds(s: string): number {
  const m = /^(-?\d+)(s|m|h)$/.exec(s);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return n * { s: 1, m: 60, h: 3600 }[m[2] as 's' | 'm' | 'h'];
}

describe('BrigadeJwtVerifier', () => {
  let signing: { publicKey: KeyObject; privateKey: KeyObject };
  let stranger: { publicKey: KeyObject; privateKey: KeyObject };
  let fetchCount: number;
  let fetcher: JwksFetcher;
  let verifier: BrigadeJwtVerifier;

  function mint(
    priv: KeyObject,
    opts: {
      aud?: string;
      iss?: string;
      expiresIn?: string;
      sub?: string;
      scopes?: string[];
      kid?: string;
    } = {},
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'EdDSA', typ: 'JWT', kid: opts.kid ?? KID };
    const payload = {
      sub: opts.sub ?? 'user-uuid-123',
      iss: opts.iss ?? ISSUER,
      aud: opts.aud ?? AUDIENCE,
      iat: now,
      exp: now + durSeconds(opts.expiresIn ?? '5m'),
      scopes: opts.scopes ?? ['read:projects'],
    };
    const h = b64url(header);
    const p = b64url(payload);
    const sig = cryptoSign(null, Buffer.from(`${h}.${p}`), priv).toString(
      'base64url',
    );
    return `${h}.${p}.${sig}`;
  }

  beforeEach(() => {
    signing = generateKeyPairSync('ed25519');
    stranger = generateKeyPairSync('ed25519');
    const jwk = signing.publicKey.export({ format: 'jwk' }) as JsonWebKey;
    fetchCount = 0;
    fetcher = async () => {
      fetchCount++;
      return { keys: [{ ...jwk, kid: KID, alg: 'EdDSA', use: 'sig' }] };
    };
    verifier = new BrigadeJwtVerifier(config, fetcher);
  });

  it('accepts a valid Brigade JWT and returns claims', async () => {
    const claims = await verifier.verify(
      mint(signing.privateKey, { sub: 'aaron-uuid' }),
    );
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('aaron-uuid');
    expect(claims!.iss).toBe(ISSUER);
    expect(fetchCount).toBe(1); // JWKS fetched once and cached
  });

  it('caches the JWKS across calls (no refetch on a known kid)', async () => {
    await verifier.verify(mint(signing.privateKey));
    await verifier.verify(mint(signing.privateKey));
    expect(fetchCount).toBe(1);
  });

  it('rejects a JWT with the wrong audience', async () => {
    expect(
      await verifier.verify(mint(signing.privateKey, { aud: 'meeting-ops' })),
    ).toBeNull();
  });

  it('rejects a JWT with the wrong issuer', async () => {
    expect(
      await verifier.verify(
        mint(signing.privateKey, { iss: 'https://evil.example.com' }),
      ),
    ).toBeNull();
  });

  it('rejects an expired JWT', async () => {
    // 60s in the past, beyond the 30s clock-tolerance.
    expect(
      await verifier.verify(mint(signing.privateKey, { expiresIn: '-60s' })),
    ).toBeNull();
  });

  it('rejects a JWT signed by a key not in the JWKS (forged)', async () => {
    expect(await verifier.verify(mint(stranger.privateKey))).toBeNull();
  });

  it('rejects a JWT with an unknown kid', async () => {
    expect(
      await verifier.verify(mint(signing.privateKey, { kid: 'rotated-away' })),
    ).toBeNull();
  });

  it('rejects empty / garbage tokens', async () => {
    expect(await verifier.verify('')).toBeNull();
    expect(await verifier.verify('not.a.jwt')).toBeNull();
  });

  it('hasScope reads array and space-delimited scope claims', () => {
    expect(
      BrigadeJwtVerifier.hasScope(
        { sub: 'x', scopes: ['read:projects', 'write:tasks'] },
        'write:tasks',
      ),
    ).toBe(true);
    expect(
      BrigadeJwtVerifier.hasScope(
        { sub: 'x', scopes: 'read:projects write:tasks' },
        'write:billing',
      ),
    ).toBe(false);
  });
});
