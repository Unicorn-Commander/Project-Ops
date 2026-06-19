import { IsBoolean, IsIn, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_PREFERENCE_KEYS, PreferenceKey } from '../notification-preferences';

/**
 * Per-event-type enablement map for the PATCH body. Every field is optional (a
 * PATCH only touches the keys it sends) and must be a boolean. Unknown keys are
 * rejected by `forbidNonWhitelisted` on the global ValidationPipe AND defensively
 * dropped by the merge in the service, so a typo'd key can never silently create
 * an unmapped preference.
 */
export class UpdateEventPreferencesDto {
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() task_assigned?: boolean;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() mention?: boolean;
  @ApiPropertyOptional({ example: false }) @IsOptional() @IsBoolean() task_comment?: boolean;
  @ApiPropertyOptional({ example: true }) @IsOptional() @IsBoolean() approval_requested?: boolean;
  @ApiPropertyOptional({ example: false }) @IsOptional() @IsBoolean() task_status_changed?: boolean;
  @ApiPropertyOptional({ example: false }) @IsOptional() @IsBoolean() task_completed?: boolean;
  @ApiPropertyOptional({ example: false }) @IsOptional() @IsBoolean() task_created?: boolean;
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  project_status_changed?: boolean;
  @ApiPropertyOptional({ example: false }) @IsOptional() @IsBoolean() project_created?: boolean;
}

/** RESERVED forward-compat digest block. Validated but NOT consumed (immediate-send only). */
export class UpdateDigestDto {
  @ApiPropertyOptional({ example: false }) @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional({ enum: ['daily', 'weekly'], example: 'daily' })
  @IsOptional()
  @IsIn(['daily', 'weekly'])
  frequency?: 'daily' | 'weekly';
}

/**
 * Body of `PATCH /notifications/preferences`. A PARTIAL update: send only the
 * master `email` toggle and/or the `events` keys you want to change. Anything
 * omitted is left at its current value.
 */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Master email switch. When false, no notification emails are sent at all.',
  })
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional({
    type: UpdateEventPreferencesDto,
    description: `Per-event-type email toggles. Known keys: ${ALL_PREFERENCE_KEYS.join(', ')}.`,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateEventPreferencesDto)
  events?: Partial<Record<PreferenceKey, boolean>>;

  @ApiPropertyOptional({
    type: UpdateDigestDto,
    description: 'RESERVED — digest/batching is not implemented yet (immediate per-event email).',
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateDigestDto)
  digest?: { enabled: boolean; frequency?: 'daily' | 'weekly' };
}
