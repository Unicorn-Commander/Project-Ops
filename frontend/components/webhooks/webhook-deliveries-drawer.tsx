"use client";

import { useCallback, useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { HelpHint } from "@/components/guidance";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import {
  listDeliveries,
  testWebhook,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@/lib/webhooks-api";
import {
  DeliveryStatusPill,
  formatTimestamp,
} from "./webhook-helpers";

const PAGE_SIZE = 20;

/**
 * Right-anchored slide-over showing the recent delivery log for one endpoint.
 *
 * Built directly on the Radix Dialog primitive (rather than the centered
 * DialogContent) so it docks to the right edge as a drawer. Each row shows the
 * status pill, response code, attempt count, settle time, and (expandable) the
 * error + the exact payload that was sent. A "Send test" button fires a `ping`
 * and refreshes the log so the result shows up immediately.
 */
export function WebhookDeliveriesDrawer({
  endpoint,
  open,
  onOpenChange,
}: {
  endpoint: WebhookEndpoint | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const hydrated = useHydrated();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const endpointId = endpoint?.id ?? null;

  const load = useCallback(
    async (nextOffset: number) => {
      if (!endpointId) return;
      setLoading(true);
      setError(null);
      try {
        const page = await listDeliveries(endpointId, {
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setDeliveries(page.data);
        setTotal(page.total);
        setOffset(page.offset);
      } catch (err: any) {
        setError(
          err?.response?.data?.message ??
            "Couldn't load deliveries. Try again in a moment.",
        );
      } finally {
        setLoading(false);
      }
    },
    [endpointId],
  );

  // (Re)load whenever the drawer opens for an endpoint. Reset paging + expansion.
  useEffect(() => {
    if (open && endpointId) {
      setExpanded(null);
      load(0);
    }
  }, [open, endpointId, load]);

  async function handleTest() {
    if (!endpointId) return;
    setTesting(true);
    try {
      const result = await testWebhook(endpointId);
      toast({
        title: "Test ping sent",
        description: `Delivery ${result.deliveryId.slice(0, 8)}… → ${result.status}.`,
        variant: result.status === "FAILED" ? "destructive" : undefined,
      });
      // Surface the new delivery row at the top.
      await load(0);
    } catch (err: any) {
      toast({
        title: "Couldn't send test ping",
        description:
          err?.response?.data?.message ??
          "The server rejected the request. Try again.",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-xl flex-col border-l bg-background shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "motion-reduce:animate-none motion-reduce:transition-none",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="flex items-center gap-1.5 text-base font-semibold">
                Recent deliveries
                <HelpHint
                  side="bottom"
                  learnMore={{ category: "webhooks", article: "webhooks-overview" }}
                >
                  Every attempt to POST to this endpoint, newest first — with the status,
                  response code, retry count, and the exact payload sent. <span className="font-semibold">Send
                  test</span> fires a sample <span className="font-mono">ping</span> event so you
                  can confirm your receiver before going live.
                </HelpHint>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {endpoint?.url ?? ""}
              </DialogPrimitive.Description>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTest}
                disabled={testing || !endpointId}
              >
                {testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send test
              </Button>
              <DialogPrimitive.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading deliveries…
              </div>
            ) : error ? (
              <div className="space-y-3">
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                  {error}
                </div>
                <Button size="sm" variant="outline" onClick={() => load(offset)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No deliveries yet. Send a test ping to verify your receiver, or
                trigger one of the subscribed events.
              </div>
            ) : (
              <ul className="space-y-2">
                {deliveries.map((d) => {
                  const isOpen = expanded === d.id;
                  return (
                    <li key={d.id} className="rounded-md border">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : d.id)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <DeliveryStatusPill status={d.status} />
                        <span className="font-mono text-xs">{d.event}</span>
                        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                          {d.responseCode != null && (
                            <span className="font-mono">HTTP {d.responseCode}</span>
                          )}
                          <span>
                            {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"}
                          </span>
                          <span className="hidden sm:inline">
                            {hydrated
                              ? formatTimestamp(d.deliveredAt ?? d.createdAt)
                              : ""}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div className="space-y-3 border-t px-3 py-3 text-xs">
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                            <dt className="text-muted-foreground">Delivery ID</dt>
                            <dd className="font-mono break-all">{d.id}</dd>
                            <dt className="text-muted-foreground">Created</dt>
                            <dd>{hydrated ? formatTimestamp(d.createdAt) : ""}</dd>
                            <dt className="text-muted-foreground">Delivered</dt>
                            <dd>{hydrated ? formatTimestamp(d.deliveredAt) : ""}</dd>
                          </dl>
                          {d.error && (
                            <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2">
                              <p className="mb-0.5 font-medium text-rose-700 dark:text-rose-300">
                                Error
                              </p>
                              <p className="break-words text-muted-foreground">
                                {d.error}
                              </p>
                            </div>
                          )}
                          <div>
                            <p className="mb-1 font-medium text-foreground">
                              Payload sent
                            </p>
                            <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                              {safeStringify(d.payload)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Pagination footer */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
              <span>
                Page {page} of {pageCount} · {total} total
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canPrev || loading}
                  onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canNext || loading}
                  onClick={() => load(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Pretty-print a JSON payload; fall back to String() for anything odd. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
