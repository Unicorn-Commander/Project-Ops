"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentKind, AgentVia } from "@/lib/agents-api";

const DASH = "—";

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatTokens(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  const total = (tokensIn ?? 0) + (tokensOut ?? 0);
  return total > 0 ? formatInt(total) : DASH;
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  if (value === 0) return "$0.00";
  const precision = Math.abs(value) < 0.01 ? 4 : 2;
  return `$${value.toFixed(precision)}`;
}

export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function actorKindLabel(kind: AgentKind): string {
  const labels: Record<AgentKind, string> = {
    PAT: "PAT",
    ASSISTANT: "Assistant",
    FEDERATED: "Federated",
    USER: "User",
    SYSTEM: "System",
  };
  return labels[kind];
}

export function viaLabel(via: AgentVia): string {
  const labels: Record<AgentVia, string> = {
    MCP: "MCP",
    API: "API",
    ASSISTANT: "Assistant",
    GUI: "GUI",
    SYSTEM: "System",
  };
  return labels[via];
}

export function KindBadge({ kind }: { kind: AgentKind }) {
  return (
    <Badge
      className={cn(
        "border-transparent font-medium",
        kind === "ASSISTANT" && "bg-violet-500/15 text-violet-700 dark:text-violet-300",
        kind === "PAT" && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
        kind === "FEDERATED" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        kind === "USER" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        kind === "SYSTEM" && "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
      )}
    >
      {actorKindLabel(kind)}
    </Badge>
  );
}

export function ViaBadge({ via }: { via: AgentVia }) {
  return (
    <Badge className="border-border/70 bg-background font-medium text-muted-foreground">
      {viaLabel(via)}
    </Badge>
  );
}

export function RelativeTime({ value }: { value: string | null }) {
  const [label, setLabel] = useState<string>("—");

  useEffect(() => {
    if (!value) {
      setLabel(DASH);
      return;
    }
    const update = () => {
      const now = Date.now();
      const then = new Date(value).getTime();
      const seconds = Math.max(0, Math.round((now - then) / 1000));
      if (seconds < 60) {
        setLabel("Just now");
        return;
      }
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) {
        setLabel(`${minutes}m ago`);
        return;
      }
      const hours = Math.round(minutes / 60);
      if (hours < 24) {
        setLabel(`${hours}h ago`);
        return;
      }
      const days = Math.round(hours / 24);
      if (days < 30) {
        setLabel(`${days}d ago`);
        return;
      }
      setLabel(formatDateTime(value));
    };
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [value]);

  return <span>{label}</span>;
}

export function AbsoluteTime({ value }: { value: string | null }) {
  const [label, setLabel] = useState<string>("—");

  useEffect(() => {
    setLabel(value ? formatDateTime(value) : DASH);
  }, [value]);

  return <span>{label}</span>;
}

export function ShortDate({ value }: { value: string | null }) {
  const [label, setLabel] = useState<string>("—");

  useEffect(() => {
    setLabel(value ? new Date(value).toLocaleDateString("en-US") : DASH);
  }, [value]);

  return <span>{label}</span>;
}
