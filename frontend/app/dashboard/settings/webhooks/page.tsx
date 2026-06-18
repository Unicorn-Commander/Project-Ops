"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { iconWellClass } from "@/lib/badge-styles";
import {
  ChevronLeft,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import {
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  testWebhook,
  updateWebhook,
  isCreatedWebhookEndpoint,
  type CreatedWebhookEndpoint,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@/lib/webhooks-api";
import {
  LastDeliveryCell,
} from "@/components/webhooks/webhook-helpers";
import { WebhookFormDialog } from "@/components/webhooks/webhook-form-dialog";
import { WebhookSecretDialog } from "@/components/webhooks/webhook-secret-dialog";
import { WebhookDeliveriesDrawer } from "@/components/webhooks/webhook-deliveries-drawer";

/**
 * Outbound webhooks settings.
 *
 * Lists the workspace's webhook endpoints and lets an ADMIN/MANAGER add, edit,
 * enable/disable, rotate the signing secret, send a test ping, view the delivery
 * log, and delete an endpoint. The signing secret follows a strict show-once
 * contract (see {@link WebhookSecretDialog}).
 */
export default function WebhooksSettingsPage() {
  const { toast } = useToast();

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Per-endpoint most-recent delivery, for the "last delivery" column. */
  const [lastDeliveries, setLastDeliveries] = useState<
    Record<string, WebhookDelivery | null>
  >({});

  // Dialog / drawer state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [revealed, setRevealed] = useState<{
    endpoint: CreatedWebhookEndpoint;
    rotated: boolean;
  } | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpoint | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  /** Ids currently mid-mutation (toggle/test) — disables their controls. */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  function setBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Load the latest delivery for each endpoint (cheap limit=1 each). */
  const loadLastDeliveries = useCallback(async (eps: WebhookEndpoint[]) => {
    const entries = await Promise.all(
      eps.map(async (ep) => {
        try {
          const page = await listDeliveries(ep.id, { limit: 1, offset: 0 });
          return [ep.id, page.data[0] ?? null] as const;
        } catch {
          return [ep.id, null] as const;
        }
      }),
    );
    setLastDeliveries(Object.fromEntries(entries));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listWebhooks();
      setEndpoints(list);
      // Fire-and-forget the per-endpoint last-delivery fetch.
      void loadLastDeliveries(list);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          "Couldn't load webhooks. You may not have permission, or the server is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [loadLastDeliveries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleEnabled(ep: WebhookEndpoint, enabled: boolean) {
    setBusy(ep.id, true);
    // Optimistic flip.
    setEndpoints((prev) =>
      prev?.map((e) => (e.id === ep.id ? { ...e, enabled } : e)) ?? prev,
    );
    try {
      await updateWebhook(ep.id, { enabled });
      toast({
        title: enabled ? "Webhook enabled" : "Webhook paused",
        description: enabled
          ? "Subscribed events will be delivered to this endpoint."
          : "Deliveries are paused until you re-enable it.",
      });
    } catch (err: any) {
      // Roll back.
      setEndpoints((prev) =>
        prev?.map((e) => (e.id === ep.id ? { ...e, enabled: !enabled } : e)) ??
        prev,
      );
      toast({
        title: "Couldn't update webhook",
        description: err?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(ep.id, false);
    }
  }

  async function handleTest(ep: WebhookEndpoint) {
    setBusy(ep.id, true);
    try {
      const result = await testWebhook(ep.id);
      toast({
        title: "Test ping sent",
        description: `Result: ${result.status}.`,
        variant: result.status === "FAILED" ? "destructive" : undefined,
      });
      // Refresh that endpoint's last-delivery indicator.
      const page = await listDeliveries(ep.id, { limit: 1, offset: 0 });
      setLastDeliveries((prev) => ({ ...prev, [ep.id]: page.data[0] ?? null }));
    } catch (err: any) {
      toast({
        title: "Couldn't send test ping",
        description: err?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(ep.id, false);
    }
  }

  async function handleRotate(id: string) {
    setRotatingId(null);
    setBusy(id, true);
    try {
      const result = await updateWebhook(id, { rotateSecret: true });
      if (isCreatedWebhookEndpoint(result)) {
        setRevealed({ endpoint: result, rotated: true });
      } else {
        // Shouldn't happen (rotate always returns the secret), but stay safe.
        toast({
          title: "Secret rotated",
          description: "The new secret wasn't returned — try rotating again.",
          variant: "destructive",
        });
      }
      refresh();
    } catch (err: any) {
      toast({
        title: "Couldn't rotate secret",
        description: err?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(id, false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(null);
    setBusy(id, true);
    try {
      await deleteWebhook(id);
      toast({
        title: "Webhook deleted",
        description: "It will no longer receive events.",
      });
      refresh();
    } catch (err: any) {
      toast({
        title: "Couldn't delete webhook",
        description: err?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(id, false);
    }
  }

  const deletingEndpoint = endpoints?.find((e) => e.id === deletingId);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header + back link */}
      <div>
        <Link
          href="/dashboard/settings"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to settings
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Webhooks</h1>
            <p className="mt-1 text-muted-foreground">
              Get notified at your own URL when things happen in this workspace.
              Each delivery is signed so you can verify it came from Project-Ops.
            </p>
          </div>
          {endpoints && endpoints.length > 0 && (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add webhook
            </Button>
          )}
        </div>
      </div>

      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <div
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("violet")}`}
          >
            <Webhook className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Endpoints</h2>
            <p className="text-xs text-muted-foreground">
              Outbound HTTPS sinks for task and project lifecycle events.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading webhooks…
          </div>
        ) : error ? (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              {error}
            </div>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : !endpoints || endpoints.length === 0 ? (
          <EmptyState
            icon={Webhook}
            iconTone="violet"
            title="No webhooks yet"
            body="Add an endpoint to receive signed event payloads at your own URL — handy for syncing tasks into Slack, a CI system, or your own automation."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add your first webhook
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {endpoints.map((ep) => (
              <WebhookRow
                key={ep.id}
                endpoint={ep}
                lastDelivery={lastDeliveries[ep.id]}
                busy={busyIds.has(ep.id)}
                onToggle={(enabled) => handleToggleEnabled(ep, enabled)}
                onTest={() => handleTest(ep)}
                onEdit={() => {
                  setEditing(ep);
                  setFormOpen(true);
                }}
                onRotate={() => setRotatingId(ep.id)}
                onDelete={() => setDeletingId(ep.id)}
                onViewDeliveries={() => setDeliveriesFor(ep)}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Create / edit */}
      <WebhookFormDialog
        open={formOpen}
        endpoint={editing}
        onOpenChange={setFormOpen}
        onSaved={refresh}
        onCreated={(created) => {
          setRevealed({ endpoint: created, rotated: false });
          refresh();
        }}
      />

      {/* Show-once secret (create or rotate) */}
      {revealed && (
        <WebhookSecretDialog
          endpoint={revealed.endpoint}
          rotated={revealed.rotated}
          onAcknowledge={() => setRevealed(null)}
        />
      )}

      {/* Deliveries drawer */}
      <WebhookDeliveriesDrawer
        endpoint={deliveriesFor}
        open={!!deliveriesFor}
        onOpenChange={(o) => {
          if (!o) setDeliveriesFor(null);
        }}
      />

      {/* Rotate-secret confirm */}
      <AlertDialog
        open={!!rotatingId}
        onOpenChange={(o) => !o && setRotatingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate signing secret?</AlertDialogTitle>
            <AlertDialogDescription>
              A new signing secret will be generated and shown once. The current
              secret stops working immediately, so any receiver verifying
              signatures will reject deliveries until you update it with the new
              secret.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rotatingId && handleRotate(rotatingId)}
            >
              Rotate secret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={(o) => !o && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingEndpoint ? (
                <>
                  <span className="font-mono text-foreground">
                    {deletingEndpoint.url}
                  </span>{" "}
                  will stop receiving events and its delivery history will be
                  removed. This can&apos;t be undone.
                </>
              ) : (
                "This endpoint will stop receiving events and its delivery history will be removed. This can't be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId && handleDelete(deletingId)}
            >
              Delete webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Endpoint row
// ---------------------------------------------------------------------------

function WebhookRow({
  endpoint,
  lastDelivery,
  busy,
  onToggle,
  onTest,
  onEdit,
  onRotate,
  onDelete,
  onViewDeliveries,
}: {
  endpoint: WebhookEndpoint;
  lastDelivery: WebhookDelivery | null | undefined;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onViewDeliveries: () => void;
}) {
  return (
    <li className="rounded-md border p-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span
              className="truncate font-mono text-sm text-foreground"
              title={endpoint.url}
            >
              {endpoint.url}
            </span>
            {!endpoint.enabled && (
              <span className="shrink-0 rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Paused
              </span>
            )}
          </div>

          {endpoint.description && (
            <p className="text-xs text-muted-foreground">{endpoint.description}</p>
          )}

          {/* Subscribed events */}
          <div className="flex flex-wrap gap-1">
            {endpoint.events.length === 0 ? (
              <span className="text-xs text-muted-foreground">No events</span>
            ) : (
              endpoint.events.map((e) => (
                <span
                  key={e}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {e}
                </span>
              ))
            )}
          </div>

          <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <KeyRound className="h-3 w-3" />
              <span className="font-mono">{endpoint.secretHint}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1.5">
              Last delivery: <LastDeliveryCell delivery={lastDelivery} />
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            checked={endpoint.enabled}
            onCheckedChange={onToggle}
            disabled={busy}
            aria-label={endpoint.enabled ? "Disable webhook" : "Enable webhook"}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" disabled={busy} aria-label="Webhook actions">
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onViewDeliveries}>
                <ScrollText className="mr-2 h-4 w-4" />
                View deliveries
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onTest}>
                <Send className="mr-2 h-4 w-4" />
                Send test ping
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRotate}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Rotate secret
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
