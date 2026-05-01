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

const makeStrategy = (validate: AuthService['validateJwtPayload']) => {
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'test-secret' : undefined) } as ConfigService;
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
