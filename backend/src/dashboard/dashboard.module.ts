import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [ProjectsModule, UsersModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}