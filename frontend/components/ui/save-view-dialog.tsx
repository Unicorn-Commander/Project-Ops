"use client";

import * as React from "react";
import { Bookmark } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Result of a confirmed save. The name is already trimmed (non-empty) and
 * `shared` reflects the toggle.
 */
export interface SaveViewResult {
  name: string;
  shared: boolean;
}

interface SaveViewDialogProps {
  /** Controls visibility. The dialog calls `onOpenChange(false)` to close. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * "create" → naming the current filter/sort snapshot as a new view.
   * "rename" → editing an existing owned view's name + shared flag.
   */
  mode: "create" | "rename";
  /** Pre-fill the name input (the existing name when renaming). */
  initialName?: string;
  /** Pre-fill the shared toggle (the existing flag when renaming). */
  initialShared?: boolean;
  /**
   * Confirm handler. Return value is awaited so the dialog can show a busy
   * state and stay open on failure. Resolve/return falsy (or throw) to keep
   * the dialog open; resolve truthy to let it close.
   */
  onSubmit: (result: SaveViewResult) => void | boolean | Promise<void | boolean>;
}

/**
 * Name-and-share dialog for saved views, replacing the old
 * `window.prompt` + `window.confirm` flow. Built on the shared Radix
 * `Dialog`, so it gets a focus trap, Escape-to-close, and an accessible
 * title/description for free. The name input is labelled and autofocused;
 * the share toggle is a labelled `Switch`. Enter submits, Save is disabled
 * while the name is empty or a request is in flight.
 *
 * Controlled: the parent owns `open`. State (name/shared) is seeded from the
 * `initial*` props each time the dialog opens so reopening for a different
 * view shows the right values.
 */
export function SaveViewDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  initialShared = false,
  onSubmit,
}: SaveViewDialogProps) {
  const [name, setName] = React.useState(initialName);
  const [shared, setShared] = React.useState(initialShared);
  const [busy, setBusy] = React.useState(false);

  // Re-seed from the initial values whenever the dialog (re)opens, so it
  // never shows stale text from a previous invocation.
  React.useEffect(() => {
    if (open) {
      setName(initialName);
      setShared(initialShared);
      setBusy(false);
    }
  }, [open, initialName, initialShared]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  const submit = React.useCallback(async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const result = await onSubmit({ name: trimmed, shared });
      // A falsy result means the caller wants the dialog kept open (e.g. the
      // save failed). `undefined` is treated as success for ergonomics.
      if (result === false) {
        setBusy(false);
        return;
      }
      onOpenChange(false);
    } catch {
      // Caller-side failure: stay open so the user can retry.
      setBusy(false);
    }
  }, [trimmed, shared, busy, onSubmit, onOpenChange]);

  const title = mode === "rename" ? "Rename view" : "Save view";
  const description =
    mode === "rename"
      ? "Update the name and who can see this view."
      : "Name this snapshot of the current filters and sort so you can restore it in one click.";
  const submitLabel = mode === "rename" ? "Save changes" : "Save view";
  const nameId = React.useId();
  const shareId = React.useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>View name</Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My open work"
              maxLength={120}
              disabled={busy}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor={shareId} className="cursor-pointer">
                Share with this workspace
              </Label>
              <p className="text-xs text-muted-foreground">
                Everyone in the workspace can apply it; only you can edit it.
              </p>
            </div>
            <Switch
              id={shareId}
              checked={shared}
              onCheckedChange={setShared}
              disabled={busy}
              aria-label="Share with this workspace"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
