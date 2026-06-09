/**
 * Targeted tests for JwtStrategy.validate — the chokepoint every
 * authenticated request goes through.
 *
 * The strategy is deliberately thin: it delegates to
 * AuthService.validateJwtPayload and translates failures into
 * UnauthorizedException. Tests pin both directions so a future
 * refactor can't accidentally silence a missing-user error or stop
 * resolving the User on the request.
 */

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '@prisma/client';
import { AuthService, JwtPayload } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';

const fakePayload: JwtPayload = {
  sub: 'user-id',
  email: 'aaron@example.com',
  role: 'ADMIN',
  username: 'aaron',
};

const fakeUser = {
  id: 'user-id',
  email: 'aaron@example.com',
  username: 'aaron',
  role: UserRole.ADMIN,
  isActive: true,
} as User;

const BRIGADE_ISS = 'https://brigade.unicorncommander.ai';

const makeStrategy = (
  validate: AuthService['validateJwtPayload'],
  configOverrides: Record<string, string | undefined> = {},
) => {
  const base: Record<string, string | undefined> = {
    JWT_SECRET: 'test-secret',
    // Pin the Brigade trusted issuer + the expected (project-ops) audience so
    // the audience-binding branch is exercised deterministically.
    BRIGADE_TRUSTED_ISSUERS: BRIGADE_ISS,
    BRIGADE_EXPECTED_AUDIENCE: 'project-ops',
    ...configOverrides,
  };
  const config = { get: (k: string) => base[k] } as ConfigService;
  const auth = { validateJwtPayload: validate } as unknown as AuthService;
  return new JwtStrategy(config, auth);
};

describe('JwtStrategy.validate', () => {
  it('returns the resolved User when the payload is valid', async () => {
    const strategy = makeStrategy(async () => fakeUser);
    await expect(strategy.validate(fakePayload)).resolves.toEqual(fakeUser);
  });

  it('translates an inactive/missing-user error into UnauthorizedException', async () => {
    const strategy = makeStrategy(async () => {
      throw new UnauthorizedException('User not found or inactive');
    });
    await expect(strategy.validate(fakePayload)).rejects.toThrow(UnauthorizedException);
  });

  it('translates an unexpected error into UnauthorizedException (not a 500)', async () => {
    // If the DB blips, we still want the request to fail closed as 401,
    // not bleed an internal error to the caller. This regression-checks
    // that the catch-all in validate() is actually catching everything.
    const strategy = makeStrategy(async () => {
      throw new Error('boom');
    });
    await expect(strategy.validate(fakePayload)).rejects.toThrow(UnauthorizedException);
  });
});

/**
 * Audience-binding regression — ported from the retired BrigadeJwtVerifier
 * spec (which exercised it on the dark verifier). The live JwtStrategy is now
 * the single auth chokepoint, so the cross-app fence (SUITE-IDENTITY §9.4 / PO
 * brief §7) is pinned here: a Brigade federation token minted for a DIFFERENT
 * app must be rejected by Project-Ops even though its signature + issuer would
 * otherwise verify. The signature/issuer resolution is covered by the
 * secretOrKeyProvider; these tests pin the post-verification `aud` gate that
 * runs in validate() for any Brigade-issued token.
 */
describe('JwtStrategy Brigade audience binding', () => {
  const brigadePayload = (aud: unknown): JwtPayload & { iss: string; aud: unknown } => ({
    sub: 'aaron-uuid',
    email: 'aaron@example.com',
    role: 'ADMIN',
    username: 'aaron',
    iss: BRIGADE_ISS,
    aud,
  });

  it('rejects a Brigade token whose aud is another app (accounting-ops)', async () => {
    // validateJwtPayload must NEVER be consulted for a wrong-audience token.
    const validate = jest.fn(async () => fakeUser);
    const strategy = makeStrategy(validate as unknown as AuthService['validateJwtPayload']);
    await expect(strategy.validate(brigadePayload('accounting-ops'))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(validate).not.toHaveBeenCalled();
  });

  it('rejects a Brigade token whose aud is meeting-ops', async () => {
    const strategy = makeStrategy(async () => fakeUser);
    await expect(strategy.validate(brigadePayload('meeting-ops'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a Brigade token with no aud claim at all', async () => {
    const strategy = makeStrategy(async () => fakeUser);
    await expect(strategy.validate(brigadePayload(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a Brigade token whose aud is project-ops (string)', async () => {
    const strategy = makeStrategy(async () => fakeUser);
    await expect(strategy.validate(brigadePayload('project-ops'))).resolves.toEqual(fakeUser);
  });

  it('accepts a Brigade token whose aud array includes project-ops', async () => {
    const strategy = makeStrategy(async () => fakeUser);
    await expect(
      strategy.validate(brigadePayload(['accounting-ops', 'project-ops'])),
    ).resolves.toEqual(fakeUser);
  });

  it('does NOT apply audience binding to non-Brigade tokens (local/keycloak)', async () => {
    // A local HS256 / Keycloak-realm token carries no Brigade iss; its (absent
    // or unrelated) aud must not be gated. fakePayload has no iss.
    const strategy = makeStrategy(async () => fakeUser);
    await expect(strategy.validate(fakePayload)).resolves.toEqual(fakeUser);
  });

  it('audienceMatches handles string and array aud', () => {
    expect(JwtStrategy.audienceMatches('project-ops', 'project-ops')).toBe(true);
    expect(JwtStrategy.audienceMatches('accounting-ops', 'project-ops')).toBe(false);
    expect(JwtStrategy.audienceMatches(['x', 'project-ops'], 'project-ops')).toBe(true);
    expect(JwtStrategy.audienceMatches(['x', 'y'], 'project-ops')).toBe(false);
    expect(JwtStrategy.audienceMatches(undefined, 'project-ops')).toBe(false);
  });
});
