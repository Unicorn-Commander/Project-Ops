/**
 * Agents API client.
 *
 * Every call goes through the shared axios instance in `lib/api.ts`, which
 * injects auth and the active workspace header and prefixes `/api/v1`.
 */

import api from "./api";

export type AgentKind = "PAT" | "ASSISTANT" | "FEDERATED" | "USER" | "SYSTEM";
export type AgentVia = "MCP" | "API" | "ASSISTANT" | "GUI" | "SYSTEM";

export interface AgentSummary {
  actorKey: string;
  actorLabel: string;
  actorKind: AgentKind;
  via: AgentVia;
  eventCount: number;
  lastActiveAt: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  billableCostUsd: number;
  projectCount: number;
}

export interface AgentsTotals {
  agentCount: number;
  eventCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AgentsListResponse {
  agents: AgentSummary[];
  totals: AgentsTotals;
}

export interface AgentActivityRow {
  id: string;
  occurredAt: string;
  actorKey: string;
  actorLabel: string;
  actorKind: AgentKind;
  via: AgentVia;
  action: string;
  resource: string;
  resourceId: string | null;
  projectId: string | null;
  taskId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number | null;
  billable: boolean;
}

export interface AgentsActivityParams {
  from?: string;
  to?: string;
  actorKey?: string;
  projectId?: string;
  via?: AgentVia;
  limit?: number;
  offset?: number;
}

export interface AgentsActivityResponse {
  data: AgentActivityRow[];
  total: number;
}

export interface AgentsUsageParams {
  from?: string;
  to?: string;
}

export interface AgentUsageByAgent {
  actorKey: string;
  actorLabel: string;
  eventCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AgentUsageSeriesPoint {
  label: string;
  eventCount: number;
  costUsd: number;
}

export interface AgentsUsageResponse {
  period: { from?: string; to?: string };
  byAgent: AgentUsageByAgent[];
  series: AgentUsageSeriesPoint[];
  totals: {
    eventCount: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
}

export interface AgentDetailResponse {
  agent: {
    actorKey: string;
    actorLabel: string;
    actorKind: AgentKind;
    via: AgentVia;
    firstSeenAt: string | null;
    lastActiveAt: string | null;
  };
  totals: {
    eventCount: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  byProject: {
    projectId: string;
    projectName: string;
    eventCount: number;
    costUsd: number;
  }[];
  series: AgentUsageSeriesPoint[];
  recent: AgentActivityRow[];
}

export const getAgents = async (): Promise<AgentsListResponse> => {
  const { data } = await api.get("/agents");
  return data;
};

export const getAgentActivity = async (
  params: AgentsActivityParams,
): Promise<AgentsActivityResponse> => {
  const { data } = await api.get("/agents/activity", { params });
  return data;
};

export const getAgentsUsage = async (
  params: AgentsUsageParams,
): Promise<AgentsUsageResponse> => {
  const { data } = await api.get("/agents/usage", { params });
  return data;
};

export const getAgentDetail = async (
  actorKey: string,
  params: AgentsUsageParams,
): Promise<AgentDetailResponse> => {
  const { data } = await api.get(`/agents/${encodeURIComponent(actorKey)}`, {
    params,
  });
  return data;
};

export const setAgentActivityBillable = async (
  id: string,
  billable: boolean,
): Promise<AgentActivityRow> => {
  const { data } = await api.patch(`/agents/activity/${id}/billable`, {
    billable,
  });
  return data;
};
