"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, ReceiptText } from "lucide-react";
import { HelpHint } from "@/components/guidance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import type { AgentActivityRow, AgentSummary, AgentVia } from "@/lib/agents-api";
import { setAgentActivityBillable } from "@/lib/agents-api";
import {
  AbsoluteTime,
  KindBadge,
  ViaBadge,
  formatCost,
  formatDuration,
  formatTokens,
} from "./agent-format";

const ALL = "__all";
const VIA_OPTIONS: AgentVia[] = ["MCP", "API", "ASSISTANT", "GUI", "SYSTEM"];

export interface ActivityFilters {
  actorKey?: string;
  projectId?: string;
  via?: AgentVia;
}

interface ActivityFeedProps {
  rows: AgentActivityRow[];
  total: number;
  limit: number;
  offset: number;
  agents?: AgentSummary[];
  filters?: ActivityFilters;
  loading?: boolean;
  compact?: boolean;
  onFiltersChange?: (filters: ActivityFilters) => void;
  onPageChange?: (offset: number) => void;
  onRowUpdated?: (row: AgentActivityRow) => void;
}

export function AgentActivityFeed({
  rows,
  total,
  limit,
  offset,
  agents = [],
  filters = {},
  loading = false,
  compact = false,
  onFiltersChange,
  onPageChange,
  onRowUpdated,
}: ActivityFeedProps) {
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const patchBillable = async (row: AgentActivityRow, billable: boolean) => {
    setUpdatingId(row.id);
    try {
      const updated = await setAgentActivityBillable(row.id, billable);
      onRowUpdated?.(updated);
      toast({ title: billable ? "Marked billable" : "Marked non-billable" });
    } catch (err: any) {
      toast({
        title: "Couldn't update billable status",
        description: err?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            Activity feed
            <HelpHint side="right">
              Agent events are recorded actions by assistants, API tokens, MCP
              tools, users, or system actors.
            </HelpHint>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A ledger of the work your AI agents did and what it cost.
          </p>
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-2">
            <Select
              value={filters.actorKey ?? ALL}
              onValueChange={(value) =>
                onFiltersChange?.({
                  ...filters,
                  actorKey: value === ALL ? undefined : value,
                })
              }
            >
              <SelectTrigger className="w-44" aria-label="Filter by agent">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All agents</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.actorKey} value={agent.actorKey}>
                    {agent.actorLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.via ?? ALL}
              onValueChange={(value) =>
                onFiltersChange?.({
                  ...filters,
                  via: value === ALL ? undefined : (value as AgentVia),
                })
              }
            >
              <SelectTrigger className="w-36" aria-label="Filter by source">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {VIA_OPTIONS.map((via) => (
                  <SelectItem key={via} value={via}>
                    {via}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="w-56"
              aria-label="Filter by project ID"
              placeholder="Project ID"
              value={filters.projectId ?? ""}
              onChange={(event) =>
                onFiltersChange?.({
                  ...filters,
                  projectId: event.target.value.trim() || undefined,
                })
              }
            />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          iconTone="zinc"
          title={loading ? "Loading activity" : "No activity found"}
          body={
            loading
              ? "Fetching the latest agent activity."
              : "Adjust the filters or date range to see agent events."
          }
          className="border-0"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-normal text-muted-foreground">
                <th scope="col" className="py-3 pr-4">
                  When
                </th>
                <th scope="col" className="py-3 pr-4">
                  Agent
                </th>
                <th scope="col" className="py-3 pr-4">
                  Action
                </th>
                <th scope="col" className="py-3 pr-4">
                  Entity
                </th>
                <th scope="col" className="py-3 pr-4 text-right">
                  Tokens
                </th>
                <th scope="col" className="py-3 pr-4 text-right">
                  Cost
                  <HelpHint side="top">
                    Some rows have no cost because MCP tool calls and audit-only
                    actions do not consume LLM tokens.
                  </HelpHint>
                </th>
                <th scope="col" className="py-3 pr-4 text-right">
                  Duration
                </th>
                <th scope="col" className="py-3 text-right">
                  Billable
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const costBearing = row.costUsd !== null && row.costUsd > 0;
                return (
                  <tr key={row.id} className="align-top">
                    <td className="py-3 pr-4 text-muted-foreground">
                      <AbsoluteTime value={row.occurredAt} />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="max-w-52">
                        <Link
                          href={`/dashboard/agents/${encodeURIComponent(row.actorKey)}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {row.actorLabel}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <KindBadge kind={row.actorKind} />
                          <ViaBadge via={row.via} />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-foreground">{row.action}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <EntityLink row={row} />
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums">
                      {formatTokens(row.tokensIn, row.tokensOut)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums">
                      {formatCost(row.costUsd)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums text-muted-foreground">
                      {formatDuration(row.durationMs)}
                    </td>
                    <td className="py-3 text-right">
                      {costBearing ? (
                        <Switch
                          checked={row.billable}
                          disabled={updatingId === row.id}
                          aria-label={`Mark ${row.action} as billable`}
                          onCheckedChange={(checked) => void patchBillable(row, checked)}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!compact && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={offset === 0}
              onClick={() => onPageChange?.(Math.max(0, offset - limit))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={offset + limit >= total}
              onClick={() => onPageChange?.(offset + limit)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function EntityLink({ row }: { row: AgentActivityRow }) {
  const label = row.resourceId
    ? `${row.resource} ${row.resourceId.slice(0, 8)}`
    : row.resource;
  const projectHref = row.projectId
    ? `/dashboard/projects/${row.projectId}${row.taskId ? `?taskId=${row.taskId}` : ""}`
    : row.resource === "PROJECT" && row.resourceId
      ? `/dashboard/projects/${row.resourceId}`
      : null;

  if (!projectHref) {
    return (
      <div>
        <p className="font-medium text-foreground">{label}</p>
        {row.taskId && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Task {row.taskId.slice(0, 8)}
          </p>
        )}
      </div>
    );
  }

  return (
    <Link
      href={projectHref}
      className="inline-flex max-w-60 items-center gap-1 font-medium text-foreground hover:underline"
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
