"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { AgentActivityFeed } from "@/components/agents/agent-activity-feed";
import { KindBadge, ViaBadge } from "@/components/agents/agent-format";
import { AgentDetailCharts } from "@/components/agents/agents-charts";
import {
  AgentDetailKpis,
  AgentsHeader,
  type AgentDateWindow,
} from "@/components/agents/agents-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import type { AgentActivityRow, AgentDetailResponse } from "@/lib/agents-api";
import { getAgentDetail } from "@/lib/agents-api";

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoStart(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function toIsoEnd(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}

export default function AgentDetailPage() {
  const params = useParams<{ actorKey: string }>();
  const actorKey = decodeURIComponent(params.actorKey);
  const { toast } = useToast();
  const [win, setWin] = useState<AgentDateWindow | null>(null);
  const [detail, setDetail] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(to.getDate() - 30);
    setWin({ from: dateInputValue(from), to: dateInputValue(to) });
  }, []);

  const fetchDetail = useCallback(async () => {
    if (!win || !actorKey) return;
    setLoading(true);
    setError(false);
    try {
      const data = await getAgentDetail(actorKey, {
        from: toIsoStart(win.from),
        to: toIsoEnd(win.to),
      });
      setDetail(data);
    } catch (err) {
      console.error("Error loading agent detail:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [actorKey, win]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  const retry = () => {
    toast({ title: "Retrying", description: "Reloading agent detail." });
    void fetchDetail();
  };

  const handleRowUpdated = (row: AgentActivityRow) => {
    setDetail((current) =>
      current
        ? {
            ...current,
            recent: current.recent.map((item) =>
              item.id === row.id ? row : item,
            ),
          }
        : current,
    );
  };

  if (!win || loading) {
    return (
      <div className="po-page-enter space-y-6">
        <Skeleton className="h-9 w-28" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-9 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Card key={item} className="p-4">
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
        <Card className="p-6">
          <Skeleton className="h-72 w-full" />
        </Card>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="po-page-enter space-y-6">
        <Button asChild variant="outline">
          <Link href="/dashboard/agents">
            <ArrowLeft className="h-4 w-4" />
            Agents
          </Link>
        </Button>
        <AgentsHeader title="Agent detail" win={win} onChange={setWin} onRefresh={retry} />
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn't load this agent"
            body="The agent detail report could not be fetched. Check the actor key and try again."
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

  return (
    <div className="po-page-enter space-y-6">
      <Button asChild variant="outline">
        <Link href="/dashboard/agents">
          <ArrowLeft className="h-4 w-4" />
          Agents
        </Link>
      </Button>

      <AgentsHeader
        title={detail.agent.actorLabel}
        subtitle="One agent's activity, project footprint, token usage, and cost."
        win={win}
        onChange={setWin}
        onRefresh={fetchDetail}
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
              Actor key
            </p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">
              {detail.agent.actorKey}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <KindBadge kind={detail.agent.actorKind} />
            <ViaBadge via={detail.agent.via} />
          </div>
        </div>
      </Card>

      <AgentDetailKpis
        eventCount={detail.totals.eventCount}
        tokensIn={detail.totals.tokensIn}
        tokensOut={detail.totals.tokensOut}
        costUsd={detail.totals.costUsd}
        firstSeenAt={detail.agent.firstSeenAt}
        lastActiveAt={detail.agent.lastActiveAt}
      />

      <AgentDetailCharts series={detail.series} byProject={detail.byProject} />

      <AgentActivityFeed
        rows={detail.recent}
        total={detail.recent.length}
        limit={detail.recent.length || 1}
        offset={0}
        compact
        onRowUpdated={handleRowUpdated}
      />
    </div>
  );
}
