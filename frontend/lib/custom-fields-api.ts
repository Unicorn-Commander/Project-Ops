import api from './api';

// ── Custom fields ────────────────────────────────────────────────────────────
// A custom field is a workspace-defined attribute on a TASK or PROJECT. The
// backend stores only the DEFINITION as a row (CustomFieldDefinition); the
// VALUES live on the entity's `metadata.customFields` map, keyed by the
// definition `key`. The tasks/projects create+update payloads accept a
// `customFields: Record<string, any>` which the backend validates + normalizes
// against these definitions before merging it into `metadata.customFields`.
//
// Contract (all under /api/v1, via the shared axios instance — auth token +
// X-Workspace-Id are injected by lib/api.ts):
//   GET    /custom-fields?entity=TASK|PROJECT  -> CustomFieldDefinition[]
//   POST   /custom-fields                       -> CustomFieldDefinition
//   PATCH  /custom-fields/:id                    -> CustomFieldDefinition
//   DELETE /custom-fields/:id                    -> CustomFieldDefinition

export enum CustomFieldEntity {
  TASK = 'TASK',
  PROJECT = 'PROJECT',
}

export enum CustomFieldType {
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  DATE = 'DATE',
  SELECT = 'SELECT',
  MULTISELECT = 'MULTISELECT',
  BOOLEAN = 'BOOLEAN',
}

/** The two types that carry an `options` list. */
export const OPTION_TYPES: ReadonlySet<CustomFieldType> = new Set([
  CustomFieldType.SELECT,
  CustomFieldType.MULTISELECT,
]);

export interface CustomFieldDefinition {
  id: string;
  workspaceId: string;
  entity: CustomFieldEntity;
  /** Stable slug identity (immutable after create). */
  key: string;
  /** Human display name. */
  label: string;
  type: CustomFieldType;
  /** Allowed values for SELECT / MULTISELECT; null for other types. */
  options: string[] | null;
  required: boolean;
  /** Sort order within the entity (ascending). */
  position: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomFieldData {
  entity: CustomFieldEntity;
  /** Optional — auto-derived from `label` by the backend when omitted. */
  key?: string;
  label: string;
  type: CustomFieldType;
  /** Required + non-empty for SELECT / MULTISELECT; ignored otherwise. */
  options?: string[];
  required?: boolean;
  position?: number;
}

// `key` and `entity` are immutable; PATCH may change label/type/options/
// required/position. When `type` flips to/from an option type the backend
// re-normalizes `options` (clears them for non-option types, requires them
// for SELECT/MULTISELECT).
export type UpdateCustomFieldData = Partial<
  Pick<
    CreateCustomFieldData,
    'label' | 'type' | 'options' | 'required' | 'position'
  >
>;

/**
 * Custom-field VALUES on a task/project. Keyed by definition `key`:
 *   TEXT/SELECT -> string
 *   NUMBER      -> number
 *   DATE        -> ISO-8601 string
 *   BOOLEAN     -> boolean
 *   MULTISELECT -> string[]
 */
export type CustomFieldValueMap = Record<
  string,
  string | number | boolean | string[] | null | undefined
>;

// List the definitions for an entity, ordered by position then label.
export const getCustomFields = async (
  entity: CustomFieldEntity,
): Promise<CustomFieldDefinition[]> => {
  const response = await api.get('/custom-fields', { params: { entity } });
  return response.data;
};

export const createCustomField = async (
  data: CreateCustomFieldData,
): Promise<CustomFieldDefinition> => {
  const response = await api.post('/custom-fields', data);
  return response.data;
};

export const updateCustomField = async (
  id: string,
  data: UpdateCustomFieldData,
): Promise<CustomFieldDefinition> => {
  const response = await api.patch(`/custom-fields/${id}`, data);
  return response.data;
};

export const deleteCustomField = async (id: string): Promise<void> => {
  await api.delete(`/custom-fields/${id}`);
};

// ── Slug helper (mirrors backend custom-fields.constants.slugifyKey) ──────────
// Lowercases, collapses any run of non-alphanumerics to a single underscore,
// trims leading/trailing underscores, prefixes `f_` if the result wouldn't
// start with a letter, and caps to 64 chars. Kept in lockstep with the server
// so the auto-derived key shown in the UI matches what the backend would
// generate when `key` is omitted.
export const MAX_KEY_LENGTH = 64;

export function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  const prefixed = /^[a-z]/.test(base) ? base : `f_${base}`;
  return prefixed.slice(0, MAX_KEY_LENGTH);
}

// Human label for a field type (for menus + read-only display).
export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  [CustomFieldType.TEXT]: 'Text',
  [CustomFieldType.NUMBER]: 'Number',
  [CustomFieldType.DATE]: 'Date',
  [CustomFieldType.SELECT]: 'Select (one)',
  [CustomFieldType.MULTISELECT]: 'Multi-select',
  [CustomFieldType.BOOLEAN]: 'Checkbox',
};
