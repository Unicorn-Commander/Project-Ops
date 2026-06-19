"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HelpHint } from "@/components/guidance";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  createAutomation,
  updateAutomation,
  type ActionType,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type AutomationTrigger,
  type ConditionOp,
  type CreateAutomationRuleData,
} from "@/lib/automations-api";
import {
  ACTION_META,
  ACTION_OPTIONS,
  defaultParamsFor,
  describeRule,
  FIELDS_BY_TRIGGER,
  fieldMetaFor,
  OP_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TRIGGER_OPTIONS,
  type FieldKind,
} from "./automation-meta";
import {
  useAutomationOptions,
  userDisplayName,
  projectDisplayName,
} from "./use-automation-options";

/**
 * The rule builder — create or edit one `{ trigger, conditions[], actions[] }`
 * rule. Conditions are ANDed; actions run in order. The editors are driven by
 * the per-trigger field catalog and per-action param shapes in
 * automation-meta, and a live "When … if … then …" preview reads from the same
 * metadata so the sentence always matches what will be saved.
 *
 * Validation mirrors the backend DTO (automation-validation.ts) so the user
 * gets inline errors before submit rather than a 400.
 */

interface RuleBuilderProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When set, the builder edits this rule; otherwise it creates a new one. */
  rule?: AutomationRule | null;
  /** Optional starting point for a brand-new rule (from a template). */
  template?: CreateAutomationRuleData | null;
}

// Editable working copies (params held as a loose string map while editing).
interface DraftCondition {
  key: number;
  field: string;
  op: ConditionOp;
  value: string;
}
interface DraftAction {
  key: number;
  type: ActionType;
  params: Record<string, string>;
}

let keySeq = 1;
const nextKey = () => keySeq++;

// Every hint in the builder deep-links to the one automations explainer.
const AUTOMATIONS_HELP = {
  category: "automations",
  article: "automations-overview",
} as const;

function toDraftConditions(conditions: AutomationCondition[]): DraftCondition[] {
  return conditions.map((c) => ({
    key: nextKey(),
    field: c.field,
    op: c.op,
    value: c.value == null ? "" : String(c.value),
  }));
}

function toDraftActions(actions: AutomationAction[]): DraftAction[] {
  return actions.map((a) => {
    const params: Record<string, string> = {};
    Object.entries(a.params ?? {}).forEach(([k, v]) => {
      params[k] = v == null ? "" : String(v);
    });
    return { key: nextKey(), type: a.type, params };
  });
}

export function RuleBuilder({
  open,
  onClose,
  onSuccess,
  rule,
  template,
}: RuleBuilderProps) {
  const isEdit = !!rule;
  const { toast } = useToast();
  const { users, projects, userName, projectName } = useAutomationOptions(open);

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("TASK_CREATED");
  const [conditions, setConditions] = useState<DraftCondition[]>([]);
  const [actions, setActions] = useState<DraftAction[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Seed the form whenever the dialog opens for a (different) rule/template.
  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setTrigger(rule.trigger);
      setConditions(toDraftConditions(rule.conditions));
      setActions(toDraftActions(rule.actions));
    } else if (template) {
      setName(template.name);
      setTrigger(template.trigger);
      setConditions(toDraftConditions(template.conditions ?? []));
      setActions(toDraftActions(template.actions));
    } else {
      setName("");
      setTrigger("TASK_CREATED");
      setConditions([]);
      setActions([{ key: nextKey(), type: "notify", params: defaultParamsFor("notify") as Record<string, string> }]);
    }
    setErrors({});
  }, [open, rule, template]);

  const availableFields = FIELDS_BY_TRIGGER[trigger] ?? [];

  // ── Condition mutators ────────────────────────────────────────────────────
  const addCondition = () => {
    const first = availableFields[0];
    setConditions((prev) => [
      ...prev,
      { key: nextKey(), field: first?.value ?? "", op: "eq", value: "" },
    ]);
  };
  const updateCondition = (key: number, patch: Partial<DraftCondition>) =>
    setConditions((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const removeCondition = (key: number) =>
    setConditions((prev) => prev.filter((c) => c.key !== key));

  // ── Action mutators ─────────────────────────────────────────────────────
  const addAction = () =>
    setActions((prev) => [
      ...prev,
      { key: nextKey(), type: "notify", params: defaultParamsFor("notify") as Record<string, string> },
    ]);
  const changeActionType = (key: number, type: ActionType) =>
    setActions((prev) =>
      prev.map((a) =>
        a.key === key ? { ...a, type, params: defaultParamsFor(type) as Record<string, string> } : a,
      ),
    );
  const updateActionParam = (key: number, field: string, value: string) =>
    setActions((prev) =>
      prev.map((a) => (a.key === key ? { ...a, params: { ...a.params, [field]: value } } : a)),
    );
  const removeAction = (key: number) =>
    setActions((prev) => prev.filter((a) => a.key !== key));

  // ── Serialize drafts → API payload ────────────────────────────────────────
  const buildPayload = (): CreateAutomationRuleData => {
    const outConditions: AutomationCondition[] = conditions
      .filter((c) => c.field.trim() !== "")
      .map((c) => ({ field: c.field.trim(), op: c.op, value: coerceValue(trigger, c.field, c.value) }));

    const outActions: AutomationAction[] = actions.map((a) => ({
      type: a.type,
      params: serializeActionParams(a),
    }));

    return {
      name: name.trim(),
      trigger,
      conditions: outConditions,
      actions: outActions,
    };
  };

  // ── Validation (mirrors backend DTO) ──────────────────────────────────────
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (name.trim() === "") next.name = "Give your automation a name.";
    else if (name.trim().length > 200) next.name = "Name must be 200 characters or fewer.";

    conditions.forEach((c) => {
      if (c.field.trim() === "") next[`c:${c.key}:field`] = "Pick a field.";
      if (c.value.trim() === "") next[`c:${c.key}:value`] = "Enter a value.";
    });

    if (actions.length === 0) next.actions = "Add at least one action.";
    actions.forEach((a) => {
      const p = a.params;
      switch (a.type) {
        case "assign_task":
          if (!p.userId?.trim()) next[`a:${a.key}:userId`] = "Choose who to assign.";
          break;
        case "set_status":
          if (!p.status?.trim()) next[`a:${a.key}:status`] = "Choose a status.";
          break;
        case "add_comment":
          if (!p.text?.trim()) next[`a:${a.key}:text`] = "Enter comment text.";
          break;
        case "create_task":
          if (!p.title?.trim()) next[`a:${a.key}:title`] = "Enter a task title.";
          break;
        case "notify":
          if (!p.userId?.trim()) next[`a:${a.key}:userId`] = "Choose who to notify.";
          break;
      }
    });

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast({
        title: "Almost there",
        description: "Fix the highlighted fields and try again.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const payload = buildPayload();
      if (isEdit && rule) {
        await updateAutomation(rule.id, payload);
        toast({ title: "Automation updated", description: `"${payload.name}" was saved.` });
      } else {
        await createAutomation(payload);
        toast({ title: "Automation created", description: `"${payload.name}" is now active.` });
      }
      onSuccess();
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error?.response?.data?.message ||
          `Failed to ${isEdit ? "update" : "create"} the automation.`,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Live preview ──────────────────────────────────────────────────────────
  const preview = useMemo(() => {
    try {
      const payload = buildPayload();
      return describeRule(
        { trigger: payload.trigger, conditions: payload.conditions ?? [], actions: payload.actions },
        { userName, projectName },
      );
    } catch {
      return "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, trigger, conditions, actions, userName, projectName]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-card"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Zap className="h-4 w-4" strokeWidth={2.25} />
            </span>
            {isEdit ? "Edit automation" : "New automation"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-7">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="rule-name">
              Name <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Notify the lead when an urgent task lands"
              maxLength={200}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-sm text-rose-600">{errors.name}</p>}
          </div>

          {/* WHEN — trigger */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <StepBadge tone="bg-blue-500/15 text-blue-600 dark:text-blue-300">When</StepBadge>
              <h3 className="text-sm font-semibold text-foreground">this happens</h3>
              <HelpHint side="right" learnMore={AUTOMATIONS_HELP}>
                The trigger — the event that starts the rule, like a task being created,
                its status changing, or a comment being posted. Every rule has exactly one.
              </HelpHint>
            </div>
            <Select
              value={trigger}
              onValueChange={(v) => {
                setTrigger(v as AutomationTrigger);
                // Reset conditions whose field doesn't exist on the new trigger.
                setConditions((prev) =>
                  prev.filter((c) => fieldMetaFor(v as AutomationTrigger, c.field)),
                );
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a trigger…" />
              </SelectTrigger>
              <SelectContent>
                {TRIGGER_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          {/* IF — conditions */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StepBadge tone="bg-amber-500/15 text-amber-600 dark:text-amber-300">If</StepBadge>
                <h3 className="text-sm font-semibold text-foreground">
                  these conditions are met{" "}
                  <span className="font-normal text-muted-foreground">(all must match — optional)</span>
                </h3>
                <HelpHint side="right" learnMore={AUTOMATIONS_HELP}>
                  Optional filters on the event. Each condition compares a field — like
                  priority or the new status — using an operator (is, is not, contains,
                  greater than, less than). <span className="font-semibold">All</span> conditions
                  must pass (logical AND). Leave them empty to run every time.
                </HelpHint>
              </div>
            </div>

            {conditions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-sm text-muted-foreground">
                No conditions — this runs every time the trigger fires.
              </p>
            ) : (
              <div className="space-y-2">
                {conditions.map((c, idx) => {
                  const meta = fieldMetaFor(trigger, c.field);
                  const kind: FieldKind = meta?.kind ?? "text";
                  const knownField = !!meta;
                  return (
                    <div
                      key={c.key}
                      className="rounded-lg border border-border bg-muted/30 p-3"
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          {idx === 0 ? "If" : "And"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCondition(c.key)}
                          className="h-7 px-2 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                          aria-label="Remove condition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]">
                        {/* Field */}
                        {knownField ? (
                          <Select
                            value={c.field}
                            onValueChange={(v) => updateCondition(c.key, { field: v, value: "" })}
                          >
                            <SelectTrigger aria-invalid={!!errors[`c:${c.key}:field`]}>
                              <SelectValue placeholder="Field…" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableFields.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          // Hand-authored / legacy field not in the catalog —
                          // keep it editable as a free-text path so it's not lost.
                          <Input
                            value={c.field}
                            onChange={(e) => updateCondition(c.key, { field: e.target.value })}
                            placeholder="field.path"
                          />
                        )}

                        {/* Op */}
                        <Select
                          value={c.op}
                          onValueChange={(v) => updateCondition(c.key, { op: v as ConditionOp })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {OP_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Value editor — typed by field kind */}
                        <ConditionValueEditor
                          kind={kind}
                          value={c.value}
                          invalid={!!errors[`c:${c.key}:value`]}
                          onChange={(v) => updateCondition(c.key, { value: v })}
                        />
                      </div>
                      {(errors[`c:${c.key}:field`] || errors[`c:${c.key}:value`]) && (
                        <p className="mt-1.5 text-xs text-rose-600">
                          {errors[`c:${c.key}:field`] || errors[`c:${c.key}:value`]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCondition}
              disabled={availableFields.length === 0 && conditions.length > 0}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add condition
            </Button>
          </section>

          {/* THEN — actions */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <StepBadge tone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">Then</StepBadge>
              <h3 className="text-sm font-semibold text-foreground">
                do this <span className="font-normal text-muted-foreground">(in order)</span>
              </h3>
              <HelpHint side="right" learnMore={AUTOMATIONS_HELP}>
                The actions that run when the trigger fires and the conditions pass, top to
                bottom. Five are available: assign the task, set its status, add a comment,
                create a new task, or notify someone. A built-in loop guard stops a rule&apos;s
                own writes from re-triggering itself.
              </HelpHint>
            </div>
            {errors.actions && <p className="text-sm text-rose-600">{errors.actions}</p>}

            <div className="space-y-2">
              {actions.map((a, idx) => {
                const meta = ACTION_META[a.type];
                const Icon = meta.icon;
                return (
                  <div key={a.key} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${meta.tone}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Step {idx + 1}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAction(a.key)}
                        className="h-7 px-2 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                        aria-label="Remove action"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Select value={a.type} onValueChange={(v) => changeActionType(a.key, v as ActionType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTION_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <ActionParamsEditor
                        action={a}
                        users={users}
                        projects={projects}
                        errors={errors}
                        onParam={(field, value) => updateActionParam(a.key, field, value)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={addAction}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add action
            </Button>
          </section>

          {/* Live preview */}
          <div className="rounded-lg border border-primary/30 bg-primary/[0.06] p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              This automation will…
            </div>
            <p className="text-sm leading-relaxed text-foreground">{preview}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <ArrowRight className="mr-2 h-4 w-4" />
                {isEdit ? "Save changes" : "Create automation"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Value editor for a condition, typed by the field kind ─────────────────────

function ConditionValueEditor({
  kind,
  value,
  invalid,
  onChange,
}: {
  kind: FieldKind;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  if (kind === "status" || kind === "priority") {
    const options = kind === "status" ? TASK_STATUS_OPTIONS : TASK_PRIORITY_OPTIONS;
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-invalid={invalid}>
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value"
      aria-invalid={invalid}
    />
  );
}

// ── Param editors per action type ─────────────────────────────────────────────

function ActionParamsEditor({
  action,
  users,
  projects,
  errors,
  onParam,
}: {
  action: DraftAction;
  users: { id: string; firstName: string | null; lastName: string | null; email: string }[];
  projects: { id: string; title: string; projectNumber?: string }[];
  errors: Record<string, string>;
  onParam: (field: string, value: string) => void;
}) {
  const p = action.params;
  const err = (field: string) => errors[`a:${action.key}:${field}`];

  const UserPicker = ({ field, label }: { field: string; label: string }) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={p[field] ?? ""} onValueChange={(v) => onParam(field, v)}>
        <SelectTrigger aria-invalid={!!err(field)}>
          <SelectValue placeholder="Choose a person…" />
        </SelectTrigger>
        <SelectContent>
          {users.length === 0 ? (
            <SelectItem value="__none" disabled>
              No users available
            </SelectItem>
          ) : (
            users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {userDisplayName(u)}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {err(field) && <p className="text-xs text-rose-600">{err(field)}</p>}
    </div>
  );

  switch (action.type) {
    case "assign_task":
      return <UserPicker field="userId" label="Assign to" />;

    case "notify":
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <UserPicker field="userId" label="Notify" />
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Message (optional)</Label>
            <Input
              value={p.message ?? ""}
              onChange={(e) => onParam("message", e.target.value)}
              placeholder="e.g. A new urgent task needs you"
            />
          </div>
        </div>
      );

    case "set_status":
      return (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">New status</Label>
          <Select value={p.status ?? ""} onValueChange={(v) => onParam("status", v)}>
            <SelectTrigger aria-invalid={!!err("status")}>
              <SelectValue placeholder="Choose a status…" />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err("status") && <p className="text-xs text-rose-600">{err("status")}</p>}
        </div>
      );

    case "add_comment":
      return (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Comment</Label>
          <Textarea
            value={p.text ?? ""}
            onChange={(e) => onParam("text", e.target.value)}
            placeholder="The comment to post on the task…"
            rows={3}
            aria-invalid={!!err("text")}
          />
          {err("text") && <p className="text-xs text-rose-600">{err("text")}</p>}
        </div>
      );

    case "create_task":
      return (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Task title</Label>
            <Input
              value={p.title ?? ""}
              onChange={(e) => onParam("title", e.target.value)}
              placeholder="e.g. Follow up with the client"
              aria-invalid={!!err("title")}
            />
            {err("title") && <p className="text-xs text-rose-600">{err("title")}</p>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Priority (optional)</Label>
              <Select value={p.priority ?? ""} onValueChange={(v) => onParam("priority", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Project (optional)</Label>
              <Select value={p.projectId ?? ""} onValueChange={(v) => onParam("projectId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Same as trigger" />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No projects available
                    </SelectItem>
                  ) : (
                    projects.map((pr) => (
                      <SelectItem key={pr.id} value={pr.id}>
                        {projectDisplayName(pr)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StepBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${tone}`}
    >
      {children}
    </span>
  );
}

/**
 * Coerce a condition's free-typed value to a sensible JSON type. Enum-y fields
 * (status/priority) and text stay strings; numeric comparisons (gt/lt) over a
 * purely-numeric string become numbers so the engine compares numerically.
 */
function coerceValue(trigger: AutomationTrigger, field: string, raw: string): unknown {
  const meta = fieldMetaFor(trigger, field);
  if (meta?.kind === "status" || meta?.kind === "priority") return raw;
  if (raw.trim() !== "" && /^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  return raw;
}

/** Strip empty optional params so the backend gets a clean per-type body. */
function serializeActionParams(a: DraftAction): Record<string, unknown> {
  const p = a.params;
  switch (a.type) {
    case "assign_task":
      return { userId: p.userId?.trim() ?? "" };
    case "set_status":
      return { status: p.status ?? "" };
    case "add_comment":
      return { text: p.text ?? "" };
    case "notify": {
      const out: Record<string, unknown> = { userId: p.userId?.trim() ?? "" };
      if (p.message?.trim()) out.message = p.message.trim();
      return out;
    }
    case "create_task": {
      const out: Record<string, unknown> = { title: p.title?.trim() ?? "" };
      if (p.priority?.trim()) out.priority = p.priority;
      if (p.projectId?.trim()) out.projectId = p.projectId;
      return out;
    }
    default:
      return {};
  }
}
