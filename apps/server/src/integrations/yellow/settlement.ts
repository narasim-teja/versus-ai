/**
 * Yellow Network Settlement
 *
 * After a streaming session closes on ClearNode, triggers cross-chain settlement:
 * 1. Record settlement on Base Sepolia (VideoRegistry)
 * 2. Initiate bridge from Base Sepolia to ARC (BridgeEscrow)
 * 3. Distribute revenue on ARC testnet (RevenueDistributor)
 *
 * Revenue split: 70% creator, 20% token holders, 10% protocol
 */

import { logger } from "../../utils/logger";
import type { StreamingSession } from "./session";
import {
  recordSettlementOnChain,
  initiateBridgeOnChain,
  distributeRevenueOnChain,
} from "../chain/video-registry";
import { getBasePublicClient } from "../chain/base-client";

export interface SettlementResult {
  settlementTxHash: string | null; // Base Sepolia - settlement record
  bridgeTxHash: string | null; // Base Sepolia - bridge escrow
  distributionTxHash: string | null; // ARC testnet - revenue distribution
  // Nitrolite Custody on-chain channel tx hashes
  custodyDepositTxHash: string | null; // Base Sepolia - USDC deposited into Custody
  channelCloseTxHash: string | null; // Base Sepolia - channel closed on-chain
  custodyWithdrawTxHash: string | null; // Base Sepolia - funds withdrawn from Custody
  channelId: string | null; // On-chain state channel ID
}

/**
 * Trigger cross-chain revenue distribution for a closed streaming session.
 *
 * Flow:
 * 1. Record settlement on Base Sepolia (same chain as Yellow Custody/Adjudicator)
 * 2. Lock USDC in BridgeEscrow on Base Sepolia (CCTP demo)
 * 3. Distribute revenue on ARC testnet via RevenueDistributor
 *
 * All on-chain calls are gracefully degraded — if one fails, the rest continue.
 */
export async function triggerSettlement(
  session: StreamingSession,
): Promise<SettlementResult> {
  const totalPaid = parseFloat(session.creatorBalance);

  if (totalPaid <= 0) {
    logger.info(
      { appSessionId: session.appSessionId },
      "No revenue to settle (zero paid)",
    );
    return {
      settlementTxHash: null,
      bridgeTxHash: null,
      distributionTxHash: null,
      custodyDepositTxHash: session.custodyDepositTxHash,
      channelCloseTxHash: session.channelCloseTxHash,
      custodyWithdrawTxHash: session.custodyWithdrawTxHash,
      channelId: session.channelId,
    };
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
    "Settlement: initiating cross-chain revenue distribution",
  );

  // Step 1: Record settlement on Base Sepolia (VideoRegistry)
  const settlementTxHash = await recordSettlementOnChain(
    session.videoId,
    session.viewerAddress,
    session.segmentsDelivered,
    session.creatorBalance,
    session.appSessionId,
  );

  // Wait for settlement tx to be mined before bridge (same wallet, prevents nonce race)
  if (settlementTxHash) {
    try {
      const publicClient = getBasePublicClient();
      await publicClient.waitForTransactionReceipt({ hash: settlementTxHash as `0x${string}` });
    } catch (err) {
      logger.warn({ err, settlementTxHash }, "Failed to wait for settlement tx receipt (continuing)");
    }
  }

  // Step 2: Initiate bridge on Base Sepolia (BridgeEscrow → CCTP demo)
  let bridgeTxHash: string | null = null;
  if (session.creatorTokenAddress) {
    bridgeTxHash = await initiateBridgeOnChain(
      session.creatorBalance,
      session.creatorAddress,
      session.creatorTokenAddress,
    );
  } else {
    logger.warn(
      { appSessionId: session.appSessionId },
      "No creatorTokenAddress — skipping bridge",
    );
  }

  // Step 3: Distribute revenue on ARC testnet (RevenueDistributor)
  let distributionTxHash: string | null = null;
  if (session.creatorTokenAddress) {
    distributionTxHash = await distributeRevenueOnChain(
      session.creatorTokenAddress,
      session.creatorBalance,
    );
  } else {
    logger.warn(
      { appSessionId: session.appSessionId },
      "No creatorTokenAddress — skipping distribution",
    );
  }

  logger.info(
    {
      appSessionId: session.appSessionId,
      settlementTxHash,
      bridgeTxHash,
      distributionTxHash,
    },
    "Settlement complete",
  );

  return {
    settlementTxHash,
    bridgeTxHash,
    distributionTxHash,
    custodyDepositTxHash: session.custodyDepositTxHash,
    channelCloseTxHash: session.channelCloseTxHash,
    custodyWithdrawTxHash: session.custodyWithdrawTxHash,
    channelId: session.channelId,
  };
}
