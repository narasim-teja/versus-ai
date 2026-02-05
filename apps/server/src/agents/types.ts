/**
 * Agent Types
 *
 * Core type definitions for the agent runtime system.
 * These types define the state, actions, and decision-making structures.
 */

import type { Address } from "viem";
import type { MarketSentimentData } from "../integrations/stork/types";

// ============================================
// Strategy Configuration
// ============================================

export type StrategyType = "academic" | "degen";

export interface BuySignals {
  /** Minimum revenue growth % to trigger buy (e.g., 0.15 = 15%) */
  revenueGrowth: number;
  /** Price drop % with sustained revenue that triggers buy */
  priceDropWithRevenue: number;
  /** Minimum momentum score to trigger buy */
  momentum: number;
}

export interface SellSignals {
  /** Revenue drop % that triggers sell */
  revenueDrop: number;
  /** Price drop % (stop loss) that triggers sell */
  priceDrop: number;
  /** Profit % that triggers take profit */
  profitTake: number;
}

export interface StrategyConfig {
  /** Minimum USDC to keep in treasury (never go below this) */
  minTreasuryBuffer: bigint;
  /** Target USDC balance (buy when above this) */
  targetTreasuryBuffer: bigint;
  /** Maximum loan-to-value ratio (0-100) */
  maxLTV: number;
  /** Treasury threshold to consider borrowing */
  borrowTrigger: bigint;
  /** Treasury threshold to start repaying loans */
  repayTrigger: bigint;
  /** Fraction of excess treasury available for speculation (0-1) */
  speculationBudget: number;
  /** Signals that trigger buying other tokens */
  buySignals: BuySignals;
  /** Signals that trigger selling holdings */
  sellSignals: SellSignals;
}

// ============================================
// Agent Configuration
// ============================================

export interface AgentConfig {
  /** Unique agent identifier (e.g., "alice", "bob") */
  id: string;
  /** Display name */
  name: string;
  /** Circle wallet ID for transaction execution */
  circleWalletId?: string;
  /** EVM address (from Circle wallet) */
  evmAddress: Address;
  /** Agent's own token address */
  tokenAddress: Address;
  /** Agent's bonding curve address */
  bondingCurveAddress: Address;
  /** Strategy type identifier */
  strategyType: StrategyType;
  /** Full strategy configuration */
  strategy: StrategyConfig;
}

// ============================================
// Agent State (Read Every Cycle)
// ============================================

export interface Holding {
  /** Token contract address */
  tokenAddress: Address;
  /** Token name/symbol */
  tokenName: string;
  /** Token balance (in token decimals) */
  balance: bigint;
  /** Average purchase price (6 decimals) */
  avgBuyPrice: bigint;
  /** Total USDC spent on this position */
  totalCostBasis: bigint;
  /** Current token price (6 decimals) */
  currentPrice: bigint;
  /** Unrealized P&L (currentValue - costBasis) */
  unrealizedPnl: bigint;
  /** P&L percentage */
  pnlPercent: number;
}

export interface LoanInfo {
  /** Loan exists */
  active: boolean;
  /** Collateral token address */
  collateralToken: Address;
  /** Amount of collateral deposited */
  collateralAmount: bigint;
  /** Amount borrowed (USDC, 6 decimals) */
  borrowedAmount: bigint;
  /** Current health factor (>1 is healthy) */
  healthFactor: number;
  /** Current LTV percentage */
  currentLTV: number;
  /** Value at which loan gets liquidated */
  liquidationPrice: bigint;
}

export interface OtherCreator {
  /** Creator's EVM address */
  creatorAddress: Address;
  /** Token contract address */
  tokenAddress: Address;
  /** Bonding curve address */
  bondingCurveAddress: Address;
  /** Current token price (6 decimals) */
  currentPrice: bigint;
  /** Total token supply */
  totalSupply: bigint;
  /** Pending revenue claimable by creator */
  pendingRevenue: bigint;
}

export interface AgentState {
  /** State timestamp */
  timestamp: number;
  /** Current cycle number */
  cycle: number;

  // Own financial state
  /** USDC balance (6 decimals) */
  usdcBalance: bigint;
  /** Own token's current price (6 decimals) */
  ownTokenPrice: bigint;
  /** Own token's total supply */
  ownTokenSupply: bigint;
  /** Pending revenue from own bonding curve */
  ownTokenRevenue: bigint;

  // Portfolio
  /** Holdings of other creator tokens */
  holdings: Holding[];

  // Lending
  /** Current loan information (null if no loan) */
  loan: LoanInfo | null;

  // Market context
  /** Market sentiment from Stork (ETH/BTC) */
  marketSentiment: MarketSentimentData | null;

  // Other creators to consider for trading
  /** Info about other creators' tokens */
  otherCreators: OtherCreator[];

  // Transaction tracking
  /** Pending transaction hashes */
  pendingTxs: string[];
}

// ============================================
// Actions
// ============================================

export type ActionType =
  | "BUY_TOKEN"
  | "SELL_TOKEN"
  | "BORROW"
  | "REPAY"
  | "CLAIM_REVENUE"
  | "DEPOSIT_COLLATERAL"
  | "WITHDRAW_COLLATERAL";

export interface BuyTokenParams {
  tokenAddress: Address;
  bondingCurveAddress: Address;
  tokenName: string;
  usdcAmount: bigint;
  minTokensOut: bigint;
}

export interface SellTokenParams {
  tokenAddress: Address;
  bondingCurveAddress: Address;
  tokenName: string;
  tokenAmount: bigint;
  minUsdcOut: bigint;
}

export interface BorrowParams {
  collateralToken: Address;
  collateralAmount: bigint;
  borrowAmount: bigint;
}

export interface RepayParams {
  repayAmount: bigint;
  withdrawCollateral: boolean;
}

export interface ClaimRevenueParams {
  bondingCurveAddress: Address;
}

export interface DepositCollateralParams {
  tokenAddress: Address;
  amount: bigint;
}

export interface WithdrawCollateralParams {
  amount: bigint;
}

export type ActionParams =
  | BuyTokenParams
  | SellTokenParams
  | BorrowParams
  | RepayParams
  | ClaimRevenueParams
  | DepositCollateralParams
  | WithdrawCollateralParams;

export interface Action {
  /** Action type */
  type: ActionType;
  /** Action-specific parameters */
  params: ActionParams;
  /** Human-readable reason for this action */
  reason: string;
  /** Confidence level (0-1) */
  confidence: number;
  /** Priority (higher = execute first) */
  priority: number;
}

// ============================================
// Decision Making
// ============================================

export interface ThinkingStep {
  /** Step category */
  category: "health" | "treasury" | "lending" | "revenue" | "trading" | "market";
  /** What was analyzed */
  observation: string;
  /** Conclusion or decision */
  conclusion: string;
  /** Metric values considered */
  metrics?: Record<string, string | number>;
}

export interface DecisionResult {
  /** Actions to execute (sorted by priority) */
  actions: Action[];
  /** Thinking process steps */
  thinking: ThinkingStep[];
  /** Whether any critical action is needed */
  urgent: boolean;
}

// ============================================
// Decision Log (for storage)
// ============================================

export interface DecisionLog {
  /** Unique log ID */
  id: number;
  /** Agent ID */
  agentId: string;
  /** Cycle number */
  cycle: number;
  /** Timestamp */
  timestamp: number;
  /** Full state snapshot */
  stateSnapshot: AgentState;
  /** Thinking steps */
  thinking: ThinkingStep[];
  /** Decided actions */
  actions: Action[];
  /** When log was created */
  createdAt: Date;
}

// ============================================
// Runtime Types
// ============================================

export interface AgentRuntimeStatus {
  agentId: string;
  isRunning: boolean;
  currentCycle: number;
  lastDecisionTime: Date | null;
  lastError: string | null;
  pendingActions: number;
}
