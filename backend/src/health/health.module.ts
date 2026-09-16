import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';
import { PrismaHealthIndicator } from './prisma.health';
import { IntegrationsHealthService } from './integrations.health';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [TerminusModule, HttpModule, PrismaModule],
  controllers: [HealthController, VersionController],
  providers: [PrismaHealthIndicator, IntegrationsHealthService],
})
export class HealthModule {}
