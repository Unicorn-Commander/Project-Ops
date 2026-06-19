import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
// AgentsModule exports AgentEventsService — AssistantService injects it
// @Optional() to record each assistant turn as an agent activity event
// (actorKind=ASSISTANT, via=ASSISTANT).
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [AgentsModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
