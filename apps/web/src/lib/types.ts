// ============================================
// Agent Types (mirrors server shapes)
// ============================================

export type StrategyType = "academic" | "degen";

export interface AgentRuntimeStatus {
  agentId: string;
  isRunning: boolean;
  currentCycle: number;
  lastDecisionTime: string | null;
  lastError: string | null;
  pendingActions: number;
}

export interface Agent {
  id: string;
  name: string;
  strategyType: StrategyType;
  evmAddress: string;
  tokenAddress: string;
  bondingCurveAddress: string;
  status: AgentRuntimeStatus;
}

export interface AgentDetail extends Agent {
  strategy: {
    minTreasuryBuffer: string;
    targetTreasuryBuffer: string;
    maxLTV: number;
    speculationBudget: number;
  };
  latestDecision: DecisionLog | null;
}

// ============================================
// State Snapshot Types
// ============================================

export interface HoldingData {
  tokenAddress: string;
  bondingCurveAddress: string;
  tokenName: string;
  tokenDecimals: number;
  balance: string;
  avgBuyPrice: string;
  totalCostBasis: string;
  currentPrice: string;
  unrealizedPnl: string;
  pnlPercent: number;
}

export interface LoanData {
  active: boolean;
  collateralToken: string;
  collateralAmount: string;
  borrowedAmount: string;
  healthFactor: number;
  currentLTV: number;
  liquidationPrice: string;
}

export interface MarketSentimentData {
  ethPrice: string;
  btcPrice: string;
  ethPriceChange24h: number;
  btcPriceChange24h: number;
}

export interface OtherCreatorData {
  creatorAddress: string;
  tokenAddress: string;
  bondingCurveAddress: string;
  currentPrice: string;
  totalSupply: string;
  pendingRevenue: string;
}

export interface AgentStateSnapshot {
  timestamp: number;
  cycle: number;
  usdcBalance: string;
  ownTokenPrice: string;
  ownTokenSupply: string;
  ownTokenRevenue: string;
  holdings: HoldingData[];
  loan: LoanData | null;
  marketSentiment: MarketSentimentData | null;
  otherCreators: OtherCreatorData[];
  pendingTxs: string[];
}

// ============================================
// Decision Types
// ============================================

export type ThinkingCategory =
  | "health"
  | "treasury"
  | "lending"
  | "revenue"
  | "trading"
  | "market";

export interface ThinkingStep {
  category: ThinkingCategory;
  observation: string;
  conclusion: string;
  metrics?: Record<string, string | number>;
}

export type ActionType =
  | "BUY_TOKEN"
  | "SELL_TOKEN"
  | "BORROW"
  | "REPAY"
  | "CLAIM_REVENUE"
  | "DEPOSIT_COLLATERAL"
  | "WITHDRAW_COLLATERAL";

export interface Action {
  type: ActionType;
  params: Record<string, unknown>;
  reason: string;
  confidence: number;
  priority: number;
}

export interface DecisionLog {
  id: number;
  agentId: string;
  cycle: number;
  timestamp: number;
  stateSnapshot: AgentStateSnapshot;
  thinking: ThinkingStep[];
  actions: Action[];
  createdAt: string;
}

// ============================================
// Health Types
// ============================================

export interface IntegrationStatus {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  integrations: IntegrationStatus[];
  agents: { total: number; running: number };
}

// ============================================
// Trading Types
// ============================================

export interface TokenPrice {
  agentId: string;
  agentName: string;
  tokenAddress: string;
  bondingCurveAddress: string;
  price: string;
  floorPrice: string;
  ceiling: string;
  reserveBalance: string;
  totalSupply: string;
}

export interface TradeQuote {
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  currentPrice: string;
}

export interface PortfolioHolding {
  agentId: string;
  agentName: string;
  tokenAddress: string;
  balance: string;
  price: string;
  value: string;
}

export interface Portfolio {
  address: string;
  usdcBalance: string;
  holdings: PortfolioHolding[];
  totalValue: string;
}

// ============================================
// Video Types
// ============================================

export interface Video {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "processing" | "ready" | "error";
  durationSeconds: number | null;
  totalSegments: number | null;
  quality: string | null;
  contentUri: string | null;
  thumbnailUri: string | null;
  agentId: string | null;
  createdAt: number;
  processedAt: number | null;
}

export interface VideoDetail extends Video {
  merkleRoot: string | null;
  registryTxHash: string | null;
  registryExplorerLink: string | null;
  creatorWallet: string | null;
  creatorTokenAddress: string | null;
}

/** Response from POST /api/videos/:videoId/session (legacy path) */
export interface LegacySession {
  type: "legacy";
  sessionId: string;
  videoId: string;
  expiresAt: number;
}

/** Response from POST /api/videos/:videoId/session (Yellow path) */
export interface YellowSession {
  type: "yellow";
  appSessionId: string;
  videoId: string;
  serverAddress: string;
  pricePerSegment: string;
  viewerBalance: string;
  totalDeposited: string;
  asset: string;
  // Nitrolite Custody on-chain channel
  channelId?: string | null;
  custodyDepositTxHash?: string | null;
}

export type ViewingSession = LegacySession | YellowSession;

/** Response from GET /api/videos/:videoId/session/:sessionId/status */
export interface SessionStatus {
  appSessionId: string;
  videoId: string;
  status: "active" | "closed" | "settled";
  viewerBalance: string;
  creatorBalance: string;
  totalDeposited: string;
  segmentsDelivered: number;
  secondsWatched: number;
  pricePerSegment: string;
  asset?: string;
  closedAt?: number;
}

/** Response from POST /api/videos/:videoId/session/:sessionId/close */
export interface SessionCloseResult {
  closed: boolean;
  totalPaid: string;
  settled: boolean;
  segmentsDelivered: number;
  // Nitrolite Custody on-chain channel
  channelId: string | null;
  custodyDepositTxHash: string | null;
  channelCloseTxHash: string | null;
  custodyWithdrawTxHash: string | null;
  // Cross-chain settlement tx hashes
  settlementTxHash: string | null;
  bridgeTxHash: string | null;
  distributionTxHash: string | null;
  explorerLinks: {
    custodyDeposit: string | null;
    channelClose: string | null;
    custodyWithdraw: string | null;
    settlement: string | null;
    bridge: string | null;
    distribution: string | null;
  } | null;
}

// ============================================
// Trade / Chart Types
// ============================================

export interface TradeData {
  id: number;
  tokenAddress: string;
  bondingCurveAddress: string;
  side: "buy" | "sell";
  trader: string;
  usdcAmount: string;
  tokenAmount: string;
  price: string;
  txHash: string | null;
  blockNumber: number | null;
  timestamp: number;
}

export interface CandleData {
  time: number; // Unix seconds (lightweight-charts format)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================
// Agent Live State (on-chain)
// ============================================

export interface AgentLiveState {
  agentId: string;
  usdcBalance: string;
  ownTokenPrice: string;
  ownTokenSupply: string;
  ownTokenRevenue: string;
  loan: {
    active: boolean;
    collateralAmount: string;
    borrowedAmount: string;
    healthFactor: number;
    currentLTV: number;
  } | null;
  currentCycle: number;
  lastDecisionTime: string | null;
  isRunning: boolean;
}

// ============================================
// Agent Earnings Types
// ============================================

export interface AgentEarnings {
  agentId: string;
  onChainEarnings: string;
  totalStreamingEarnings: string;
  totalSessions: number;
  closedSessions: number;
  totalSegmentsDelivered: number;
}

// ============================================
// Video Schedule Types
// ============================================

export type VideoGenerationStatus =
  | "pending"
  | "ideating"
  | "generating_video"
  | "generating_thumbnail"
  | "processing"
  | "uploading"
  | "completed"
  | "failed";

export interface VideoScheduleStatus {
  agentId: string;
  nextGenerationAt: string;
  msUntilNext: number;
  lastGenerationStatus: VideoGenerationStatus | null;
  lastGenerationVideoId: string | null;
  lastGenerationTitle: string | null;
  lastGenerationAt: string | null;
  currentGenerationStatus: VideoGenerationStatus | null;
  isGenerating: boolean;
  generationCount: number;
  isEnabled: boolean;
}
