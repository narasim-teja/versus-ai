/**
 * Agent State Reader
 *
 * Reads the complete state for an agent each decision cycle.
 * Gathers data from:
 * - On-chain contracts (token prices, balances, loans)
 * - Circle API (USDC balance)
 * - Stork Oracle (market sentiment)
 * - Local database (holdings, cost basis)
 */

import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { db } from "../../db/client";
import { holdings as holdingsTable } from "../../db/schema";
import {
  getBondingCurve,
  getCreatorFactory,
  getLendingPool,
  getUSDC,
  getERC20,
  addresses,
} from "../../integrations/chain/contracts";
import { getPublicClient } from "../../integrations/chain/client";
import { getMarketSentiment } from "../../integrations/stork";
import { logger } from "../../utils/logger";
import type {
  AgentConfig,
  AgentState,
  Holding,
  LoanInfo,
  OtherCreator,
} from "../types";

// In-memory cycle counter per agent
const cycleCounters = new Map<string, number>();

/**
 * Get current cycle number for an agent
 */
function getCycle(agentId: string): number {
  const current = cycleCounters.get(agentId) || 0;
  cycleCounters.set(agentId, current + 1);
  return current + 1;
}

/**
 * Read own token data from bonding curve
 */
async function readOwnTokenData(config: AgentConfig): Promise<{
  price: bigint;
  supply: bigint;
  revenue: bigint;
}> {
  const bondingCurve = getBondingCurve(config.bondingCurveAddress);

  const [price, supply, revenue] = await Promise.all([
    bondingCurve.read.getPrice(),
    bondingCurve.read.totalSupply(),
    bondingCurve.read.earned([config.evmAddress]),
  ]);

  return {
    price: price as bigint,
    supply: supply as bigint,
    revenue: revenue as bigint,
  };
}

/**
 * Read USDC balance for agent
 */
async function readUsdcBalance(address: Address): Promise<bigint> {
  const usdc = getUSDC();
  const balance = await usdc.read.balanceOf([address]);
  return balance as bigint;
}

/**
 * Read loan information from LendingPool
 */
async function readLoanInfo(agentAddress: Address): Promise<LoanInfo | null> {
  const lendingPool = getLendingPool();

  try {
    // Get loan data - structure: (collateralToken, collateralAmount, borrowedAmount, timestamp)
    const loan = await lendingPool.read.loans([agentAddress]);

    // Check if loan exists (borrowed amount > 0)
    const borrowedAmount = loan[2] as bigint;
    if (borrowedAmount === BigInt(0)) {
      return null;
    }

    const collateralToken = loan[0] as Address;
    const collateralAmount = loan[1] as bigint;

    // Get health factor
    const healthFactor = await lendingPool.read.getHealthFactor([agentAddress]);
    const healthFactorNumber = Number(healthFactor) / 10000; // Assuming 4 decimal precision

    // Get collateral value in USDC
    const collateralValue = await lendingPool.read.getCollateralValue([
      agentAddress,
    ]);

    // Calculate current LTV
    const currentLTV =
      collateralValue > BigInt(0)
        ? Number((borrowedAmount * BigInt(100)) / (collateralValue as bigint))
        : 0;

    // Calculate liquidation price (85% threshold)
    // liquidationPrice = borrowedAmount / (collateralAmount * 0.85)
    const liquidationPrice =
      collateralAmount > BigInt(0)
        ? (borrowedAmount * BigInt(10000)) / (collateralAmount * BigInt(8500))
        : BigInt(0);

    return {
      active: true,
      collateralToken,
      collateralAmount,
      borrowedAmount,
      healthFactor: healthFactorNumber,
      currentLTV,
      liquidationPrice,
    };
  } catch (error) {
    logger.debug({ agentAddress, error }, "No active loan or error reading loan");
    return null;
  }
}

/**
 * Read holdings from database and enrich with current prices
 */
async function readHoldings(config: AgentConfig): Promise<Holding[]> {
  // Get holdings from database
  const dbHoldings = await db.query.holdings.findMany({
    where: eq(holdingsTable.agentId, config.id),
  });

  if (dbHoldings.length === 0) {
    return [];
  }

  // Enrich with current prices
  const enrichedHoldings: Holding[] = [];

  for (const h of dbHoldings) {
    try {
      const tokenAddress = h.tokenAddress as Address;

      // Skip own token
      if (tokenAddress.toLowerCase() === config.tokenAddress.toLowerCase()) {
        continue;
      }

      // Get current token balance
      const token = getERC20(tokenAddress);
      const currentBalance = (await token.read.balanceOf([
        config.evmAddress,
      ])) as bigint;

      // Skip if no balance
      if (currentBalance === BigInt(0)) {
        continue;
      }

      // Get current price from bonding curve
      // Need to find the bonding curve for this token
      const creatorFactory = getCreatorFactory();
      const creators = await creatorFactory.read.getAllCreators();

      let currentPrice = BigInt(0);
      for (const creator of creators as Array<[Address, Address, Address]>) {
        if (creator[1].toLowerCase() === tokenAddress.toLowerCase()) {
          const bondingCurve = getBondingCurve(creator[2]);
          currentPrice = (await bondingCurve.read.getPrice()) as bigint;
          break;
        }
      }

      const balance = BigInt(h.balance);
      const avgBuyPrice = BigInt(h.avgBuyPrice);
      const totalCostBasis = BigInt(h.totalCostBasis);

      // Calculate P&L
      const currentValue = (currentBalance * currentPrice) / BigInt(10 ** 18); // Assuming 18 decimal tokens
      const unrealizedPnl = currentValue - totalCostBasis;
      const pnlPercent =
        totalCostBasis > BigInt(0)
          ? Number((unrealizedPnl * BigInt(10000)) / totalCostBasis) / 100
          : 0;

      enrichedHoldings.push({
        tokenAddress,
        tokenName: h.tokenName || "Unknown",
        balance: currentBalance,
        avgBuyPrice,
        totalCostBasis,
        currentPrice,
        unrealizedPnl,
        pnlPercent,
      });
    } catch (error) {
      logger.warn(
        { tokenAddress: h.tokenAddress, error },
        "Failed to enrich holding"
      );
    }
  }

  return enrichedHoldings;
}

/**
 * Read info about other creators for potential trading
 */
async function readOtherCreators(
  excludeAddress: Address
): Promise<OtherCreator[]> {
  const creatorFactory = getCreatorFactory();
  const creators = (await creatorFactory.read.getAllCreators()) as Array<
    [Address, Address, Address]
  >;

  const otherCreators: OtherCreator[] = [];

  for (const [creatorAddress, tokenAddress, bondingCurveAddress] of creators) {
    // Skip self
    if (creatorAddress.toLowerCase() === excludeAddress.toLowerCase()) {
      continue;
    }

    try {
      const bondingCurve = getBondingCurve(bondingCurveAddress);
      const token = getERC20(tokenAddress);

      const [price, totalSupply, pendingRevenue] = await Promise.all([
        bondingCurve.read.getPrice(),
        token.read.totalSupply(),
        bondingCurve.read.earned([creatorAddress]),
      ]);

      otherCreators.push({
        creatorAddress,
        tokenAddress,
        bondingCurveAddress,
        currentPrice: price as bigint,
        totalSupply: totalSupply as bigint,
        pendingRevenue: pendingRevenue as bigint,
      });
    } catch (error) {
      logger.warn(
        { creatorAddress, error },
        "Failed to read other creator data"
      );
    }
  }

  return otherCreators;
}

/**
 * Read complete agent state
 *
 * This is called at the start of each decision cycle.
 */
export async function readAgentState(config: AgentConfig): Promise<AgentState> {
  const timestamp = Date.now();
  const cycle = getCycle(config.id);

  logger.debug({ agentId: config.id, cycle }, "Reading agent state");

  try {
    // Parallel reads for efficiency
    const [
      ownTokenData,
      usdcBalance,
      loanInfo,
      holdings,
      marketSentiment,
      otherCreators,
    ] = await Promise.all([
      readOwnTokenData(config),
      readUsdcBalance(config.evmAddress),
      readLoanInfo(config.evmAddress),
      readHoldings(config),
      getMarketSentiment(),
      readOtherCreators(config.evmAddress),
    ]);

    const state: AgentState = {
      timestamp,
      cycle,
      usdcBalance,
      ownTokenPrice: ownTokenData.price,
      ownTokenSupply: ownTokenData.supply,
      ownTokenRevenue: ownTokenData.revenue,
      holdings,
      loan: loanInfo,
      marketSentiment,
      otherCreators,
      pendingTxs: [], // Will be populated by execution layer
    };

    logger.info(
      {
        agentId: config.id,
        cycle,
        usdcBalance: usdcBalance.toString(),
        ownTokenPrice: ownTokenData.price.toString(),
        holdingsCount: holdings.length,
        hasLoan: !!loanInfo,
        otherCreatorsCount: otherCreators.length,
      },
      "Agent state read complete"
    );

    return state;
  } catch (error) {
    logger.error({ agentId: config.id, cycle, error }, "Failed to read agent state");
    throw error;
  }
}

/**
 * Reset cycle counter for an agent (useful for testing)
 */
export function resetCycleCounter(agentId: string): void {
  cycleCounters.set(agentId, 0);
}
