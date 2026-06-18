"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_NAMES,
  createWebhook,
  updateWebhook,
  isCreatedWebhookEndpoint,
  type CreatedWebhookEndpoint,
  type WebhookEndpoint,
} from "@/lib/webhooks-api";

/**
 * Create / edit form for a webhook endpoint, in a Radix Dialog.
 *
 * - Create mode (no `endpoint`): url + events + description. On success the
 *   parent receives the {@link CreatedWebhookEndpoint} (carrying the signing
 *   secret) via `onCreated` so it can show the secret ONCE.
 * - Edit mode (`endpoint` set): pre-fills url/events/description; submits a
 *   PATCH. Secret rotation lives on the list row (a separate confirm), not here.
 *
 * The URL must be https (the backend also enforces this, allowing http only for
 * loopback dev receivers); we validate https up-front for a fast, clear error.
 */
export function WebhookFormDialog({
  open,
  endpoint,
  onOpenChange,
  onSaved,
  onCreated,
}: {
  open: boolean;
  /** Present → edit mode; absent → create mode. */
  endpoint?: WebhookEndpoint | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful edit (PATCH) so the parent can refresh. */
  onSaved: () => void;
  /** Called after a successful create, with the secret-bearing response. */
  onCreated: (created: CreatedWebhookEndpoint) => void;
}) {
  const { toast } = useToast();
  const isEdit = !!endpoint;

  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Reset / hydrate the form whenever it opens or the target endpoint changes.
  // (Done in an effect, never in a useState initializer — the dialog persists
  // across opens and `endpoint` is async-loaded.)
  useEffect(() => {
    if (!open) return;
    setUrl(endpoint?.url ?? "");
    setSelectedEvents(endpoint?.events ?? []);
    setDescription(endpoint?.description ?? "");
    setUrlError(null);
  }, [open, endpoint]);

  const allSelected = useMemo(
    () => WEBHOOK_EVENT_NAMES.every((e) => selectedEvents.includes(e)),
    [selectedEvents],
  );

  function toggleEvent(name: string) {
    setSelectedEvents((current) =>
      current.includes(name)
        ? current.filter((e) => e !== name)
        : [...current, name],
    );
  }

  function toggleAll() {
    setSelectedEvents(allSelected ? [] : [...WEBHOOK_EVENT_NAMES]);
  }

  /** https required; http only for localhost/127.0.0.1 (matches the backend). */
  function validateUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return "A delivery URL is required.";
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return "Enter a valid absolute URL (including https://).";
    }
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    if (parsed.protocol === "https:") return null;
    if (parsed.protocol === "http:" && isLoopback) return null;
    return "URL must use https:// (http:// is allowed only for localhost during development).";
  }

  async function handleSubmit() {
    const trimmedUrl = url.trim();
    const validation = validateUrl(trimmedUrl);
    if (validation) {
      setUrlError(validation);
      return;
    }
    if (selectedEvents.length === 0) {
      toast({
        title: "Pick at least one event",
        description: "A webhook with no subscribed events would never fire.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const trimmedDescription = description.trim();
      if (isEdit && endpoint) {
        const result = await updateWebhook(endpoint.id, {
          url: trimmedUrl,
          events: selectedEvents,
          description: trimmedDescription || undefined,
        });
        toast({ title: "Webhook updated" });
        onOpenChange(false);
        // A non-rotating PATCH won't carry a secret, but narrow defensively.
        if (isCreatedWebhookEndpoint(result)) {
          onCreated(result);
        } else {
          onSaved();
        }
      } else {
        const created = await createWebhook({
          url: trimmedUrl,
          events: selectedEvents,
          description: trimmedDescription || undefined,
        });
        onOpenChange(false);
        onCreated(created);
      }
    } catch (err: any) {
      toast({
        title: isEdit ? "Couldn't update webhook" : "Couldn't create webhook",
        description:
          err?.response?.data?.message ??
          "The server rejected the request. Check the URL and events, then try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (submitting ? null : onOpenChange(o))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit webhook" : "Add webhook endpoint"}</DialogTitle>
          <DialogDescription>
            Project-Ops will POST a signed JSON payload to this URL whenever one
            of the selected events happens in this workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="https://hooks.example.com/project-ops"
              disabled={submitting}
              aria-invalid={!!urlError}
              aria-describedby={urlError ? "webhook-url-error" : undefined}
            />
            {urlError ? (
              <p id="webhook-url-error" className="text-xs text-rose-600 dark:text-rose-400">
                {urlError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Must be https. Payloads are signed so your receiver can verify
                they came from Project-Ops.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Events</Label>
              <button
                type="button"
                onClick={toggleAll}
                disabled={submitting}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="rounded-md border p-3 space-y-2 max-h-60 overflow-y-auto">
              {WEBHOOK_EVENTS.map((event) => (
                <label
                  key={event.name}
                  className="flex items-start gap-2.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    checked={selectedEvents.includes(event.name)}
                    onChange={() => toggleEvent(event.name)}
                    disabled={submitting}
                  />
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{event.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {event.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedEvents.length} of {WEBHOOK_EVENT_NAMES.length} selected.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-description">Description (optional)</Label>
            <Textarea
              id="webhook-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this endpoint for? e.g. 'Sync tasks into our Slack bot'."
              disabled={submitting}
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
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
              "Create webhook"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
