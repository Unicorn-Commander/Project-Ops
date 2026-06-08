import { Module } from '@nestjs/common';
import { TriageService } from './triage.service';
import { TriageController } from './triage.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';

/**
 * Project-Ops Triage Agent module (PO-owned).
 *
 * Depends on ProjectsModule + TasksModule for the apply step (create project /
 * create task on approval) and PrismaModule for the TriageProposal store.
 * ConfigService comes from the global ConfigModule. Inference endpoints
 * (Infinity + Qwen) are reached over the LAN via env (see triage.service).
 */
@Module({
  imports: [PrismaModule, ProjectsModule, TasksModule],
  controllers: [TriageController],
  providers: [TriageService],
  exports: [TriageService],
})
export class TriageModule {}
