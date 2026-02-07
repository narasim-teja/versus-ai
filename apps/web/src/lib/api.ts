import { config } from "./config";
import type {
  Agent,
  AgentDetail,
  DecisionLog,
  HealthResponse,
} from "./types";

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

export async function fetchAgents(): Promise<Agent[]> {
  const data = await fetchJson<{ agents: Agent[] }>("/api/agents");
  return data.agents;
}

export async function fetchAgent(id: string): Promise<AgentDetail> {
  return fetchJson<AgentDetail>(`/api/agents/${id}`);
}

export async function fetchRecentDecisions(
  id: string,
  limit = 10
): Promise<DecisionLog[]> {
  const data = await fetchJson<{ decisions: DecisionLog[] }>(
    `/api/agents/${id}/decisions/recent?limit=${limit}`
  );
  return data.decisions;
}

export async function forceCycle(
  id: string
): Promise<{ success: boolean; decision: DecisionLog }> {
  return fetchJson(`/api/agents/${id}/cycle`, { method: "POST" });
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/health");
}
