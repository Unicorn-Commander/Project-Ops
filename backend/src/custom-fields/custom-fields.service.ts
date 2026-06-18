import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { UpdateCustomFieldDto } from './dto/update-custom-field.dto';
import {
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldType,
  Prisma,
  User,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  KEY_PATTERN,
  MAX_KEY_LENGTH,
  MAX_OPTIONS,
  MAX_OPTION_LENGTH,
  MAX_TEXT_VALUE_LENGTH,
  slugifyKey,
} from './custom-fields.constants';

/** The two option-bearing types, isolated so the option rules live in one place. */
const OPTION_TYPES: ReadonlySet<CustomFieldType> = new Set([
  CustomFieldType.SELECT,
  CustomFieldType.MULTISELECT,
]);

/**
 * Custom-fields service: manages workspace-scoped field DEFINITIONS and exposes
 * `validateValues`, the shared helper the tasks + projects modules call to
 * coerce/validate custom-field VALUES on entity create/update.
 *
 * SUITE TENANCY (Phase 2): every definition read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All DB access goes through the
 * passed `tx`, never `this.prisma`, or it bypasses the GUC chokepoint. New rows
 * stamp `workspaceId` + `createdById`; `workspaceId` is threaded into every
 * `audit.log()`. Mirrors SavedViewsService. Inert while
 * PROJECT_OPS_TENANCY_ENABLED is off.
 *
 * `validateValues` deliberately takes the caller's `tx`: the tasks/projects
 * modules already run their create/update inside their own workspace tx, so
 * loading the definitions on that same `tx` keeps the read under the SAME RLS
 * scope (one workspace transaction, no cross-workspace leakage and no second
 * authorization).
 */
@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Definition CRUD
  // ---------------------------------------------------------------------------

  /** List the definitions for an entity, ordered by position then label. */
  async findAllForEntity(
    workspaceId: string,
    user: User,
    entity: CustomFieldEntity,
  ): Promise<CustomFieldDefinition[]> {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.customFieldDefinition.findMany({
          where: { entity },
          orderBy: [{ position: 'asc' }, { label: 'asc' }],
        }),
      workspaceId,
    );
  }

  /**
   * Create a definition. `key` is derived from `label` when omitted, validated
   * as a stable slug, and the unique(workspaceId, entity, key) is enforced
   * (409 on collision). `options` is normalized + required-non-empty for
   * SELECT/MULTISELECT and cleared for other types.
   */
  async create(
    workspaceId: string,
    user: User,
    dto: CreateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    const key = this.resolveKey(dto.key, dto.label);
    const options = this.normalizeOptions(dto.type, dto.options);

    let created: CustomFieldDefinition;
    try {
      created = await this.workspaceContext.runForUser(
        user,
        (tx) =>
          tx.customFieldDefinition.create({
            data: {
              workspaceId,
              createdById: user.id,
              entity: dto.entity,
              key,
              label: dto.label,
              type: dto.type,
              options: options ?? Prisma.DbNull,
              required: dto.required ?? false,
              position: dto.position ?? 0,
            },
          }),
        workspaceId,
      );
    } catch (err) {
      // unique(workspaceId, entity, key) collision -> 409 with a clear message.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A custom field with key "${key}" already exists for ${dto.entity}`,
        );
      }
      throw err;
    }

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      action: 'CREATE',
      resource: 'CustomFieldDefinition',
      resourceId: created.id,
      details: { entity: created.entity, key: created.key, type: created.type },
    });

    this.logger.log(
      `CustomFieldDefinition created ${created.entity}.${created.key} by user ${user.id} ws=${workspaceId}`,
    );
    return created;
  }

  /**
   * Load one definition inside an existing workspace tx (RLS-scoped). 404s if
   * absent / not in this workspace. Shared by update + remove so the read +
   * write run in ONE workspace transaction (no TOCTOU across two txns).
   */
  private async loadInTx(
    tx: WorkspaceTxClient,
    id: string,
  ): Promise<CustomFieldDefinition> {
    const def = await tx.customFieldDefinition.findUnique({ where: { id } });
    if (!def) {
      throw new NotFoundException(`Custom field with ID ${id} not found`);
    }
    return def;
  }

  /**
   * Update a definition (label / type / options / required / position).
   * `key` and `entity` are immutable (not in the DTO). When `type` and/or
   * `options` change, options are re-normalized against the RESULTING type
   * (so switching to SELECT requires options, and switching away clears them).
   */
  async update(
    workspaceId: string,
    user: User,
    id: string,
    dto: UpdateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    const updated = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const existing = await this.loadInTx(tx, id);

        const data: Prisma.CustomFieldDefinitionUpdateInput = {};
        if (dto.label !== undefined) data.label = dto.label;
        if (dto.required !== undefined) data.required = dto.required;
        if (dto.position !== undefined) data.position = dto.position;

        // Resolve the effective type, then re-derive options whenever EITHER
        // type or options is being changed (a SELECT->TEXT switch must clear
        // stale options; a TEXT->SELECT switch must require them).
        const effectiveType = dto.type ?? existing.type;
        if (dto.type !== undefined) data.type = dto.type;
        if (dto.type !== undefined || dto.options !== undefined) {
          const nextOptions = this.normalizeOptions(
            effectiveType,
            dto.options ?? this.optionsArray(existing.options),
          );
          data.options = nextOptions ?? Prisma.DbNull;
        }

        return tx.customFieldDefinition.update({ where: { id }, data });
      },
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      action: 'UPDATE',
      resource: 'CustomFieldDefinition',
      resourceId: id,
      details: { fields: Object.keys(dto).filter((k) => (dto as any)[k] !== undefined) },
    });

    this.logger.log(`CustomFieldDefinition ${id} updated by user ${user.id} ws=${workspaceId}`);
    return updated;
  }

  /** Delete a definition. (Existing values in entity metadata are left as-is.) */
  async remove(workspaceId: string, user: User, id: string): Promise<CustomFieldDefinition> {
    const deleted = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        await this.loadInTx(tx, id);
        return tx.customFieldDefinition.delete({ where: { id } });
      },
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      action: 'DELETE',
      resource: 'CustomFieldDefinition',
      resourceId: id,
    });

    this.logger.log(`CustomFieldDefinition ${id} deleted by user ${user.id} ws=${workspaceId}`);
    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Shared value validation (imported by tasks + projects modules)
  // ---------------------------------------------------------------------------

  /**
   * Validate + coerce a map of custom-field VALUES for `entity` against this
   * workspace's definitions, INSIDE the caller's workspace tx.
   *
   * Behavior:
   *  - Loads the workspace's definitions for `entity` on `tx` (same RLS scope).
   *  - Unknown keys (no matching definition) are STRIPPED (ignored).
   *  - Each provided value is coerced + validated by its definition's type:
   *      TEXT        -> string (length-capped)
   *      NUMBER      -> finite number (accepts numeric strings)
   *      DATE        -> ISO-8601 date string (stored normalized via Date#toISOString)
   *      BOOLEAN     -> boolean (accepts true/false and "true"/"false")
   *      SELECT      -> exactly one of the definition's options
   *      MULTISELECT -> array that is a subset of the definition's options (deduped)
   *  - A `required` field that is missing/empty -> BadRequestException.
   *  - An explicit null/undefined for a non-required field clears it (omitted
   *    from the result); for a required field it is an error.
   *
   * Returns the normalized values object, intended to be stored under the
   * entity's `metadata.customFields`. The result contains ONLY keys that map to
   * a definition and that had a present value (cleared/absent optionals are
   * omitted), so callers can persist it as the authoritative customFields map.
   *
   * @param tx        the caller's workspace transaction client (RLS-scoped)
   * @param workspaceId the active workspace (definitions are already fenced by RLS;
   *                    passed for clarity/logging — the tx is what scopes the read)
   * @param entity    TASK | PROJECT
   * @param incoming  raw values keyed by field key
   */
  async validateValues(
    tx: WorkspaceTxClient,
    workspaceId: string,
    entity: CustomFieldEntity,
    incoming: Record<string, any> | null | undefined,
  ): Promise<Record<string, any>> {
    const definitions = await tx.customFieldDefinition.findMany({
      where: { entity },
    });

    const values = incoming ?? {};
    const out: Record<string, any> = {};

    for (const def of definitions) {
      const provided = Object.prototype.hasOwnProperty.call(values, def.key);
      const raw = provided ? values[def.key] : undefined;

      if (this.isEmpty(raw)) {
        if (def.required) {
          throw new BadRequestException(
            `Custom field "${def.label}" (${def.key}) is required`,
          );
        }
        // Optional + empty -> cleared (omit from result).
        continue;
      }

      out[def.key] = this.coerceValue(def, raw);
    }

    return out;
  }

  /**
   * Convenience wrapper for callers NOT already inside a workspace tx: opens one
   * for `user` and runs `validateValues` within it. Most callers should prefer
   * the `tx`-taking overload (validate + persist in one transaction); this is for
   * standalone validation (e.g. a pre-save check).
   */
  async validateValuesForUser(
    user: User,
    workspaceId: string,
    entity: CustomFieldEntity,
    incoming: Record<string, any> | null | undefined,
  ): Promise<Record<string, any>> {
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.validateValues(tx, workspaceId, entity, incoming),
      workspaceId,
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Coerce + validate a single non-empty value against its definition. */
  private coerceValue(def: CustomFieldDefinition, raw: any): any {
    switch (def.type) {
      case CustomFieldType.TEXT: {
        if (typeof raw !== 'string') {
          throw this.badValue(def, 'must be a string');
        }
        if (raw.length > MAX_TEXT_VALUE_LENGTH) {
          throw this.badValue(def, `must be at most ${MAX_TEXT_VALUE_LENGTH} characters`);
        }
        return raw;
      }

      case CustomFieldType.NUMBER: {
        const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (typeof num !== 'number' || !Number.isFinite(num)) {
          throw this.badValue(def, 'must be a number');
        }
        return num;
      }

      case CustomFieldType.DATE: {
        // Accept a Date or a parseable date string; store as an ISO-8601 string.
        const date = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : null;
        if (!date || Number.isNaN(date.getTime())) {
          throw this.badValue(def, 'must be a valid ISO date');
        }
        return date.toISOString();
      }

      case CustomFieldType.BOOLEAN: {
        if (typeof raw === 'boolean') return raw;
        if (raw === 'true') return true;
        if (raw === 'false') return false;
        throw this.badValue(def, 'must be a boolean');
      }

      case CustomFieldType.SELECT: {
        const opts = this.optionsArray(def.options);
        if (typeof raw !== 'string' || !opts.includes(raw)) {
          throw this.badValue(def, `must be one of: ${opts.join(', ')}`);
        }
        return raw;
      }

      case CustomFieldType.MULTISELECT: {
        if (!Array.isArray(raw)) {
          throw this.badValue(def, 'must be an array of options');
        }
        const opts = this.optionsArray(def.options);
        const deduped = Array.from(new Set(raw));
        for (const v of deduped) {
          if (typeof v !== 'string' || !opts.includes(v)) {
            throw this.badValue(def, `each value must be one of: ${opts.join(', ')}`);
          }
        }
        return deduped;
      }

      default: {
        // Exhaustiveness guard: a new CustomFieldType must be handled above.
        throw this.badValue(def, 'has an unsupported type');
      }
    }
  }

  private badValue(def: CustomFieldDefinition, why: string): BadRequestException {
    return new BadRequestException(`Custom field "${def.label}" (${def.key}) ${why}`);
  }

  /**
   * A value counts as "empty" (i.e. not provided) when it is null/undefined, an
   * empty/whitespace-only string, or an empty array. Notably `false` and `0` are
   * NOT empty — they are legitimate BOOLEAN / NUMBER values.
   */
  private isEmpty(raw: any): boolean {
    if (raw === null || raw === undefined) return true;
    if (typeof raw === 'string') return raw.trim().length === 0;
    if (Array.isArray(raw)) return raw.length === 0;
    return false;
  }

  /** Resolve + validate the definition key (explicit or derived from label). */
  private resolveKey(explicit: string | undefined, label: string): string {
    const key = explicit?.trim() ? explicit.trim() : slugifyKey(label);
    if (!key) {
      throw new BadRequestException(
        'Could not derive a key from the label; provide an explicit `key`',
      );
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(`key must be at most ${MAX_KEY_LENGTH} characters`);
    }
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'key must be a slug: a lowercase letter followed by lowercase letters, digits, or underscores',
      );
    }
    return key;
  }

  /**
   * Normalize a definition's `options` against its type. For SELECT/MULTISELECT:
   * requires a non-empty array of non-empty strings, dedupes, and enforces the
   * count/length caps. For non-option types: returns null (options are cleared).
   */
  private normalizeOptions(
    type: CustomFieldType,
    options: string[] | null | undefined,
  ): string[] | null {
    if (!OPTION_TYPES.has(type)) {
      return null;
    }
    if (!Array.isArray(options) || options.length === 0) {
      throw new BadRequestException(`options is required and must be non-empty for ${type}`);
    }
    const cleaned: string[] = [];
    for (const opt of options) {
      if (typeof opt !== 'string' || opt.trim().length === 0) {
        throw new BadRequestException('each option must be a non-empty string');
      }
      const trimmed = opt.trim();
      if (trimmed.length > MAX_OPTION_LENGTH) {
        throw new BadRequestException(`each option must be at most ${MAX_OPTION_LENGTH} characters`);
      }
      if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
    }
    if (cleaned.length > MAX_OPTIONS) {
      throw new BadRequestException(`a field may have at most ${MAX_OPTIONS} options`);
    }
    return cleaned;
  }

  /** Read a definition's stored `options` JSON as a string[] (or [] if absent/!array). */
  private optionsArray(options: Prisma.JsonValue | null | undefined): string[] {
    return Array.isArray(options) ? (options as string[]) : [];
  }
}
