import { config } from "./config";
import type {
  Agent,
  AgentDetail,
  DecisionLog,
  HealthResponse,
  TokenPrice,
  TradeQuote,
  Portfolio,
  Video,
  VideoDetail,
  ViewingSession,
  SessionStatus,
  SessionCloseResult,
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

// ── Video APIs ──────────────────────────────────

export async function fetchVideos(): Promise<Video[]> {
  const data = await fetchJson<{ videos: Video[] }>("/api/videos");
  return data.videos;
}

export async function fetchVideo(id: string): Promise<VideoDetail> {
  const data = await fetchJson<{ video: VideoDetail }>(`/api/videos/${id}`);
  return data.video;
}

/**
 * Create a viewing session. Attempts Yellow path if wallet address and
 * deposit are provided, otherwise falls back to legacy bearer token.
 */
export async function createViewingSession(
  videoId: string,
  viewerAddress?: string,
  depositAmount?: string
): Promise<ViewingSession> {
  if (viewerAddress && depositAmount) {
    const data = await fetchJson<{
      appSessionId: string;
      videoId: string;
      serverAddress: string;
      pricePerSegment: string;
      viewerBalance: string;
      totalDeposited: string;
      asset: string;
    }>(`/api/videos/${videoId}/session`, {
      method: "POST",
      body: JSON.stringify({ viewerAddress, depositAmount }),
    });
    return { type: "yellow", ...data };
  }

  const data = await fetchJson<{
    sessionId: string;
    videoId: string;
    expiresAt: number;
  }>(`/api/videos/${videoId}/session`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return { type: "legacy", ...data };
}

export async function fetchSessionStatus(
  videoId: string,
  sessionId: string
): Promise<SessionStatus> {
  return fetchJson<SessionStatus>(
    `/api/videos/${videoId}/session/${sessionId}/status`
  );
}

export async function closeSession(
  videoId: string,
  sessionId: string
): Promise<SessionCloseResult> {
  return fetchJson<SessionCloseResult>(
    `/api/videos/${videoId}/session/${sessionId}/close`,
    { method: "POST" }
  );
}

/** Result from cosign including optional merkle proof */
export interface CosignResult {
  keyBuffer: ArrayBuffer;
  merkleProof: import("./merkle-verify").MerkleProof | null;
}

/**
 * Co-sign a state update and get the raw AES decryption key.
 * Returns the key buffer and optional merkle proof from response header.
 */
export async function cosignAndGetKey(
  videoId: string,
  body: {
    appSessionId: string;
    segmentIndex: number;
    version: number;
    signedMessage: string;
  }
): Promise<CosignResult> {
  const res = await fetch(
    `${config.apiBaseUrl}/api/videos/${videoId}/cosign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cosign ${res.status}: ${text}`);
  }

  const keyBuffer = await res.arrayBuffer();

  // Extract merkle proof from response header if available
  let merkleProof: import("./merkle-verify").MerkleProof | null = null;
  const proofHeader = res.headers.get("X-Merkle-Proof");
  if (proofHeader) {
    try {
      merkleProof = JSON.parse(proofHeader);
    } catch {
      // Non-fatal: proof parsing failed
    }
  }

  return { keyBuffer, merkleProof };
}
