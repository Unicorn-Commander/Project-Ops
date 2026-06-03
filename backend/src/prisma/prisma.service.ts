import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected successfully');

    await this.ensureTimeTrackingConstraints();

    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      this.$on('query' as never, (e: any) => {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      });
    }

    this.$on('error' as never, (e: any) => {
      this.logger.error(`Prisma Error: ${e.message}`);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }

  /**
   * Apply DB-level invariants that `prisma db push` can't express.
   *
   * The time-tracking spine requires "at most ONE running entry
   * (endedAt IS NULL) per user". A partial unique index is the only way
   * to guarantee this under concurrency, and Prisma's schema language has
   * no syntax for a partial (`WHERE`) unique index — so we create it here,
   * idempotently, right after connect. `IF NOT EXISTS` makes re-runs free.
   *
   * Failures are logged, not thrown: a fresh DB that hasn't had
   * `prisma db push` run yet won't have the table, and that must not crash
   * boot. Once the table exists the index lands on the next boot.
   */
  private async ensureTimeTrackingConstraints(): Promise<void> {
    try {
      await this.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_time_entry_one_running" ` +
          `ON "time_entries" ("userId") WHERE "endedAt" IS NULL`,
      );
      this.logger.log('Time-tracking constraints ensured (single-running-timer index)');
    } catch (error) {
      this.logger.warn(
        `Could not ensure time-tracking constraints (table may not exist yet): ${
          (error as Error).message
        }`,
      );
    }
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot clean database in production!');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => key[0] !== '_' && typeof key === 'string',
    );

    return Promise.all(
      models.map((modelKey) => {
        const model = this[modelKey as keyof typeof this];
        if (model && typeof model === 'object' && 'deleteMany' in model) {
          return (model as any).deleteMany();
        }
      }),
    );
  }
}