"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpHint, FieldHint } from "@/components/guidance";
import { iconWellClass } from "@/lib/badge-styles";
import {
  ChevronLeft,
  GripVertical,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldType,
  CreateCustomFieldData,
  FIELD_TYPE_LABELS,
  OPTION_TYPES,
  UpdateCustomFieldData,
  createCustomField,
  deleteCustomField,
  getCustomFields,
  slugifyKey,
  updateCustomField,
} from "@/lib/custom-fields-api";

// The two entity groups, in display order.
const ENTITY_GROUPS: { entity: CustomFieldEntity; title: string; blurb: string }[] = [
  {
    entity: CustomFieldEntity.TASK,
    title: "Task fields",
    blurb: "Extra attributes that appear on every task in this workspace.",
  },
  {
    entity: CustomFieldEntity.PROJECT,
    title: "Project fields",
    blurb: "Extra attributes that appear on every project in this workspace.",
  },
];

const TYPE_OPTIONS = Object.values(CustomFieldType);

// Every hint on this surface deep-links to the one custom-fields explainer.
const CUSTOM_FIELDS_HELP = {
  category: "custom-fields",
  article: "custom-fields-overview",
} as const;

export default function CustomFieldsSettingsPage() {
  const { toast } = useToast();
  const [byEntity, setByEntity] = useState<
    Record<CustomFieldEntity, CustomFieldDefinition[]>
  >({
    [CustomFieldEntity.TASK]: [],
    [CustomFieldEntity.PROJECT]: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state: either creating (for a fixed entity) or editing a definition.
  const [editorEntity, setEditorEntity] = useState<CustomFieldEntity | null>(null);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomFieldDefinition | null>(
    null,
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [taskDefs, projectDefs] = await Promise.all([
        getCustomFields(CustomFieldEntity.TASK),
        getCustomFields(CustomFieldEntity.PROJECT),
      ]);
      setByEntity({
        [CustomFieldEntity.TASK]: taskDefs,
        [CustomFieldEntity.PROJECT]: projectDefs,
      });
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          "Couldn't load custom fields. Refresh the page or try again later.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(def: CustomFieldDefinition) {
    try {
      await deleteCustomField(def.id);
      toast({
        title: "Field deleted",
        description: `"${def.label}" was removed. Existing saved values are left untouched.`,
      });
      setPendingDelete(null);
      refresh();
    } catch (err: any) {
      toast({
        title: "Couldn't delete field",
        description: err?.response?.data?.message ?? "Try again or refresh the page.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Settings
        </Link>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
          Custom fields
          <HelpHint
            icon="info"
            side="bottom"
            size={18}
            aria-label="About custom fields"
            learnMore={CUSTOM_FIELDS_HELP}
          >
            Capture the attributes your team cares about that aren&apos;t built in — a client
            matter number, a billing category, a launch date, a yes/no flag. Fields are
            defined per workspace and attached to either tasks or projects, then everyone
            fills in the values as they work.
          </HelpHint>
        </h1>
        <p className="text-muted-foreground mt-1">
          Define your own attributes on tasks and projects. They show up in the
          create/edit forms and on task details.
        </p>
      </div>

      {loading ? (
        <div className="space-y-6">
          {[0, 1].map((i) => (
            <Card key={i} className="p-6">
              <div className="mb-6 flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-md" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <div className="space-y-2">
                {[0, 1].map((j) => (
                  <Skeleton key={j} className="h-12 w-full rounded-md" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-6">
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            {error}
          </div>
        </Card>
      ) : (
        ENTITY_GROUPS.map((group) => (
          <EntityGroupCard
            key={group.entity}
            title={group.title}
            blurb={group.blurb}
            definitions={byEntity[group.entity]}
            onCreate={() => {
              setEditing(null);
              setEditorEntity(group.entity);
            }}
            onEdit={(def) => {
              setEditing(def);
              setEditorEntity(def.entity);
            }}
            onDelete={(def) => setPendingDelete(def)}
          />
        ))
      )}

      {editorEntity && (
        <FieldEditorModal
          entity={editorEntity}
          existing={editing}
          existingKeys={byEntity[editorEntity]
            .filter((d) => d.id !== editing?.id)
            .map((d) => d.key)}
          onClose={() => {
            setEditorEntity(null);
            setEditing(null);
          }}
          onSaved={() => {
            setEditorEntity(null);
            setEditing(null);
            refresh();
          }}
        />
      )}

      {pendingDelete && (
        <DeleteConfirmModal
          def={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => handleDelete(pendingDelete)}
        />
      )}
    </div>
  );
}

// ── One entity's card (TASK or PROJECT) ───────────────────────────────────────

function EntityGroupCard({
  title,
  blurb,
  definitions,
  onCreate,
  onEdit,
  onDelete,
}: {
  title: string;
  blurb: string;
  definitions: CustomFieldDefinition[];
  onCreate: () => void;
  onEdit: (def: CustomFieldDefinition) => void;
  onDelete: (def: CustomFieldDefinition) => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("blue")}`}
          >
            <SlidersHorizontal className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-xs text-muted-foreground">{blurb}</p>
          </div>
        </div>
        <Button onClick={onCreate} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add field
        </Button>
      </div>

      {definitions.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          iconTone="blue"
          title="No custom fields yet"
          body={`Add a field and it shows up on every ${title.toLowerCase().replace(" fields", "")}'s create and edit form.`}
          action={
            <Button variant="outline" onClick={onCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add your first field
            </Button>
          }
          className="border-0"
        />
      ) : (
        <div className="rounded-md border divide-y">
          {definitions.map((def) => (
            <div key={def.id} className="flex items-center gap-3 px-4 py-3">
              <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground truncate">
                    {def.label}
                  </span>
                  {def.required && (
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                      Required
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{def.key}</span>
                  <span aria-hidden>·</span>
                  <span>{FIELD_TYPE_LABELS[def.type]}</span>
                  {OPTION_TYPES.has(def.type) && def.options && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="truncate">{def.options.join(", ")}</span>
                    </>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                #{def.position}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(def)}
                  aria-label={`Edit ${def.label}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(def)}
                  aria-label={`Delete ${def.label}`}
                  className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Create / edit modal ───────────────────────────────────────────────────────

function FieldEditorModal({
  entity,
  existing,
  existingKeys,
  onClose,
  onSaved,
}: {
  entity: CustomFieldEntity;
  existing: CustomFieldDefinition | null;
  existingKeys: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!existing;

  const [label, setLabel] = useState(existing?.label ?? "");
  // When the key has been hand-edited we stop auto-deriving it from the label.
  const [keyTouched, setKeyTouched] = useState(isEdit);
  const [key, setKey] = useState(existing?.key ?? "");
  const [type, setType] = useState<CustomFieldType>(
    existing?.type ?? CustomFieldType.TEXT,
  );
  const [options, setOptions] = useState<string[]>(existing?.options ?? []);
  const [optionDraft, setOptionDraft] = useState("");
  const [required, setRequired] = useState(existing?.required ?? false);
  const [position, setPosition] = useState<number>(existing?.position ?? 0);
  const [submitting, setSubmitting] = useState(false);

  const isOptionType = OPTION_TYPES.has(type);
  // For a NEW field, mirror the backend: the effective key is the derived slug
  // when the user hasn't typed one. For an edit the key is immutable.
  const effectiveKey = isEdit
    ? existing!.key
    : keyTouched
      ? key.trim()
      : slugifyKey(label);

  const keyCollision = !isEdit && effectiveKey
    ? existingKeys.includes(effectiveKey)
    : false;

  function addOption(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setOptions((prev) =>
      prev.some((o) => o.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value],
    );
    setOptionDraft("");
  }

  function removeOption(value: string) {
    setOptions((prev) => prev.filter((o) => o !== value));
  }

  async function handleSubmit() {
    if (!label.trim()) {
      toast({
        title: "Label is required",
        description: "Give the field a display name.",
        variant: "destructive",
      });
      return;
    }
    if (isOptionType && options.length === 0) {
      toast({
        title: "Options required",
        description: `${FIELD_TYPE_LABELS[type]} fields need at least one option.`,
        variant: "destructive",
      });
      return;
    }
    if (keyCollision) {
      toast({
        title: "Key already in use",
        description: `Another ${entity.toLowerCase()} field already uses the key "${effectiveKey}".`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        // key + entity are immutable; send only the editable fields.
        const payload: UpdateCustomFieldData = {
          label: label.trim(),
          type,
          required,
          position,
          ...(isOptionType ? { options } : {}),
        };
        await updateCustomField(existing!.id, payload);
        toast({ title: "Field updated", description: `"${label.trim()}" was saved.` });
      } else {
        const payload: CreateCustomFieldData = {
          entity,
          label: label.trim(),
          type,
          required,
          position,
          ...(keyTouched && key.trim() ? { key: key.trim() } : {}),
          ...(isOptionType ? { options } : {}),
        };
        await createCustomField(payload);
        toast({ title: "Field created", description: `"${label.trim()}" was added.` });
      }
      onSaved();
    } catch (err: any) {
      toast({
        title: isEdit ? "Couldn't update field" : "Couldn't create field",
        description:
          err?.response?.data?.message ??
          "The server rejected the request. Check the form and try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={submitting ? undefined : onClose}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">
            {isEdit ? "Edit field" : "New field"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {entity === CustomFieldEntity.TASK ? "Task" : "Project"} custom field
            {isEdit && " · key and entity can't be changed"}
          </p>
        </div>
        <button
          aria-label="Close"
          onClick={onClose}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4">
        {/* Label */}
        <div className="space-y-2">
          <Label htmlFor="cf-label">Label</Label>
          <Input
            id="cf-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Priority Tier"
            disabled={submitting}
            maxLength={120}
          />
        </div>

        {/* Key — auto-derived, editable on create only */}
        <div className="space-y-2">
          <Label htmlFor="cf-key">
            Key
            <FieldHint learnMore={CUSTOM_FIELDS_HELP}>
              The stable identifier stored values are saved under. It&apos;s auto-derived from
              the label as a lowercase slug and can be set when you create the field —
              but once saved it&apos;s <span className="font-semibold">immutable</span>, so
              existing values never lose their home.
            </FieldHint>
          </Label>
          <Input
            id="cf-key"
            value={effectiveKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
            placeholder="priority_tier"
            disabled={submitting || isEdit}
            className={`font-mono ${keyCollision ? "border-red-500" : ""}`}
            maxLength={64}
          />
          {keyCollision ? (
            <p className="text-xs text-red-500">
              A field with this key already exists for this entity.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "The stable identity for stored values — immutable."
                : "Auto-derived from the label. A lowercase slug used as the stored value key."}
            </p>
          )}
        </div>

        {/* Type */}
        <div className="space-y-2">
          <Label htmlFor="cf-type">
            Type
            <FieldHint learnMore={CUSTOM_FIELDS_HELP}>
              What kind of value the field holds: Text, Number, Date, Select (one choice),
              Multi-select (any number of choices), or Checkbox (true/false). Select and
              Multi-select need a list of options you define below.
            </FieldHint>
          </Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as CustomFieldType)}
            disabled={submitting}
          >
            <SelectTrigger id="cf-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isEdit && (
            <p className="text-xs text-muted-foreground">
              Changing the type may make previously saved values invalid until
              they're re-entered.
            </p>
          )}
        </div>

        {/* Options — only for SELECT / MULTISELECT */}
        {isOptionType && (
          <div className="space-y-2">
            <Label htmlFor="cf-options">Options</Label>
            <div
              className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 transition-colors focus-within:border-ring"
            >
              {options.map((opt) => (
                <span
                  key={opt}
                  className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {opt}
                  <button
                    type="button"
                    onClick={() => removeOption(opt)}
                    className="text-primary/60 hover:text-primary"
                    aria-label={`Remove ${opt}`}
                    disabled={submitting}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                id="cf-options"
                type="text"
                value={optionDraft}
                onChange={(e) => setOptionDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addOption(optionDraft);
                  } else if (e.key === "Backspace" && !optionDraft && options.length) {
                    removeOption(options[options.length - 1]);
                  }
                }}
                onBlur={() => addOption(optionDraft)}
                placeholder={options.length ? "Add another…" : "Add an option (press Enter)"}
                disabled={submitting}
                className="flex-1 min-w-[120px] border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" />
              Press Enter or comma to add. At least one option is required.
            </p>
          </div>
        )}

        {/* Position + required */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="cf-position">Position</Label>
            <Input
              id="cf-position"
              type="number"
              min={0}
              step={1}
              value={position}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setPosition(Number.isFinite(n) && n >= 0 ? n : 0);
              }}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Lower shows first.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-required">
              Required
              <FieldHint learnMore={CUSTOM_FIELDS_HELP}>
                When on, this field must be filled in before a {entity === CustomFieldEntity.TASK ? "task" : "project"}{" "}
                can be saved. Leave it off to keep the field optional.
              </FieldHint>
            </Label>
            <div className="flex items-center gap-2 h-10">
              <Switch
                id="cf-required"
                checked={required}
                onCheckedChange={setRequired}
                disabled={submitting}
              />
              <span className="text-sm text-muted-foreground">
                {required ? "Must be filled in" : "Optional"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {isEdit ? "Saving…" : "Creating…"}
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create field"
          )}
        </Button>
      </div>
    </ModalShell>
  );
}

// ── Delete confirm ─────────────────────────────────────────────────────────────

function DeleteConfirmModal({
  def,
  onCancel,
  onConfirm,
}: {
  def: CustomFieldDefinition;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onClose={onCancel}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Delete field?</h3>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{def.label}</span> will
          be removed from the {def.entity.toLowerCase()} forms. Values already
          saved on existing {def.entity.toLowerCase()}s are left in place but
          will no longer be shown. This cannot be undone.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Delete field
        </Button>
      </div>
    </ModalShell>
  );
}

// ── Shared modal shell (mirrors api-tokens-card) ──────────────────────────────

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-card border rounded-lg shadow-lg max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
