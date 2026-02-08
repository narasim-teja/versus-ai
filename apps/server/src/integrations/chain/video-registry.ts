/**
 * Video Registry & Bridge Escrow On-Chain Integration
 *
 * Handles interactions with VideoRegistry and BridgeEscrow contracts on Base Sepolia,
 * and RevenueDistributor on ARC testnet.
 *
 * All calls are wrapped in try-catch for graceful degradation:
 * if on-chain fails, the streaming flow continues normally.
 */

import { keccak256, toHex, parseUnits, type Hex } from "viem";
import { getBasePublicClient, getBaseWalletClient } from "./base-client";
import { getPublicClient, createAgentWalletClient } from "./client";
import {
  videoRegistryAbi,
  bridgeEscrowAbi,
  revenueDistributorAbi,
  erc20Abi,
} from "./abis";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

// ─── Helpers ────────────────────────────────────────────────────────

function hashVideoId(videoId: string): Hex {
  return keccak256(toHex(videoId));
}

function isBaseSepoliaConfigured(): boolean {
  return !!(env.VIDEO_REGISTRY_ADDRESS && env.YELLOW_SERVER_PRIVATE_KEY);
}

function isBridgeConfigured(): boolean {
  return !!(env.BRIDGE_ESCROW_ADDRESS && env.YELLOW_SERVER_PRIVATE_KEY);
}

function isArcSettlementConfigured(): boolean {
  return !!(env.REVENUE_DISTRIBUTOR_ADDRESS && env.YELLOW_SERVER_PRIVATE_KEY);
}

// ─── Video Registration (Base Sepolia) ──────────────────────────────

/**
 * Register a video's merkle root on-chain on Base Sepolia.
 * Called after video processing completes.
 */
export async function registerVideoOnChain(
  videoId: string,
  merkleRoot: string,
  creatorAddress: string,
  totalSegments: number,
): Promise<string | null> {
  if (!isBaseSepoliaConfigured()) {
    logger.debug("Base Sepolia not configured, skipping video registration");
    return null;
  }

  try {
    const walletClient = getBaseWalletClient();
    if (!walletClient) return null;

    const videoIdHash = hashVideoId(videoId);
    // merkleRoot is a hex string — pad to bytes32 if needed
    const merkleRootBytes = merkleRoot.startsWith("0x")
      ? (merkleRoot as Hex)
      : (`0x${merkleRoot}` as Hex);

    const txHash = await walletClient.writeContract({
      address: env.VIDEO_REGISTRY_ADDRESS as `0x${string}`,
      abi: videoRegistryAbi,
      functionName: "registerVideo",
      args: [
        videoIdHash,
        merkleRootBytes,
        creatorAddress as `0x${string}`,
        BigInt(totalSegments),
      ],
    });

    logger.info(
      { videoId, txHash, chain: "baseSepolia" },
      "Video registered on-chain",
    );
    return txHash;
  } catch (err) {
    logger.error(
      { err, videoId },
      "Failed to register video on-chain (continuing without on-chain commitment)",
    );
    return null;
  }
}

// ─── Settlement Recording (Base Sepolia) ────────────────────────────

/**
 * Record a settlement event on-chain on Base Sepolia.
 * Called when a Yellow streaming session closes.
 */
export async function recordSettlementOnChain(
  videoId: string,
  viewerAddress: string,
  segmentsWatched: number,
  totalPaid: string,
  yellowSessionId: string,
): Promise<string | null> {
  if (!isBaseSepoliaConfigured()) {
    logger.debug("Base Sepolia not configured, skipping settlement record");
    return null;
  }

  try {
    const walletClient = getBaseWalletClient();
    if (!walletClient) return null;

    const videoIdHash = hashVideoId(videoId);
    // totalPaid is a decimal string like "0.050000" — convert to USDC wei (6 decimals)
    const totalPaidWei = parseUnits(totalPaid, 6);

    const txHash = await walletClient.writeContract({
      address: env.VIDEO_REGISTRY_ADDRESS as `0x${string}`,
      abi: videoRegistryAbi,
      functionName: "recordSettlement",
      args: [
        videoIdHash,
        viewerAddress as `0x${string}`,
        BigInt(segmentsWatched),
        totalPaidWei,
        yellowSessionId,
      ],
    });

    logger.info(
      { videoId, txHash, chain: "baseSepolia" },
      "Settlement recorded on-chain",
    );
    return txHash;
  } catch (err) {
    logger.error(
      { err, videoId, yellowSessionId },
      "Failed to record settlement on-chain",
    );
    return null;
  }
}

// ─── Bridge Escrow (Base Sepolia → ARC) ─────────────────────────────

/**
 * Initiate a CCTP bridge demo: lock USDC on Base Sepolia.
 * Emits BridgeInitiated event for cross-chain tracking.
 */
export async function initiateBridgeOnChain(
  totalPaid: string,
  creatorAddress: string,
  creatorTokenAddress: string,
): Promise<string | null> {
  if (!isBridgeConfigured()) {
    logger.debug("Bridge escrow not configured, skipping bridge");
    return null;
  }

  try {
    const walletClient = getBaseWalletClient();
    if (!walletClient) return null;

    const amount = parseUnits(totalPaid, 6);
    if (amount <= 0n) return null;

    const baseSepoliaUsdc = (env.BASE_SEPOLIA_USDC_ADDRESS ||
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`;

    // Approve BridgeEscrow to spend USDC (wait for confirmation)
    const basePublicClient = getBasePublicClient();
    const approveHash = await walletClient.writeContract({
      address: baseSepoliaUsdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [env.BRIDGE_ESCROW_ADDRESS as `0x${string}`, amount],
    });
    await basePublicClient.waitForTransactionReceipt({ hash: approveHash });

    // Initiate bridge
    const txHash = await walletClient.writeContract({
      address: env.BRIDGE_ESCROW_ADDRESS as `0x${string}`,
      abi: bridgeEscrowAbi,
      functionName: "initiateBridge",
      args: [
        amount,
        5042002, // ARC testnet chain ID
        creatorAddress as `0x${string}`,
        creatorTokenAddress as `0x${string}`,
      ],
    });

    logger.info(
      { txHash, amount: totalPaid, chain: "baseSepolia" },
      "Bridge initiated on-chain",
    );
    return txHash;
  } catch (err) {
    logger.error({ err }, "Failed to initiate bridge on-chain");
    return null;
  }
}

// ─── Revenue Distribution (ARC Testnet) ─────────────────────────────

/**
 * Distribute revenue on ARC testnet via RevenueDistributor.
 * Called after bridge to complete the cross-chain settlement flow.
 */
export async function distributeRevenueOnChain(
  creatorTokenAddress: string,
  totalPaid: string,
): Promise<string | null> {
  if (!isArcSettlementConfigured()) {
    logger.debug("ARC settlement not configured, skipping distribution");
    return null;
  }

  try {
    const privateKey = env.YELLOW_SERVER_PRIVATE_KEY as `0x${string}`;
    const walletClient = createAgentWalletClient(privateKey);

    const amount = parseUnits(totalPaid, 6);
    if (amount <= 0n) return null;

    const usdcAddress = env.USDC_ADDRESS as `0x${string}`;
    const distributorAddress = env.REVENUE_DISTRIBUTOR_ADDRESS as `0x${string}`;
    const arcPublicClient = getPublicClient();

    // Approve RevenueDistributor to spend USDC (wait for confirmation)
    const approveHash = await walletClient.writeContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [distributorAddress, amount],
    });
    await arcPublicClient.waitForTransactionReceipt({ hash: approveHash });

    // Distribute revenue (70% creator, 20% holders, 10% protocol)
    const txHash = await walletClient.writeContract({
      address: distributorAddress,
      abi: revenueDistributorAbi,
      functionName: "distributeRevenue",
      args: [creatorTokenAddress as `0x${string}`, amount],
    });

    logger.info(
      { txHash, creatorTokenAddress, amount: totalPaid, chain: "arcTestnet" },
      "Revenue distributed on-chain",
    );
    return txHash;
  } catch (err) {
    logger.error(
      { err, creatorTokenAddress },
      "Failed to distribute revenue on-chain",
    );
    return null;
  }
}
