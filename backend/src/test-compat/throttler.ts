import { Injectable, Inject, Module, SetMetadata } from '@nestjs/common';
import type { DynamicModule, ExecutionContext } from '@nestjs/common';

export type ThrottlerModuleOptions = Array<{
  name?: string;
  ttl: number;
  limit: number;
}>;

// These are type-only in the real package, but CJS consumers can still emit
// runtime imports for them. Keep the ESM test shim link-compatible.
export const ThrottlerModuleOptions = Symbol('ThrottlerModuleOptions');

export type ThrottlerStorage = {
  increment?: (...args: any[]) => Promise<unknown>;
};

export const ThrottlerStorage = Symbol('ThrottlerStorage');

const THROTTLER_OPTIONS = Symbol('THROTTLER_OPTIONS');
const THROTTLER_STORAGE = Symbol('THROTTLER_STORAGE');

export function InjectThrottlerOptions(): ParameterDecorator {
  return Inject(THROTTLER_OPTIONS);
}

export function InjectThrottlerStorage(): ParameterDecorator {
  return Inject(THROTTLER_STORAGE);
}

export function SkipThrottle(metadata: Record<string, boolean> = {}): MethodDecorator & ClassDecorator {
  return SetMetadata('THROTTLER:SKIP', metadata);
}

export function Throttle(metadata: Record<string, { limit: number; ttl: number }>): MethodDecorator & ClassDecorator {
  return SetMetadata('THROTTLER:LIMIT', metadata);
}

@Injectable()
export class ThrottlerGuard {
  constructor(
    protected readonly options: ThrottlerModuleOptions,
    protected readonly storageService: ThrottlerStorage,
    protected readonly reflector: unknown,
  ) {}

  protected async getTracker(request: Record<string, any>): Promise<string> {
    return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }

  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

@Module({})
export class ThrottlerModule {
  static forRoot(options: ThrottlerModuleOptions): DynamicModule {
    return {
      module: ThrottlerModule,
      providers: [
        { provide: THROTTLER_OPTIONS, useValue: options },
        { provide: THROTTLER_STORAGE, useValue: {} },
      ],
      exports: [THROTTLER_OPTIONS, THROTTLER_STORAGE],
    };
  }
}
