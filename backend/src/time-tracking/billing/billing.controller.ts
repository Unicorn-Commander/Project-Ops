import { Controller, Post, Body, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/workspace/current-workspace.decorator';
import { TimeTrackingEnabledGuard } from '../../common/workspace/time-tracking-enabled.guard';
import { WorkspaceMembershipGuard } from '../../common/workspace/workspace-membership.guard';
import { BillableRollupService } from './billable-rollup.service';
import { CreateBillableDraftDto } from '../dto/create-billable-draft.dto';

function bearerFrom(authHeader?: string): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1] : null;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, TimeTrackingEnabledGuard, WorkspaceMembershipGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('billing')
export class BillingController {
  constructor(private readonly rollup: BillableRollupService) {}

  @Post('drafts')
  @ApiOperation({
    summary:
      'Roll up approved unbilled time into a billable draft and (if live + entitled) an AO invoice',
  })
  createDraft(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateBillableDraftDto,
    @Headers('authorization') auth?: string,
  ) {
    return this.rollup.createBillableDraft(workspaceId, user, dto, {
      bearerToken: bearerFrom(auth),
      actingUser: { id: user.id, email: user.email },
    });
  }

  @Post('sync-invoice-status')
  @ApiOperation({ summary: 'Pull invoice status from Accounting-Ops and mirror onto projects' })
  syncStatus(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Headers('authorization') auth?: string,
  ) {
    return this.rollup.syncInvoiceStatuses(bearerFrom(auth), { workspaceId, user });
  }
}
