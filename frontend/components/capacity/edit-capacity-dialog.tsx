"use client";

/**
 * EditCapacityDialog — ADMIN/MANAGER affordance to set a member's WEEKLY
 * capacity hours (PATCH /capacity/users/:id, backend bounds 0–168). The page
 * only mounts this for ADMIN/MANAGER, but the action itself is also enforced
 * server-side, so this is a convenience surface, not the security boundary.
 *
 * Important: the report row carries `capacityHours` PRO-RATED to the window,
 * not the weekly budget. We therefore can't pre-fill the input from the row —
 * we default to the schema default (40) on first edit and let the manager type
 * the weekly number, then preview what that prorates to for the current window
 * so the change is legible.
 *
 * Hydration: no localStorage/Date/navigator reads here — value state is seeded
 * from props in an effect keyed on the open row, never in a useState
 * initializer during render.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  setUserCapacity,
  fmtHours,
  type UserCapacityRow,
} from "@/lib/capacity-api";

const DEFAULT_WEEKLY = 40;
const MIN = 0;
const MAX = 168;

export function EditCapacityDialog({
  row,
  windowDays,
  open,
  onOpenChange,
  onSaved,
}: {
  /** The member being edited, or null when closed. */
  row: UserCapacityRow | null;
  /** Inclusive day-count of the active window — for the prorate preview. */
  windowDays: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful PATCH so the page can refetch. */
  onSaved: (result: { userId: string; weeklyCapacityHours: number }) => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState<string>(String(DEFAULT_WEEKLY));
  const [saving, setSaving] = useState(false);

  // Seed the input whenever a new row is opened (effect, never in render).
  useEffect(() => {
    if (open) setValue(String(DEFAULT_WEEKLY));
  }, [open, row?.userId]);

  const numeric = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isFinite(numeric) &&
    numeric >= MIN &&
    numeric <= MAX;

  // What the entered weekly budget prorates to for the current window.
  const proratedPreview = valid
    ? Math.round(((numeric * windowDays) / 7) * 100) / 100
    : null;

  const handleSave = async () => {
    if (!row || !valid) return;
    setSaving(true);
    try {
      const result = await setUserCapacity(row.userId, numeric);
      toast({
        title: "Capacity updated",
        description: `${result.name} is now set to ${result.weeklyCapacityHours}h / week.`,
      });
      onSaved({
        userId: result.userId,
        weeklyCapacityHours: result.weeklyCapacityHours,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const status =
        typeof err === "object" &&
        err !== null &&
        "response" in err &&
        typeof (err as { response?: { status?: number } }).response?.status ===
          "number"
          ? (err as { response: { status: number } }).response.status
          : undefined;
      toast({
        variant: "destructive",
        title: "Couldn’t update capacity",
        description:
          status === 403
            ? "You don’t have permission to change capacity."
            : status === 404
              ? "That person is no longer a member of this workspace."
              : "Something went wrong saving the weekly capacity. Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Edit weekly capacity</DialogTitle>
          <DialogDescription>
            {row ? (
              <>
                Set how many hours <span className="font-medium">{row.name}</span>{" "}
                is available per week. This drives every utilization figure.
              </>
            ) : (
              "Set a member's weekly available hours."
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="weekly-capacity">Weekly capacity (hours)</Label>
            <Input
              id="weekly-capacity"
              type="number"
              inputMode="decimal"
              min={MIN}
              max={MAX}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              aria-invalid={!valid}
              className="font-mono tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              {valid && proratedPreview !== null ? (
                <>
                  ≈ <span className="font-medium text-foreground">
                    {fmtHours(proratedPreview)}
                  </span>{" "}
                  across the current {windowDays}-day window.
                </>
              ) : (
                <span className="text-rose-600 dark:text-rose-400">
                  Enter a number between {MIN} and {MAX}.
                </span>
              )}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save capacity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
