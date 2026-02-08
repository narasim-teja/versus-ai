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
  // Treasury management - tuned for ~$20 testnet budget, ultra aggressive
  minTreasuryBuffer: toUsdc(1), // Keep only 1 USDC minimum
  targetTreasuryBuffer: toUsdc(3), // Ideal balance is 3 USDC

  // Lending - max leverage
  maxLTV: 65, // Push up to 65% LTV
  borrowTrigger: toUsdc(1), // Quick to borrow when below 1 USDC
  repayTrigger: toUsdc(20), // Only repay when treasury > 20 USDC

  // Speculation - full degen
  speculationBudget: 0.8, // Use 80% of excess for trading

  // Buy signals - act on anything
  buySignals: {
    revenueGrowth: 0.01, // Only need 1% revenue growth
    priceDropWithRevenue: 0.03, // Buy 3% dips
    momentum: 0.01, // Ultra low momentum threshold
  },

  // Sell signals - hold longer, bigger swings
  sellSignals: {
    revenueDrop: 0.30, // Hold through 30% revenue drop
    priceDrop: 0.20, // Wide stop loss at 20%
    profitTake: 0.15, // Take profit earlier at 15%
  },
};

export function createBobConfig(circleWalletAddress?: string): AgentConfig {
  const knownAddress = circleWalletAddress || env.BOB_WALLET_ADDRESS;
  return {
    id: "bob",
    name: "Bob (Degen)",
    circleWalletId: undefined, // Set during agent initialization
    evmAddress: (knownAddress || "0x0000000000000000000000000000000000000000") as Address,
    tokenAddress: env.BOB_TOKEN_ADDRESS as Address,
    bondingCurveAddress: env.BOB_BONDING_CURVE_ADDRESS as Address,
    strategyType: "degen",
    strategy: bobStrategy,
  };
}

export const BOB_STRATEGY = bobStrategy;
