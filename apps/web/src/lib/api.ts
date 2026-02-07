import { config } from "./config";
import type {
  Agent,
  AgentDetail,
  DecisionLog,
  HealthResponse,
  TokenPrice,
  TradeQuote,
  Portfolio,
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

export async function fetchTokenPrices(): Promise<TokenPrice[]> {
  const data = await fetchJson<{ prices: TokenPrice[] }>("/api/trading/prices");
  return data.prices;
}

export async function fetchTradeQuote(
  bondingCurveAddress: string,
  side: "buy" | "sell",
  amount: string
): Promise<TradeQuote> {
  return fetchJson<TradeQuote>(
    `/api/trading/quote?bondingCurveAddress=${bondingCurveAddress}&side=${side}&amount=${amount}`
  );
}

export async function fetchPortfolio(address: string): Promise<Portfolio> {
  return fetchJson<Portfolio>(`/api/trading/portfolio/${address}`);
}

export async function executeTradeAction(body: {
  userId: string;
  walletId: string;
  action: "approve_usdc" | "approve_token" | "buy" | "sell";
  contractAddress: string;
  params: Record<string, string>;
}): Promise<{ challengeId: string }> {
  return fetchJson<{ challengeId: string }>("/api/trading/execute", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchAllowance(
  tokenAddress: string,
  owner: string,
  spender: string
): Promise<string> {
  const params = new URLSearchParams({ tokenAddress, owner, spender });
  const data = await fetchJson<{ allowance: string }>(
    `/api/trading/allowance?${params}`
  );
  return data.allowance;
}
