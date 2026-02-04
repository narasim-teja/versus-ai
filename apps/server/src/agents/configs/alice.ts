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
  // Treasury management - conservative
  minTreasuryBuffer: toUsdc(100), // Keep at least 100 USDC
  targetTreasuryBuffer: toUsdc(500), // Ideal balance is 500 USDC

  // Lending - cautious
  maxLTV: 50, // Never exceed 50% LTV
  borrowTrigger: toUsdc(50), // Consider borrowing when below 50 USDC
  repayTrigger: toUsdc(1000), // Repay loans when treasury > 1000 USDC

  // Speculation - minimal
  speculationBudget: 0.2, // Only use 20% of excess for trading

  // Buy signals - need strong evidence
  buySignals: {
    revenueGrowth: 0.15, // Need 15%+ revenue growth
    priceDropWithRevenue: 0.20, // 20% dip with sustained revenue
    momentum: 0.1, // Low momentum threshold
  },

  // Sell signals - protect gains, cut losses
  sellSignals: {
    revenueDrop: 0.25, // Sell if revenue drops 25%
    priceDrop: 0.15, // Stop loss at 15% drop
    profitTake: 0.50, // Take profit at 50% gain
  },
};

export function createAliceConfig(): AgentConfig {
  return {
    id: "alice",
    name: "Alice (Academic)",
    circleWalletId: undefined, // Set when wallet is created
    evmPrivateKey: env.ALICE_PRIVATE_KEY as `0x${string}`,
    evmAddress: env.ALICE_EVM_ADDRESS as Address,
    tokenAddress: env.ALICE_TOKEN_ADDRESS as Address,
    bondingCurveAddress: env.ALICE_BONDING_CURVE_ADDRESS as Address,
    strategyType: "academic",
    strategy: aliceStrategy,
  };
}

export const ALICE_STRATEGY = aliceStrategy;
