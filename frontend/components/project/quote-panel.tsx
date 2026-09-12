"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

/**
 * Quote panel (QUOTES-CONTRACT-v1 §3): the accepted Customer-Ops quote a
 * project came from. Reads `GET /projects/:id/quote` (staff) or
 * `GET /client-portal/projects/:id/quote` (portal — the backend masks to
 * number, title, totals, status and the share link). Self-hides when the
 * project has no quote or the endpoint is unavailable; degrades to the cached
 * summary with a note when Customer-Ops is not connected. Money is integer
 * cents; "Amounts exclude tax" sits next to the totals (Amendment 01 A9).
 */

export interface QuotePanelTotals {
  currency: string;
  one_time_total_cents: number;
  milestone_total_cents: number;
  recurring_monthly_cents: number;
  one_time_plus_milestones_cents: number;
  hourly_rate_cents?: number | null;
  year_one_illustration_cents?: number | null;
  deposit_cents?: number | null;
}

export interface QuotePanelQuote {
  number: string;
  version: number;
  title: string;
  status: string;
  totals: QuotePanelTotals;
  share_url: string;
  accepted_at?: string | null;
  valid_until?: string | null;
}

export interface QuotePanelData {
  linked: boolean;
  source?: "customer-ops" | "cached";
  configured?: boolean;
  degraded?: { reason: string; message: string } | null;
  tax_note?: string;
  schedule_ids?: string[];
  quote?: QuotePanelQuote | null;
}

export function formatCents(cents: number | null | undefined, currency: string): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

const STATUS_CLASS: Record<string, string> = {
  accepted: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  sent: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  viewed: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  declined: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  expired: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  voided: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export interface QuotePanelProps {
  /** API path relative to the axios base, e.g. `/projects/${id}/quote`. */
  endpoint: string;
  /** Visual variant: dense staff card vs the calmer portal card. */
  variant?: "staff" | "portal";
}

export function QuotePanel({ endpoint, variant = "staff" }: QuotePanelProps) {
  const [data, setData] = useState<QuotePanelData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<QuotePanelData>(endpoint)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        // 403/404/500 → the panel simply does not render; nothing to alarm about.
        if (!cancelled) setData({ linked: false });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  if (!data?.linked || !data.quote) return null;

  const { quote } = data;
  const currency = quote.totals?.currency || "USD";
  const statusKey = (quote.status || "").toLowerCase();
  const statusClass = STATUS_CLASS[statusKey] ?? "border-border bg-muted text-muted-foreground";
  const taxNote = data.tax_note || "Amounts exclude tax; tax is applied on the invoice.";
  const isPortal = variant === "portal";

  const tiles: Array<{ label: string; value: string }> = [
    { label: "One-time", value: formatCents(quote.totals?.one_time_total_cents, currency) },
    { label: "Milestones", value: formatCents(quote.totals?.milestone_total_cents, currency) },
    { label: "Monthly recurring", value: formatCents(quote.totals?.recurring_monthly_cents, currency) },
    { label: "Committed (one-time + milestones)", value: formatCents(quote.totals?.one_time_plus_milestones_cents, currency) },
  ];
  if (!isPortal && quote.totals?.deposit_cents != null) {
    // A5 — the first invoice Accounting-Ops drafts. STAFF ONLY: the backend's
    // client mask never emits `deposit_cents`, and this guard keeps that a
    // deliberate choice here rather than an accident of the payload.
    tiles.push({ label: "Deposit", value: formatCents(quote.totals.deposit_cents, currency) });
  }

  const header = (
    <div className={isPortal ? "flex flex-wrap items-center gap-2 border-b border-border px-6 py-4" : "mb-4 flex flex-wrap items-center gap-2"}>
      <FileText className="h-5 w-5 text-primary" />
      <h2 className={isPortal ? "text-lg font-bold text-foreground" : "text-lg font-semibold"}>Quote</h2>
      <span className="font-mono text-sm text-muted-foreground">
        {quote.number} v{quote.version}
      </span>
      <Badge className={`capitalize ${statusClass}`}>{quote.status || "unknown"}</Badge>
      {quote.share_url && (
        <a
          href={quote.share_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open quote
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
    </div>
  );

  const body = (
    <div className={isPortal ? "space-y-4 px-6 py-5" : "space-y-4"}>
      {quote.title && <p className="font-medium text-foreground">{quote.title}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{t.value}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{taxNote}</p>

      {!isPortal && quote.totals?.hourly_rate_cents != null && (
        <p className="text-sm text-muted-foreground">
          Hourly rate (primary): <span className="font-medium text-foreground">{formatCents(quote.totals.hourly_rate_cents, currency)}/h</span>
        </p>
      )}

      {data.degraded ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {isPortal ? data.degraded.message : `Cached summary — ${data.degraded.message}`}
        </p>
      ) : (
        !isPortal && <p className="text-xs text-muted-foreground">Live from Customer-Ops.</p>
      )}
    </div>
  );

  return isPortal ? (
    <Card className="overflow-hidden bg-card">
      {header}
      {body}
    </Card>
  ) : (
    <Card className="p-6">
      {header}
      {body}
    </Card>
  );
}
