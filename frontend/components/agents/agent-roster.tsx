"use client";

import Link from "next/link";
import { Bot, ChevronRight, FolderKanban } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { AgentSummary } from "@/lib/agents-api";
import {
  KindBadge,
  RelativeTime,
  ViaBadge,
  formatCost,
  formatInt,
  formatTokens,
} from "./agent-format";

interface AgentRosterProps {
  agents: AgentSummary[];
}

export function AgentRoster({ agents }: AgentRosterProps) {
  if (agents.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Bot}
          iconTone="violet"
          title="No agents yet"
          body="AI agent activity will appear here once API, assistant, MCP, or system events are recorded."
        />
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-foreground">Agent roster</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Who did the work, where they came from, and what they touched.
        </p>
      </div>
      <div className="divide-y divide-border">
        {agents.map((agent) => (
          <Link
            key={agent.actorKey}
            href={`/dashboard/agents/${encodeURIComponent(agent.actorKey)}`}
            className="group grid gap-3 py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring sm:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.8fr))_auto] sm:items-center sm:px-2"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-foreground">
                  {agent.actorLabel}
                </span>
                <KindBadge kind={agent.actorKind} />
                <ViaBadge via={agent.via} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Last active <RelativeTime value={agent.lastActiveAt} />
              </p>
            </div>
            <Metric label="Events" value={formatInt(agent.eventCount)} />
            <Metric
              label="Tokens"
              value={formatTokens(agent.tokensIn, agent.tokensOut)}
            />
            <Metric label="Cost" value={formatCost(agent.costUsd)} />
            <Metric label="Billable" value={formatCost(agent.billableCostUsd)} />
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:justify-end">
              <span className="inline-flex items-center gap-1">
                <FolderKanban className="h-3.5 w-3.5" />
                {formatInt(agent.projectCount)}
              </span>
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
