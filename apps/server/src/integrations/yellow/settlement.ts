/**
 * Yellow Network Settlement
 *
 * After a streaming session closes, triggers on-chain revenue distribution
 * via the existing RevenueDistributor contract.
 *
 * Revenue split: 70% creator, 20% token holders, 10% protocol
 *
 * Note: For hackathon, settlement is logged but actual on-chain execution
 * requires the server wallet to hold USDC from ClearNode channel closure
 * and be whitelisted as a settler on RevenueDistributor.
 */

import { logger } from "../../utils/logger";
import type { StreamingSession } from "./session";

/**
 * Trigger on-chain revenue distribution for a closed streaming session.
 *
 * In production, this would:
 * 1. Receive USDC from ClearNode channel closure
 * 2. Approve RevenueDistributor to spend USDC
 * 3. Call RevenueDistributor.distributeRevenue(creatorTokenAddress, amount)
 *
 * For now, logs the settlement intent for demo purposes.
 */
export async function triggerSettlement(
  session: StreamingSession,
): Promise<string | null> {
  const totalPaid = parseFloat(session.creatorBalance);

  if (totalPaid <= 0) {
    logger.info(
      { appSessionId: session.appSessionId },
      "No revenue to settle (zero paid)",
    );
    return null;
  }

  // Log settlement for demo
  logger.info(
    {
      appSessionId: session.appSessionId,
      videoId: session.videoId,
      creator: session.creatorAddress,
      totalPaid: session.creatorBalance,
      segmentsDelivered: session.segmentsDelivered,
      revenue: {
        creator: (totalPaid * 0.7).toFixed(6),
        tokenHolders: (totalPaid * 0.2).toFixed(6),
        protocol: (totalPaid * 0.1).toFixed(6),
      },
    },
    "Settlement triggered (revenue distribution)",
  );

  // TODO: Implement on-chain settlement when ready:
  // 1. Resolve creator's token address from creatorAddress
  // 2. const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() })
  // 3. await walletClient.writeContract({
  //      address: env.REVENUE_DISTRIBUTOR_ADDRESS,
  //      abi: revenueDistributorAbi,
  //      functionName: "distributeRevenue",
  //      args: [creatorTokenAddress, parseUnits(session.creatorBalance, 6)]
  //    })

  return null; // No tx hash yet - return hash when on-chain settlement is live
}
