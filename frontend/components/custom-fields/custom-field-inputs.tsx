"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldType,
  CustomFieldValueMap,
  getCustomFields,
} from "@/lib/custom-fields-api";
import { useHydrated } from "@/lib/use-hydrated";

// ── value coercion helpers (kept tolerant of strings/legacy shapes) ───────────

/** Normalize a stored DATE value to the `YYYY-MM-DD` a date <input> expects. */
function toDateInputValue(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  // Stored values are ISO-8601 (e.g. 2026-06-18T00:00:00.000Z); the leading
  // 10 chars are the date. A bare YYYY-MM-DD passes through unchanged.
  return raw.slice(0, 10);
}

function toSelected(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string" && raw) return [raw];
  return [];
}

// ── CustomFieldInputs ─────────────────────────────────────────────────────────

interface CustomFieldInputsProps {
  /** Which entity's definitions to fetch + render (TASK | PROJECT). */
  entity: CustomFieldEntity;
  /** Current values, keyed by field `key`. */
  values: CustomFieldValueMap;
  /** Called with the full next values map whenever any field changes. */
  onChange: (next: CustomFieldValueMap) => void;
  disabled?: boolean;
  /**
   * Optional: receive the loaded definitions (e.g. so a parent can skip the
   * whole section when there are none). Called once per fetch.
   */
  onDefinitionsLoaded?: (defs: CustomFieldDefinition[]) => void;
}

/**
 * Renders a controlled input per workspace custom-field definition for the
 * given entity. The full value map is owned by the parent; each change emits a
 * new `{ ...values, [key]: next }` (an empty/cleared value is set to undefined
 * so it's dropped by the backend's required/optional logic).
 *
 * Self-fetches the definitions on mount (and when `entity` changes). Renders
 * nothing once loaded if the workspace has no fields for the entity, so callers
 * can drop it into a section unconditionally.
 */
export function CustomFieldInputs({
  entity,
  values,
  onChange,
  disabled,
  onDefinitionsLoaded,
}: CustomFieldInputsProps) {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCustomFields(entity)
      .then((defs) => {
        if (!active) return;
        setDefinitions(defs);
        onDefinitionsLoaded?.(defs);
      })
      .catch(() => {
        if (active) setDefinitions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // onDefinitionsLoaded is intentionally excluded — parents needn't memoize it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  const setValue = (key: string, next: CustomFieldValueMap[string]) => {
    onChange({ ...values, [key]: next });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fields…
      </div>
    );
  }

  if (definitions.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {definitions.map((def) => (
        <CustomFieldInput
          key={def.id}
          def={def}
          value={values[def.key]}
          onChange={(next) => setValue(def.key, next)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/**
 * CustomFieldsSection — a titled "Custom fields" block wrapping
 * {@link CustomFieldInputs}, styled to match the other modal sections. It hides
 * itself entirely (header included) when the workspace has no fields for the
 * entity, so modals can drop it in unconditionally without showing an empty
 * heading. Use this in the create/edit modals; use the bare CustomFieldInputs
 * when you need custom layout.
 */
export function CustomFieldsSection({
  entity,
  values,
  onChange,
  disabled,
  title = "Custom fields",
}: CustomFieldInputsProps & { title?: string }) {
  const [hasFields, setHasFields] = useState<boolean | null>(null);

  return (
    <div className={hasFields ? "" : "hidden"}>
      {hasFields && (
        <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
          {title}
        </h3>
      )}
      <CustomFieldInputs
        entity={entity}
        values={values}
        onChange={onChange}
        disabled={disabled}
        onDefinitionsLoaded={(defs) => setHasFields(defs.length > 0)}
      />
    </div>
  );
}

// A single field's input, dispatched on the definition type.
function CustomFieldInput({
  def,
  value,
  onChange,
  disabled,
}: {
  def: CustomFieldDefinition;
  value: CustomFieldValueMap[string];
  onChange: (next: CustomFieldValueMap[string]) => void;
  disabled?: boolean;
}) {
  const inputId = `cf-${def.id}`;
  const options = def.options ?? [];

  const labelEl = (
    <Label htmlFor={inputId} className="flex items-center gap-1">
      {def.label}
      {def.required && <span className="text-red-500">*</span>}
    </Label>
  );

  switch (def.type) {
    case CustomFieldType.TEXT:
      return (
        <div>
          {labelEl}
          <Input
            id={inputId}
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
            placeholder={`Enter ${def.label.toLowerCase()}`}
          />
        </div>
      );

    case CustomFieldType.NUMBER:
      return (
        <div>
          {labelEl}
          <Input
            id={inputId}
            type="number"
            step="any"
            value={
              value === null || value === undefined ? "" : (value as number | string)
            }
            onChange={(e) => {
              // Keep the field as a number so the backend stores it as one;
              // empty -> undefined (cleared). `valueAsNumber` is NaN when blank.
              const n = e.target.valueAsNumber;
              onChange(Number.isNaN(n) ? undefined : n);
            }}
            disabled={disabled}
            placeholder={`Enter ${def.label.toLowerCase()}`}
          />
        </div>
      );

    case CustomFieldType.DATE:
      return (
        <div>
          {labelEl}
          <Input
            id={inputId}
            type="date"
            value={toDateInputValue(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={disabled}
          />
        </div>
      );

    case CustomFieldType.BOOLEAN:
      return (
        <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
          <Label htmlFor={inputId} className="flex items-center gap-1 mb-0">
            {def.label}
            {def.required && <span className="text-red-500">*</span>}
          </Label>
          <Switch
            id={inputId}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
            aria-label={def.label}
          />
        </div>
      );

    case CustomFieldType.SELECT: {
      const current = typeof value === "string" ? value : "";
      // A non-required SELECT needs a way to clear back to no value; Radix
      // Select can't hold an empty string item, so we use a sentinel.
      const CLEAR = "__none__";
      return (
        <div>
          {labelEl}
          <Select
            value={current || (def.required ? "" : CLEAR)}
            onValueChange={(v) => onChange(v === CLEAR ? undefined : v)}
            disabled={disabled}
          >
            <SelectTrigger id={inputId}>
              <SelectValue placeholder={`Select ${def.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {!def.required && (
                <SelectItem value={CLEAR}>
                  <span className="text-muted-foreground">None</span>
                </SelectItem>
              )}
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    case CustomFieldType.MULTISELECT: {
      const selected = toSelected(value);
      const toggle = (opt: string) => {
        const next = selected.includes(opt)
          ? selected.filter((o) => o !== opt)
          : [...selected, opt];
        onChange(next.length ? next : undefined);
      };
      return (
        <div className="md:col-span-2">
          {labelEl}
          <div className="flex flex-wrap gap-2 rounded-md border bg-background p-2">
            {options.length === 0 ? (
              <span className="text-xs text-muted-foreground px-1 py-0.5">
                No options defined
              </span>
            ) : (
              options.map((opt) => {
                const active = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(opt)}
                    disabled={disabled}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {opt}
                    {active && <X className="h-3 w-3" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

// ── CustomFieldValues (read-only display) ─────────────────────────────────────

interface CustomFieldValuesProps {
  entity: CustomFieldEntity;
  /** Saved values (e.g. from `task.metadata?.customFields`). */
  values: CustomFieldValueMap | null | undefined;
  /** Optional pre-loaded definitions; fetched if omitted. */
  definitions?: CustomFieldDefinition[];
}

/**
 * Read-only display of saved custom-field values with their labels. Fetches the
 * definitions itself (unless passed in) so it can show labels + format each
 * type, and only renders fields that have a value. Renders nothing when there
 * are no populated custom fields.
 */
export function CustomFieldValues({
  entity,
  values,
  definitions: passedDefs,
}: CustomFieldValuesProps) {
  const hydrated = useHydrated();
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>(
    passedDefs ?? [],
  );

  useEffect(() => {
    if (passedDefs) {
      setDefinitions(passedDefs);
      return;
    }
    let active = true;
    getCustomFields(entity)
      .then((defs) => active && setDefinitions(defs))
      .catch(() => active && setDefinitions([]));
    return () => {
      active = false;
    };
  }, [entity, passedDefs]);

  const map = values ?? {};
  const populated = definitions.filter((def) => {
    const v = map[def.key];
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true; // numbers (incl. 0) and booleans (incl. false) count.
  });

  if (populated.length === 0) return null;

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {populated.map((def) => (
        <div key={def.id}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {def.label}
          </dt>
          <dd className="text-sm text-foreground mt-0.5">
            {formatValue(def, map[def.key], hydrated)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Render a saved value per its definition type. `hydrated` gates locale-/tz-
// dependent date formatting so the server render and first client render agree
// (otherwise toLocaleDateString diverges -> React #418).
function formatValue(
  def: CustomFieldDefinition,
  raw: CustomFieldValueMap[string],
  hydrated: boolean,
) {
  switch (def.type) {
    case CustomFieldType.BOOLEAN:
      return raw === true ? "Yes" : "No";

    case CustomFieldType.DATE: {
      const iso = toDateInputValue(raw); // YYYY-MM-DD, locale-independent
      if (!iso) return "—";
      if (!hydrated) return iso; // stable on SSR + first client render
      const d = new Date(`${iso}T00:00:00`);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
    }

    case CustomFieldType.MULTISELECT: {
      const arr = toSelected(raw);
      return (
        <div className="flex flex-wrap gap-1.5">
          {arr.map((v) => (
            <span
              key={v}
              className="inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {v}
            </span>
          ))}
        </div>
      );
    }

    case CustomFieldType.SELECT:
      return (
        <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {String(raw)}
        </span>
      );

    default:
      return String(raw);
  }
}
