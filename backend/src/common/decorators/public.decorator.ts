import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by JwtAuthGuard to skip authentication for a route.
 * (The guard already consults this key; this decorator is the canonical,
 * type-safe way to set it instead of a bare `SetMetadata('isPublic', true)`.)
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as unauthenticated — JwtAuthGuard returns early
 * without requiring a bearer token.
 *
 * Needed now that JwtAuthGuard is a GLOBAL guard (APP_GUARD): without this flag,
 * the global guard would 401 the handful of legitimately-public routes (login,
 * Keycloak SSO redirect/callback, client-portal signup, health, version).
 *
 *   @Public()
 *   @Get('health') ...
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
