/**
 * Yellow Network Settlement
 *
 * After a streaming session closes on ClearNode, triggers revenue distribution.
 * Logs final allocations with the revenue split for hackathon demo.
 *
 * Revenue split: 70% creator, 20% token holders, 10% protocol
 *
 * In production, the ClearNode channel closure returns USDC to the server,
 * which then calls RevenueDistributor.distributeRevenue() on-chain.
 */

import { logger } from "../../utils/logger";
import type { StreamingSession } from "./session";

/**
 * Trigger revenue distribution for a closed streaming session.
 *
 * Production flow:
 * 1. ClearNode channel closes → USDC flows to server address
 * 2. Server approves RevenueDistributor to spend USDC
 * 3. Server calls RevenueDistributor.distributeRevenue(creatorTokenAddress, amount)
 * 4. Contract splits: 70% creator, 20% buyback/burn, 10% protocol
 *
 * For hackathon: logs the settlement intent with full breakdown.
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

  const creatorShare = totalPaid * 0.7;
  const tokenHolderShare = totalPaid * 0.2;
  const protocolShare = totalPaid * 0.1;

  logger.info(
    {
      appSessionId: session.appSessionId,
      videoId: session.videoId,
      creator: session.creatorAddress,
      server: session.serverAddress,
      totalPaid: session.creatorBalance,
      viewerRefund: session.viewerBalance,
      segmentsDelivered: session.segmentsDelivered,
      stateVersion: session.version,
      sessionDuration: Math.round((Date.now() - session.createdAt) / 1000),
      revenue: {
        creator: creatorShare.toFixed(6),
        tokenHolders: tokenHolderShare.toFixed(6),
        protocol: protocolShare.toFixed(6),
      },
    },
    "Settlement: revenue distribution logged",
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
  // 4. Return tx hash

  return null; // No tx hash yet - return hash when on-chain settlement is live
}
