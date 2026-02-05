/**
 * Test Helpers
 *
 * Mock factories for creating test data without environment dependencies.
 */

import type { Address } from "viem";
import type {
  AgentConfig,
  AgentState,
  Holding,
  LoanInfo,
  OtherCreator,
  StrategyConfig,
} from "../src/agents/types";
import type { MarketSentimentData } from "../src/integrations/stork/types";

// ============================================
// Constants
// ============================================

const USDC_DECIMALS = 6;
const ONE_USDC = BigInt(10 ** USDC_DECIMALS);

export const toUsdc = (amount: number): bigint =>
  BigInt(Math.floor(amount * 10 ** USDC_DECIMALS));

export const fromUsdc = (amount: bigint): number =>
  Number(amount) / 10 ** USDC_DECIMALS;

// Mock addresses
export const MOCK_ADDRESSES = {
  alice: "0x1111111111111111111111111111111111111111" as Address,
  bob: "0x2222222222222222222222222222222222222222" as Address,
  aliceToken: "0xA111111111111111111111111111111111111111" as Address,
  bobToken: "0xB222222222222222222222222222222222222222" as Address,
  aliceCurve: "0xAC11111111111111111111111111111111111111" as Address,
  bobCurve: "0xBC22222222222222222222222222222222222222" as Address,
  otherCreator: "0x3333333333333333333333333333333333333333" as Address,
  otherToken: "0x4444444444444444444444444444444444444444" as Address,
  otherCurve: "0x5555555555555555555555555555555555555555" as Address,
};

// ============================================
// Strategy Configs
// ============================================

export const ALICE_STRATEGY: StrategyConfig = {
  minTreasuryBuffer: toUsdc(100),
  targetTreasuryBuffer: toUsdc(500),
  maxLTV: 50,
  borrowTrigger: toUsdc(50),
  repayTrigger: toUsdc(1000),
  speculationBudget: 0.2,
  buySignals: {
    revenueGrowth: 0.15,
    priceDropWithRevenue: 0.2,
    momentum: 0.1,
  },
  sellSignals: {
    revenueDrop: 0.25,
    priceDrop: 0.15,
    profitTake: 0.5,
  },
};

export const BOB_STRATEGY: StrategyConfig = {
  minTreasuryBuffer: toUsdc(25),
  targetTreasuryBuffer: toUsdc(100),
  maxLTV: 65,
  borrowTrigger: toUsdc(25),
  repayTrigger: toUsdc(500),
  speculationBudget: 0.5,
  buySignals: {
    revenueGrowth: 0.05,
    priceDropWithRevenue: 0.1,
    momentum: 0.05,
  },
  sellSignals: {
    revenueDrop: 0.4,
    priceDrop: 0.25,
    profitTake: 0.3,
  },
};

// ============================================
// Mock Factory Functions
// ============================================

/**
 * Create a mock AgentConfig
 */
export function createMockConfig(
  agent: "alice" | "bob",
  overrides?: Partial<AgentConfig>
): AgentConfig {
  const isAlice = agent === "alice";

  const baseConfig: AgentConfig = {
    id: agent,
    name: isAlice ? "Alice (Academic)" : "Bob (Degen)",
    circleWalletId: `mock-wallet-${agent}`,
    evmPrivateKey: `0x${"a".repeat(64)}` as `0x${string}`,
    evmAddress: isAlice ? MOCK_ADDRESSES.alice : MOCK_ADDRESSES.bob,
    tokenAddress: isAlice ? MOCK_ADDRESSES.aliceToken : MOCK_ADDRESSES.bobToken,
    bondingCurveAddress: isAlice
      ? MOCK_ADDRESSES.aliceCurve
      : MOCK_ADDRESSES.bobCurve,
    strategyType: isAlice ? "academic" : "degen",
    strategy: isAlice ? { ...ALICE_STRATEGY } : { ...BOB_STRATEGY },
  };

  return { ...baseConfig, ...overrides };
}

/**
 * Create a mock Holding
 */
export function createMockHolding(overrides?: Partial<Holding>): Holding {
  const balance = overrides?.balance ?? toUsdc(1000);
  const avgBuyPrice = overrides?.avgBuyPrice ?? toUsdc(0.1);
  const currentPrice = overrides?.currentPrice ?? toUsdc(0.12);
  const totalCostBasis =
    overrides?.totalCostBasis ?? (balance * avgBuyPrice) / ONE_USDC;
  const currentValue = (balance * currentPrice) / ONE_USDC;
  const unrealizedPnl = currentValue - totalCostBasis;
  const pnlPercent =
    totalCostBasis > 0n
      ? (Number(unrealizedPnl) / Number(totalCostBasis)) * 100
      : 0;

  return {
    tokenAddress: MOCK_ADDRESSES.otherToken,
    tokenName: "OtherToken",
    balance,
    avgBuyPrice,
    totalCostBasis,
    currentPrice,
    unrealizedPnl,
    pnlPercent,
    ...overrides,
  };
}

/**
 * Create a mock LoanInfo
 */
export function createMockLoan(overrides?: Partial<LoanInfo>): LoanInfo {
  return {
    active: true,
    collateralToken: MOCK_ADDRESSES.aliceToken,
    collateralAmount: toUsdc(1000),
    borrowedAmount: toUsdc(100),
    healthFactor: 1.5,
    currentLTV: 40,
    liquidationPrice: toUsdc(0.05),
    ...overrides,
  };
}

/**
 * Create a mock OtherCreator
 */
export function createMockOtherCreator(
  overrides?: Partial<OtherCreator>
): OtherCreator {
  return {
    creatorAddress: MOCK_ADDRESSES.otherCreator,
    tokenAddress: MOCK_ADDRESSES.otherToken,
    bondingCurveAddress: MOCK_ADDRESSES.otherCurve,
    currentPrice: toUsdc(0.1),
    totalSupply: toUsdc(100000),
    pendingRevenue: toUsdc(50),
    ...overrides,
  };
}

/**
 * Create a mock MarketSentimentData
 */
export function createMockMarketSentiment(
  overrides?: Partial<MarketSentimentData>
): MarketSentimentData {
  return {
    sentiment: "neutral",
    ethPrice: toUsdc(2000),
    btcPrice: toUsdc(40000),
    ethChange24h: 0,
    btcChange24h: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Create a mock AgentState
 */
export function createMockState(overrides?: Partial<AgentState>): AgentState {
  const baseState: AgentState = {
    timestamp: Date.now(),
    cycle: 1,
    usdcBalance: toUsdc(500),
    ownTokenPrice: toUsdc(0.1),
    ownTokenSupply: toUsdc(100000),
    ownTokenRevenue: toUsdc(0),
    holdings: [],
    loan: null,
    marketSentiment: createMockMarketSentiment(),
    otherCreators: [],
    pendingTxs: [],
  };

  // Deep merge for nested objects
  const merged: AgentState = { ...baseState };

  if (overrides) {
    Object.keys(overrides).forEach((key) => {
      const k = key as keyof AgentState;
      if (overrides[k] !== undefined) {
        (merged as Record<string, unknown>)[k] = overrides[k];
      }
    });
  }

  return merged;
}

// ============================================
// State Builders (Fluent API)
// ============================================

/**
 * Fluent builder for creating test states
 */
export class StateBuilder {
  private state: AgentState;

  constructor() {
    this.state = createMockState();
  }

  withBalance(usdc: number): StateBuilder {
    this.state.usdcBalance = toUsdc(usdc);
    return this;
  }

  withLoan(loan: Partial<LoanInfo>): StateBuilder {
    this.state.loan = createMockLoan(loan);
    return this;
  }

  withNoLoan(): StateBuilder {
    this.state.loan = null;
    return this;
  }

  withHolding(holding: Partial<Holding>): StateBuilder {
    this.state.holdings.push(createMockHolding(holding));
    return this;
  }

  withHoldings(holdings: Array<Partial<Holding>>): StateBuilder {
    this.state.holdings = holdings.map((h) => createMockHolding(h));
    return this;
  }

  withOtherCreator(creator: Partial<OtherCreator>): StateBuilder {
    this.state.otherCreators.push(createMockOtherCreator(creator));
    return this;
  }

  withOtherCreators(creators: Array<Partial<OtherCreator>>): StateBuilder {
    this.state.otherCreators = creators.map((c) => createMockOtherCreator(c));
    return this;
  }

  withMarketSentiment(sentiment: Partial<MarketSentimentData>): StateBuilder {
    this.state.marketSentiment = createMockMarketSentiment(sentiment);
    return this;
  }

  withOwnTokenRevenue(usdc: number): StateBuilder {
    this.state.ownTokenRevenue = toUsdc(usdc);
    return this;
  }

  withCycle(cycle: number): StateBuilder {
    this.state.cycle = cycle;
    return this;
  }

  build(): AgentState {
    return this.state;
  }
}

/**
 * Create a new state builder
 */
export function stateBuilder(): StateBuilder {
  return new StateBuilder();
}

// ============================================
// Test Assertions Helpers
// ============================================

/**
 * Find an action by type in decision result
 */
export function findAction<T extends { type: string }>(
  actions: T[],
  type: string
): T | undefined {
  return actions.find((a) => a.type === type);
}

/**
 * Check if actions contain a specific type
 */
export function hasAction<T extends { type: string }>(
  actions: T[],
  type: string
): boolean {
  return actions.some((a) => a.type === type);
}

/**
 * Get all actions of a specific type
 */
export function getActionsOfType<T extends { type: string }>(
  actions: T[],
  type: string
): T[] {
  return actions.filter((a) => a.type === type);
}
