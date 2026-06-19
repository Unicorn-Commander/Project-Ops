"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AgentActivityFeed, type ActivityFilters } from "@/components/agents/agent-activity-feed";
import { AgentRoster } from "@/components/agents/agent-roster";
import { AgentsUsageCharts } from "@/components/agents/agents-charts";
import { AgentsHeader, AgentsKpis, type AgentDateWindow } from "@/components/agents/agents-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import type {
  AgentActivityRow,
  AgentsActivityResponse,
  AgentsListResponse,
  AgentsUsageResponse,
} from "@/lib/agents-api";
import { getAgentActivity, getAgents, getAgentsUsage } from "@/lib/agents-api";

const PAGE_SIZE = 25;

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoStart(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function toIsoEnd(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

export default function AgentsPage() {
  const { toast } = useToast();
  const [win, setWin] = useState<AgentDateWindow | null>(null);
  const [agents, setAgents] = useState<AgentsListResponse | null>(null);
  const [usage, setUsage] = useState<AgentsUsageResponse | null>(null);
  const [activity, setActivity] = useState<AgentsActivityResponse | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - 30);
    setWin({ from: dateInputValue(from), to: dateInputValue(to) });
  }, []);

  const fetchAll = useCallback(async () => {
    if (!win) return;
    setLoading(true);
    setError(false);
    try {
      const params = { from: toIsoStart(win.from), to: toIsoEnd(win.to) };
      const [agentsRes, usageRes, activityRes] = await Promise.all([
        getAgents(),
        getAgentsUsage(params),
        getAgentActivity({
          ...params,
          ...filters,
          limit: PAGE_SIZE,
          offset,
        }),
      ]);
      setAgents(agentsRes);
      setUsage(usageRes);
      setActivity(activityRes);
    } catch (err) {
      console.error("Error loading agents dashboard:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [win, filters, offset]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const billableCost = useMemo(
    () =>
      (agents?.agents ?? []).reduce(
        (sum, agent) => sum + (agent.billableCostUsd ?? 0),
        0,
      ),
    [agents],
  );

  const handleFiltersChange = (next: ActivityFilters) => {
    setFilters(next);
    setOffset(0);
  };

  const handleRowUpdated = (row: AgentActivityRow) => {
    setActivity((current) =>
      current
        ? {
            ...current,
            data: current.data.map((item) => (item.id === row.id ? row : item)),
          }
        : current,
    );
  };

  const retry = () => {
    toast({ title: "Retrying", description: "Reloading agent activity." });
    void fetchAll();
  };

  if (!win || loading) {
    return (
      <div className="po-page-enter space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-9 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Card key={item} className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-20" />
                </div>
                <Skeleton className="h-10 w-10 rounded-lg" />
              </div>
            </Card>
          ))}
        </div>
        <Card className="p-6">
          <Skeleton className="h-72 w-full" />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="po-page-enter space-y-6">
        <AgentsHeader title="Agents" win={win} onChange={setWin} onRefresh={retry} />
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn't load agent activity"
            body="Something went wrong fetching the agent reports. Check your connection and try again."
            action={
              <Button variant="outline" onClick={retry}>
                Try again
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const totals = agents?.totals ?? {
    agentCount: 0,
    eventCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };

  return (
    <div className="po-page-enter space-y-6">
      <AgentsHeader title="Agents" win={win} onChange={setWin} onRefresh={fetchAll} />
      <AgentsKpis
        agentCount={totals.agentCount}
        eventCount={totals.eventCount}
        tokensIn={totals.tokensIn}
        tokensOut={totals.tokensOut}
        costUsd={totals.costUsd}
        billableCostUsd={billableCost}
      />
      <AgentRoster agents={agents?.agents ?? []} />
      <AgentsUsageCharts
        series={usage?.series ?? []}
        byAgent={usage?.byAgent ?? []}
      />
      <AgentActivityFeed
        rows={activity?.data ?? []}
        total={activity?.total ?? 0}
        limit={PAGE_SIZE}
        offset={offset}
        agents={agents?.agents ?? []}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onPageChange={setOffset}
        onRowUpdated={handleRowUpdated}
      />
    </div>
  );
}
