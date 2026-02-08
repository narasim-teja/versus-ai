/**
 * Alice Agent Configuration
 *
 * Academic/Conservative strategy:
 * - Higher treasury buffers for safety
 * - Lower LTV limits
 * - Smaller speculation budget
 * - Slower to act, requires stronger signals
 */

import type { Address } from "viem";
import { env } from "../../utils/env";
import type { AgentConfig, StrategyConfig } from "../types";

// USDC has 6 decimals
const USDC_DECIMALS = 6;
const toUsdc = (amount: number) => BigInt(amount * 10 ** USDC_DECIMALS);

const aliceStrategy: StrategyConfig = {
  // Treasury management - tuned for ~$20 testnet budget
  minTreasuryBuffer: toUsdc(2), // Keep at least 2 USDC
  targetTreasuryBuffer: toUsdc(5), // Ideal balance is 5 USDC

  // Lending - cautious but accessible
  maxLTV: 50, // Never exceed 50% LTV
  borrowTrigger: toUsdc(2), // Consider borrowing when below 2 USDC
  repayTrigger: toUsdc(30), // Repay loans when treasury > 30 USDC

  // Speculation - moderate (academic still conservative relative to Bob)
  speculationBudget: 0.5, // Use 50% of excess for trading

  // Buy signals - lower thresholds for activity
  buySignals: {
    revenueGrowth: 0.02, // Need 2%+ revenue growth
    priceDropWithRevenue: 0.05, // 5% dip with sustained revenue
    momentum: 0.02, // Low momentum threshold
  },

  // Sell signals - protect gains, cut losses
  sellSignals: {
    revenueDrop: 0.10, // Sell if revenue drops 10%
    priceDrop: 0.10, // Stop loss at 10% drop
    profitTake: 0.25, // Take profit at 25% gain
  },
};

export function createAliceConfig(circleWalletAddress?: string): AgentConfig {
  const knownAddress = circleWalletAddress || env.ALICE_WALLET_ADDRESS;
  return {
    id: "alice",
    name: "Alice (Academic)",
    circleWalletId: undefined, // Set during agent initialization
    evmAddress: (knownAddress || "0x0000000000000000000000000000000000000000") as Address,
    tokenAddress: env.ALICE_TOKEN_ADDRESS as Address,
    bondingCurveAddress: env.ALICE_BONDING_CURVE_ADDRESS as Address,
    strategyType: "academic",
    strategy: aliceStrategy,
  };
}

export const ALICE_STRATEGY = aliceStrategy;
