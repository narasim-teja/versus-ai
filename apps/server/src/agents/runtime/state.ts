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
} from "../../integrations/chain/contracts";
import { getMarketSentiment } from "../../integrations/stork";
import {
  getWalletByAgentId,
  getUsdcBalance as getCircleUsdcBalance,
} from "../../integrations/circle/wallet";
import { isCircleConfigured } from "../../integrations/circle/client";
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

// Cached creator data (refreshed every 5 minutes)
const CREATOR_CACHE_TTL_MS = 5 * 60 * 1000;
let creatorCacheTimestamp = 0;
let cachedTokenToBondingCurve = new Map<string, Address>();
let cachedCreatorInfos: Array<{ wallet: Address; tokenAddress: Address; bondingCurveAddress: Address }> = [];

/**
 * Refresh the creator cache if stale
 */
async function refreshCreatorCache(): Promise<void> {
  const now = Date.now();
  if (now - creatorCacheTimestamp < CREATOR_CACHE_TTL_MS && cachedCreatorInfos.length > 0) {
    return;
  }

  const creatorFactory = getCreatorFactory();
  const creatorWallets = (await creatorFactory.read.getAllCreators()) as readonly Address[];

  const newMap = new Map<string, Address>();
  const newInfos: typeof cachedCreatorInfos = [];

  for (const wallet of creatorWallets) {
    try {
      const creatorInfo = await creatorFactory.read.getCreator([wallet]);
      const tokenAddr = (creatorInfo as [Address, Address, Address, bigint])[0];
      const bondingCurveAddr = (creatorInfo as [Address, Address, Address, bigint])[1];
      newMap.set(tokenAddr.toLowerCase(), bondingCurveAddr);
      newInfos.push({ wallet, tokenAddress: tokenAddr, bondingCurveAddress: bondingCurveAddr });
    } catch (error) {
      logger.warn({ wallet, error }, "Failed to read creator info for cache");
    }
  }

  cachedTokenToBondingCurve = newMap;
  cachedCreatorInfos = newInfos;
  creatorCacheTimestamp = now;
  logger.debug({ creatorCount: newMap.size }, "Creator mapping cache refreshed");
}

/**
 * Get cached token → bonding curve address mapping
 */
async function getTokenToBondingCurveMap(): Promise<Map<string, Address>> {
  await refreshCreatorCache();
  return cachedTokenToBondingCurve;
}

/**
 * Get cached creator infos (wallet, token, bondingCurve)
 */
async function getCachedCreatorInfos(): Promise<typeof cachedCreatorInfos> {
  await refreshCreatorCache();
  return cachedCreatorInfos;
}

/**
 * Get current cycle number for an agent
 */
function getCycle(agentId: string): number {
  const current = cycleCounters.get(agentId) || 0;
  cycleCounters.set(agentId, current + 1);
  return current + 1;
}

/**
 * Read own token data from bonding curve and token
 */
async function readOwnTokenData(config: AgentConfig): Promise<{
  price: bigint;
  supply: bigint;
  revenue: bigint;
}> {
  const bondingCurve = getBondingCurve(config.bondingCurveAddress);
  const token = getERC20(config.tokenAddress);

  const [price, supply, revenue] = await Promise.all([
    bondingCurve.read.getPrice(),
    token.read.totalSupply(),
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
 *
 * Uses Circle wallet if available, falls back to on-chain balance.
 */
async function readUsdcBalance(agentId: string, evmAddress: Address): Promise<bigint> {
  // Try Circle wallet first
  if (isCircleConfigured()) {
    try {
      const circleWallet = await getWalletByAgentId(agentId);
      if (circleWallet) {
        const balance = await getCircleUsdcBalance(circleWallet.id);
        logger.debug(
          { agentId, circleWalletId: circleWallet.id, balance: balance.toString() },
          "Read USDC balance from Circle wallet"
        );
        return balance;
      }
    } catch (error) {
      logger.warn(
        { agentId, error },
        "Failed to read Circle wallet balance, falling back to on-chain"
      );
    }
  }

  // Fallback to on-chain USDC balance
  const usdc = getUSDC();
  const balance = await usdc.read.balanceOf([evmAddress]);
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
    // Health factor is returned with 18 decimal precision (1e18 = 1.0)
    // A health factor of 1.5 would be 1.5e18 = 1500000000000000000
    const healthFactor = await lendingPool.read.getHealthFactor([agentAddress]);
    const healthFactorNumber = Number(healthFactor as bigint) / 1e18;

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

  // Get cached token → bonding curve mapping
  const tokenToBondingCurve = await getTokenToBondingCurveMap();

  // Enrich with current prices
  const enrichedHoldings: Holding[] = [];

  for (const h of dbHoldings) {
    try {
      const tokenAddress = h.tokenAddress as Address;

      // Skip own token
      if (tokenAddress.toLowerCase() === config.tokenAddress.toLowerCase()) {
        continue;
      }

      // Get bonding curve address - skip if not found
      const bondingCurveAddr = tokenToBondingCurve.get(tokenAddress.toLowerCase());
      if (!bondingCurveAddr) {
        logger.warn(
          { tokenAddress },
          "No bonding curve found for token, skipping"
        );
        continue;
      }

      // Get current token balance and decimals
      const token = getERC20(tokenAddress);
      const [currentBalance, tokenDecimals] = await Promise.all([
        token.read.balanceOf([config.evmAddress]),
        token.read.decimals(),
      ]);

      // Skip if no balance
      if ((currentBalance as bigint) === BigInt(0)) {
        continue;
      }

      // Get current price from bonding curve
      const bondingCurve = getBondingCurve(bondingCurveAddr);
      const currentPrice = (await bondingCurve.read.getPrice()) as bigint;

      const avgBuyPrice = BigInt(h.avgBuyPrice);
      const totalCostBasis = BigInt(h.totalCostBasis);

      // Calculate P&L using actual token decimals
      const decimals = Number(tokenDecimals);
      const currentValue = (currentBalance as bigint * currentPrice) / BigInt(10 ** decimals);
      const unrealizedPnl = currentValue - totalCostBasis;
      const pnlPercent =
        totalCostBasis > BigInt(0)
          ? Number((unrealizedPnl * BigInt(10000)) / totalCostBasis) / 100
          : 0;

      enrichedHoldings.push({
        tokenAddress,
        bondingCurveAddress: bondingCurveAddr,
        tokenName: h.tokenName || "Unknown",
        tokenDecimals: decimals,
        balance: currentBalance as bigint,
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
  const creatorInfos = await getCachedCreatorInfos();

  const otherCreators: OtherCreator[] = [];

  for (const { wallet: creatorWallet, tokenAddress, bondingCurveAddress } of creatorInfos) {
    // Skip self
    if (creatorWallet.toLowerCase() === excludeAddress.toLowerCase()) {
      continue;
    }

    try {
      const bondingCurve = getBondingCurve(bondingCurveAddress);
      const token = getERC20(tokenAddress);

      const [price, totalSupply, pendingRevenue] = await Promise.all([
        bondingCurve.read.getPrice(),
        token.read.totalSupply(),
        bondingCurve.read.earned([creatorWallet]),
      ]);

      otherCreators.push({
        creatorAddress: creatorWallet,
        tokenAddress,
        bondingCurveAddress,
        currentPrice: price as bigint,
        totalSupply: totalSupply as bigint,
        pendingRevenue: pendingRevenue as bigint,
      });
    } catch (error) {
      logger.warn(
        { creatorAddress: creatorWallet, error },
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
export async function readAgentState(config: AgentConfig, pendingTxs: string[] = []): Promise<AgentState> {
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
      readUsdcBalance(config.id, config.evmAddress),
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
      pendingTxs,
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
