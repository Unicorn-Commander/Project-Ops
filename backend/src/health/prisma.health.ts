import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private prismaService: PrismaService,
    private healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    return this.healthIndicatorService.check(key).attempt(async () => {
      await this.prismaService.$queryRaw`SELECT 1`;
    });
  }
}
