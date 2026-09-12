import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `quote.accepted` federation payload (QUOTES-CONTRACT-v1 §3 + Amendment 01).
 * Emitted by Customer-Ops (the quote's system of record) after acceptance;
 * consumed by POST /api/v1/federation/quotes/accepted. Money is INTEGER CENTS;
 * the billing block is computed by Customer-Ops through its single
 * `computeQuote` path (A4) — Project-Ops mirrors it and never re-derives.
 *
 * The global ValidationPipe runs with whitelist + forbidNonWhitelisted, so an
 * unknown key anywhere in this payload is a 400 (`status: failed`,
 * `code: VALIDATION`). Internal notes, the split rule and direct costs are
 * never part of this contract (§2.6, A3) and are therefore rejected.
 */

/** Every line kind a snapshot can carry (§1). Tasks are created for `one_time` + `milestone` only (A16). */
export const QUOTE_LINE_KINDS = [
  'one_time',
  'milestone',
  'recurring',
  'hourly',
  'option',
  'included',
  'excluded',
] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

/** The intervals a recurring line may bill on (§1 + Amendment 01 A8). */
export const QUOTE_RECURRING_INTERVALS = ['month', 'quarter', 'year'] as const;
export type QuoteRecurringInterval = (typeof QUOTE_RECURRING_INTERVALS)[number];

/**
 * One accepted recurring line, as Customer-Ops' `computeQuote` resolved it.
 * Project-Ops does NOT create a task or a schedule for these (§3: recurring
 * lines are narrative in `billingNotes` in v1) — they are carried so the
 * blended monthly figure on the cached summary is Project-Ops' own arithmetic
 * and never a number it had to be told twice.
 */
export class QuoteRecurringDto {
  @ApiProperty({ enum: QUOTE_RECURRING_INTERVALS, example: 'month' })
  @IsIn(QUOTE_RECURRING_INTERVALS as unknown as string[])
  interval: QuoteRecurringInterval;

  @ApiProperty({ example: 35000, description: 'Amount per period, integer cents' })
  @IsInt()
  @Min(0)
  amount_cents: number;

  @ApiPropertyOptional({ example: 'Managed hosting', description: 'Line label (informational)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  label?: string;
}

export class QuoteBillingDto {
  @ApiProperty({ example: 140000, description: 'Σ accepted one_time lines, integer cents' })
  @IsInt()
  @Min(0)
  one_time_total_cents: number;

  @ApiProperty({ example: 290000, description: 'Σ accepted milestone lines, integer cents' })
  @IsInt()
  @Min(0)
  milestone_total_cents: number;

  @ApiPropertyOptional({
    example: 215000,
    description:
      'Deposit Customer-Ops computed from the per-line payment_split (A5), integer cents. Accepted and echoed, NOT stored: the deposit is Accounting-Ops paper, and the Quote panel reads it live off the Customer-Ops summary.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  deposit_cents?: number;

  @ApiPropertyOptional({
    type: [QuoteRecurringDto],
    description:
      'Accepted recurring lines, one entry per line (A8). Absent/empty = no recurring commitment.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteRecurringDto)
  recurring?: QuoteRecurringDto[];

  @ApiPropertyOptional({
    example: 35000,
    description:
      'Optional pre-blended monthly equivalent. Used ONLY when `recurring` is absent; when both are present `recurring` wins (one compute path, A4).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  recurring_monthly_cents?: number;

  @ApiPropertyOptional({
    example: 15000,
    description:
      'Rate of the line flagged hourly.primary (A14), integer cents; absent when the quote has no hourly line',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  hourly_rate_cents?: number;

  @ApiProperty({
    example:
      '50% on acceptance, 50% on delivery of each milestone; hosting billed monthly in advance.',
    description:
      'Human schedule text; written verbatim into billingNotes after "Quote <number> v<version>: "',
  })
  @IsString()
  @MaxLength(4000)
  schedule_text: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'The accepted version the billing block was computed from (A14). Must equal the top-level version when present.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version_no?: number;
}

export class QuoteLineDto {
  @ApiProperty({ enum: QUOTE_LINE_KINDS, example: 'milestone' })
  @IsIn(QUOTE_LINE_KINDS as unknown as string[])
  kind: QuoteLineKind;

  @ApiProperty({ example: 'Milestone 2 — order pad on the shop floor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  label: string;

  @ApiPropertyOptional({ description: 'Markdown acceptance criteria → the task description' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  acceptance_criteria_md?: string;

  @ApiPropertyOptional({ example: 24, description: 'Effort estimate → task.estimatedHours' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimated_hours?: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Planned duration in weeks (recorded on the task metadata only)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  weeks?: number;

  @ApiProperty({
    example: 2,
    description: 'Order within the accepted snapshot; tasks are created ascending',
  })
  @IsInt()
  @Min(0)
  position: number;

  @ApiPropertyOptional({
    example: true,
    description:
      "The client's choice for option-group lines (A16). Default true. A line with selected=false never becomes a task.",
  })
  @IsOptional()
  @IsBoolean()
  selected?: boolean;

  @ApiPropertyOptional({
    example: 'package',
    description: 'Option group the line belongs to, if any',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  option_group?: string;

  @ApiPropertyOptional({
    description: 'Customer-Ops quote_lines.id, recorded on the task metadata for traceability',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  customer_ops_line_id?: string;
}

export class QuotePdfDto {
  @ApiPropertyOptional({
    example: 'https://customers.example.dev/api/quotes/<id>/versions/1/pdf?sig=...',
    description: 'Fetchable URL of the accepted PDF (http/https). Exactly one of url | base64.',
  })
  @ValidateIf((o: QuotePdfDto) => !o.base64)
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(4096)
  url?: string;

  @ApiPropertyOptional({
    description: 'Base64 PDF bytes (≤ 25 MB decoded). Exactly one of url | base64.',
  })
  @ValidateIf((o: QuotePdfDto) => !o.url)
  @IsString()
  @IsNotEmpty()
  base64?: string;

  @ApiProperty({ example: 'Q-2026-0001-v1.pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  file_name: string;
}

export class QuoteAcceptedDto {
  @ApiProperty({
    example: '0192b7c0-4b3a-7c1d-9e2f-3a4b5c6d7e8f',
    description: 'Customer-Ops quotes.id — idempotency key with version',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  customer_ops_quote_id: string;

  @ApiProperty({ example: 'Q-2026-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  number: string;

  @ApiProperty({ example: 1, description: 'The accepted version_no' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiProperty({ example: 'Order Pad for the apparel client' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @ApiProperty({ example: 'https://customers.example.dev/q/<token>' })
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  share_url: string;

  @ApiProperty({ example: 'The apparel client' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  client_name: string;

  @ApiPropertyOptional({
    description:
      'Project-Ops Contact id when known. Linked only if it resolves inside the target workspace; otherwise kept on metadata.quote.contact_id for reconciliation.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  contact_id?: string;

  @ApiProperty({
    example: 'USD',
    description: 'ISO 4217; v1 supports 2-decimal currencies only (A17)',
  })
  @IsString()
  @Length(3, 3)
  currency: string;

  // @ValidateNested alone does NOT fail on a MISSING object (class-validator
  // skips undefined), which would let a payload with no billing block reach the
  // adapter and blow up as a 500 instead of a clean 400 VALIDATION.
  @ApiProperty({ type: QuoteBillingDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => QuoteBillingDto)
  billing: QuoteBillingDto;

  @ApiProperty({ type: [QuoteLineDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines: QuoteLineDto[];

  @ApiPropertyOptional({
    type: QuotePdfDto,
    description: 'The accepted PDF. May arrive on a retry; added to the project once.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuotePdfDto)
  pdf?: QuotePdfDto;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Accounting-Ops schedule ids (A14). May arrive on a later call; merged into metadata.quote.schedule_ids idempotently.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  schedule_ids?: string[];

  @ApiPropertyOptional({
    example: '2026-09-12T18:04:00Z',
    description: 'When the client accepted (informational)',
  })
  @IsOptional()
  @IsDateString()
  accepted_at?: string;
}
