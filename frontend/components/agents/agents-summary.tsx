"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CalendarRange,
  CircleDollarSign,
  Hash,
  Receipt,
  Route,
} from "lucide-react";
import { HelpHint } from "@/components/guidance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { iconWellClass } from "@/lib/badge-styles";
import { ShortDate, formatCost, formatInt } from "./agent-format";
import type { ReactNode } from "react";

export interface AgentDateWindow {
  from: string;
  to: string;
}

interface AgentsHeaderProps {
  title: string;
  subtitle?: string;
  win: AgentDateWindow | null;
  onChange: (win: AgentDateWindow) => void;
  onRefresh?: () => void;
}

export function AgentsHeader({
  title,
  subtitle = "Track the work your AI agents did — and what it cost.",
  win,
  onChange,
  onRefresh,
}: AgentsHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-normal text-foreground">
          {title}
          <HelpHint side="right">
            Agent activity includes assistant calls, MCP tool work, API-token
            actions, and system automation events.
          </HelpHint>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label="Start date"
          value={win?.from ?? ""}
          onChange={(event) =>
            win && onChange({ ...win, from: event.target.value })
          }
          className="w-36"
        />
        <Input
          type="date"
          aria-label="End date"
          value={win?.to ?? ""}
          onChange={(event) => win && onChange({ ...win, to: event.target.value })}
          className="w-36"
        />
        {onRefresh && (
          <Button variant="outline" onClick={onRefresh}>
            <CalendarRange className="h-4 w-4" />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}

interface AgentsKpisProps {
  agentCount: number;
  eventCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  billableCostUsd?: number;
}

export function AgentsKpis({
  agentCount,
  eventCount,
  tokensIn,
  tokensOut,
  costUsd,
  billableCostUsd,
}: AgentsKpisProps) {
  const totalTokens = tokensIn + tokensOut;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Active agents" value={formatInt(agentCount)} icon={Bot} tone="violet" />
      <KpiCard label="Agent events" value={formatInt(eventCount)} icon={Route} tone="blue" />
      <KpiCard label="Total tokens" value={formatInt(totalTokens)} icon={Hash} tone="amber" />
      <KpiCard
        label="Total cost"
        value={formatCost(costUsd)}
        subvalue={
          billableCostUsd !== undefined
            ? `${formatCost(billableCostUsd)} billable`
            : undefined
        }
        icon={CircleDollarSign}
        tone="emerald"
      />
    </div>
  );
}

export function AgentDetailKpis({
  eventCount,
  tokensIn,
  tokensOut,
  costUsd,
  firstSeenAt,
  lastActiveAt,
}: {
  eventCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Events" value={formatInt(eventCount)} icon={Route} tone="blue" />
      <KpiCard label="Tokens" value={formatInt(tokensIn + tokensOut)} icon={Hash} tone="amber" />
      <KpiCard label="Cost" value={formatCost(costUsd)} icon={CircleDollarSign} tone="emerald" />
      <KpiCard
        label="Seen"
        value={<ShortDate value={firstSeenAt} />}
        subvalue={lastActiveAt ? <span>Last <ShortDate value={lastActiveAt} /></span> : undefined}
        icon={Receipt}
        tone="zinc"
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  subvalue,
  icon: Icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  subvalue?: ReactNode;
  icon: LucideIcon;
  tone: "blue" | "amber" | "emerald" | "violet" | "zinc";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 truncate font-mono text-2xl font-semibold tabular-nums text-foreground">
            {value}
          </p>
          {subvalue && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{subvalue}</p>
          )}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconWellClass(tone)}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
