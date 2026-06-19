import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `PATCH /agents/activity/:id/billable` — flag (or un-flag) a single
 * agent event as billable. The light billing hook: a billable event's `costUsd`
 * is summed into the `billableCostUsd` rollups. Full Accounting-Ops agent-billing
 * (turning billable cost into invoice lines) is OUT of scope — see the TODO on
 * AgentEventsService.setBillable.
 */
export class SetBillableDto {
  @ApiProperty({ description: 'Whether this agent event should count as billable.', example: true })
  @IsBoolean()
  billable: boolean;
}
