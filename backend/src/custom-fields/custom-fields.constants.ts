/**
 * Custom-fields shared constants + small pure helpers.
 *
 * A custom field is a workspace-defined attribute on a TASK or PROJECT. Only the
 * DEFINITION is a row (CustomFieldDefinition); the VALUES live in the entity's
 * existing `metadata` JSON under a `customFields` key (see CUSTOM_FIELDS_METADATA_KEY).
 */

/**
 * The metadata sub-key under which validated custom-field values are stored on a
 * task/project: `entity.metadata.customFields[key] = value`. The tasks/projects
 * modules write the object returned by `CustomFieldsService.validateValues`
 * under this key.
 */
export const CUSTOM_FIELDS_METADATA_KEY = 'customFields' as const;

/**
 * Hard cap on a stored TEXT value's length (chars). Custom fields are small
 * structured attributes, not a document store; this keeps a caller from stuffing
 * arbitrarily large strings into the entity's metadata JSON.
 */
export const MAX_TEXT_VALUE_LENGTH = 2000;

/**
 * Max number of options a SELECT / MULTISELECT definition may declare. A
 * guardrail against an unbounded options array on the definition row.
 */
export const MAX_OPTIONS = 200;

/** Max length of a single option value (chars). */
export const MAX_OPTION_LENGTH = 200;

/** Max length of a field `key` (slug). */
export const MAX_KEY_LENGTH = 64;

/**
 * A valid custom-field `key` is a stable slug: starts with a lowercase letter,
 * then lowercase alphanumerics / underscores. This keeps keys safe as JSON
 * object keys and stable across label edits (the label is the display name; the
 * key is the identity). Length is bounded separately (MAX_KEY_LENGTH).
 */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Derive a stable slug key from a human label. Lowercases, replaces any run of
 * non-alphanumeric chars with a single underscore, trims leading/trailing
 * underscores, and prefixes `f_` if the result would not start with a letter
 * (e.g. a purely numeric label). Truncated to MAX_KEY_LENGTH. Returns '' only
 * if the label has no usable characters at all (caller treats that as invalid).
 */
export function slugifyKey(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return '';
  const prefixed = /^[a-z]/.test(base) ? base : `f_${base}`;
  return prefixed.slice(0, MAX_KEY_LENGTH);
}
