/**
 * Bob Agent Configuration
 *
 * Degen/Aggressive strategy:
 * - Lower treasury buffers for more deployment
 * - Higher LTV limits (more leverage)
 * - Larger speculation budget
 * - Quick to act on weaker signals
 */

import type { Address } from "viem";
import { env } from "../../utils/env";
import type { AgentConfig, StrategyConfig } from "../types";

// USDC has 6 decimals
const USDC_DECIMALS = 6;
const toUsdc = (amount: number) => BigInt(amount * 10 ** USDC_DECIMALS);

const bobStrategy: StrategyConfig = {
  // Treasury management - aggressive
  minTreasuryBuffer: toUsdc(25), // Keep only 25 USDC minimum
  targetTreasuryBuffer: toUsdc(100), // Ideal balance is 100 USDC

  // Lending - leveraged
  maxLTV: 65, // Push up to 65% LTV
  borrowTrigger: toUsdc(25), // Quick to borrow when below 25 USDC
  repayTrigger: toUsdc(500), // Only repay when treasury > 500 USDC

  // Speculation - aggressive
  speculationBudget: 0.5, // Use 50% of excess for trading

  // Buy signals - act on weak signals
  buySignals: {
    revenueGrowth: 0.05, // Only need 5% revenue growth
    priceDropWithRevenue: 0.10, // Buy 10% dips
    momentum: 0.05, // Very low momentum threshold
  },

  // Sell signals - hold longer, bigger swings
  sellSignals: {
    revenueDrop: 0.40, // Hold through 40% revenue drop
    priceDrop: 0.25, // Wide stop loss at 25%
    profitTake: 0.30, // Take profit earlier at 30%
  },
};

export function createBobConfig(circleWalletAddress?: string): AgentConfig {
  return {
    id: "bob",
    name: "Bob (Degen)",
    circleWalletId: undefined, // Set during agent initialization
    evmAddress: (circleWalletAddress || "0x0000000000000000000000000000000000000000") as Address,
    tokenAddress: env.BOB_TOKEN_ADDRESS as Address,
    bondingCurveAddress: env.BOB_BONDING_CURVE_ADDRESS as Address,
    strategyType: "degen",
    strategy: bobStrategy,
  };
}

export const BOB_STRATEGY = bobStrategy;
