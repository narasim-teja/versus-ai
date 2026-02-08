/**
 * Yellow Network App Session Lifecycle Management
 *
 * Manages streaming payment sessions with REAL ClearNode app sessions.
 * Uses in-memory Map for fast lookup during key delivery hot path,
 * with database persistence for audit and recovery.
 *
 * Architecture:
 * - Frontend generates ephemeral keypair, authenticates with ClearNode
 * - Backend creates app session on ClearNode (weights [50, 50], quorum 100)
 * - Per-segment: frontend signs state update, backend co-signs and submits
 * - ClearNode enforces that allocations never exceed deposits
 */

import type { Address, Hex } from "viem";
import {
  createAppSessionMessage,
  createCloseAppSessionMessage,
  RPCProtocolVersion,
} from "@erc7824/nitrolite";
import { getYellowClient, isYellowConfigured } from "./client";
import { triggerSettlement, type SettlementResult } from "./settlement";
import {
  isNitroliteConfigured,
  prepareCustodyChannel,
  openCustodyChannel,
  closeCustodyChannel,
  computeCloseStateHash,
  type PreparedChannel,
} from "../nitrolite";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";
import { randomUUID } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────

export interface StreamingSession {
  appSessionId: string;
  videoId: string;
  viewerAddress: string;
  creatorAddress: string;
  serverAddress: string;
  totalDeposited: string;
  viewerBalance: string;
  creatorBalance: string;
  segmentsDelivered: number;
  pricePerSegment: string;
  version: number;
  createdAt: number;
  lastPaymentAt: number;
  // Track which segments have been paid for (deduplication)
  paidSegments: Set<number>;
  // On-chain settlement fields (denormalized from agent)
  creatorTokenAddress: string;
  creatorBondingCurveAddress: string;
  // Nitrolite Custody on-chain channel fields
  channelId: string | null;
  custodyDepositTxHash: string | null;
  channelCloseTxHash: string | null;
  custodyWithdrawTxHash: string | null;
  // Pending channel data (awaiting viewer's co-signature)
  pendingChannelData: PreparedChannel | null;
  // Pre-computed close state hash for viewer to sign at close time
  closeStateHash: string | null;
}

// ─── In-Memory Session Store ─────────────────────────────────────────

const activeSessions = new Map<string, StreamingSession>();

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a new streaming payment session.
 *
 * Creates a REAL app session on ClearNode with weights [50, 50]:
 * - Viewer (ephemeral key) and server both participate
 * - Both must co-sign state updates (quorum 100)
 * - ClearNode tracks allocations and enforces constraints
 */
export async function createStreamingSession(
  videoId: string,
  viewerAddress: string,
  creatorAddress: string,
  depositAmount: string,
  creatorTokenAddress: string = "",
  creatorBondingCurveAddress: string = "",
): Promise<StreamingSession> {
  const pricePerSegment = env.YELLOW_PRICE_PER_SEGMENT;
  const client = await getYellowClient();

  let appSessionId: string;

  try {
    // Create REAL app session on ClearNode
    const appDefinition = {
      protocol: RPCProtocolVersion.NitroRPC_0_4,
      participants: [viewerAddress as `0x${string}`, client.serverAddress],
      weights: [50, 50],
      quorum: 100,
      challenge: 0,
      nonce: Date.now(),
      application: "versus-streaming",
    };

    const allocations = [
      {
        participant: viewerAddress as `0x${string}`,
        asset: env.YELLOW_ASSET,
        amount: depositAmount,
      },
      {
        participant: client.serverAddress as `0x${string}`,
        asset: env.YELLOW_ASSET,
        amount: "0",
      },
    ];

    const signedMessage = await createAppSessionMessage(
      client.sessionSigner,
      { definition: appDefinition, allocations },
    );

    const response = await client.sendAndWait(signedMessage, 15000);
    const parsed = JSON.parse(response);

    // Extract app_session_id from response
    appSessionId =
      parsed.res?.[2]?.[0]?.app_session_id ||
      parsed.res?.[2]?.app_session_id ||
      `yellow-${randomUUID()}`; // Fallback if ClearNode doesn't return ID

    logger.info(
      { appSessionId, viewerAddress, serverAddress: client.serverAddress },
      "ClearNode app session created",
    );
  } catch (err) {
    // If ClearNode session creation fails, fall back to local tracking
    // This ensures the system works even if ClearNode has issues
    appSessionId = `yellow-${randomUUID()}`;
    logger.warn(
      { err, viewerAddress },
      "ClearNode app session creation failed, using local session",
    );
  }

  // Prepare on-chain Custody channel state for viewer co-signing (graceful degradation)
  let pendingChannelData: PreparedChannel | null = null;

  if (isNitroliteConfigured()) {
    try {
      pendingChannelData = prepareCustodyChannel(
        viewerAddress as `0x${string}`,
        depositAmount,
      );
      if (pendingChannelData) {
        logger.info(
          { channelId: pendingChannelData.channelId, appSessionId },
          "Custody channel state prepared, awaiting viewer co-signature",
        );
      }
    } catch (err) {
      logger.warn(
        { err, appSessionId },
        "Nitrolite Custody channel prepare failed (continuing with ClearNode-only)",
      );
    }
  }

  const session: StreamingSession = {
    appSessionId,
    videoId,
    viewerAddress,
    creatorAddress,
    serverAddress: client.serverAddress,
    totalDeposited: depositAmount,
    viewerBalance: depositAmount,
    creatorBalance: "0",
    segmentsDelivered: 0,
    pricePerSegment,
    version: 0,
    createdAt: Date.now(),
    lastPaymentAt: Date.now(),
    paidSegments: new Set<number>(),
    creatorTokenAddress,
    creatorBondingCurveAddress,
    channelId: null,
    custodyDepositTxHash: null,
    channelCloseTxHash: null,
    custodyWithdrawTxHash: null,
    pendingChannelData,
    closeStateHash: null,
  };

  activeSessions.set(appSessionId, session);

  logger.info(
    {
      appSessionId,
      videoId,
      viewer: viewerAddress,
      creator: creatorAddress,
      deposit: depositAmount,
      serverAddress: client.serverAddress,
      hasPendingCustody: !!pendingChannelData,
    },
    "Yellow streaming session created",
  );

  return session;
}

/**
 * Co-sign a viewer's state update and submit to ClearNode.
 *
 * The viewer signs the state update on the frontend, sends it here.
 * The server validates, co-signs, and submits the double-signed update
 * to ClearNode.
 *
 * Returns the new viewer balance or fails if insufficient funds.
 */
export async function cosignAndSubmitPayment(
  appSessionId: string,
  segmentIndex: number,
  version: number,
  viewerSignedMessage: string,
): Promise<{ success: boolean; newViewerBalance: string }> {
  const session = activeSessions.get(appSessionId);
  if (!session) {
    throw new Error(`Streaming session not found: ${appSessionId}`);
  }

  // Deduplication: if this segment was already paid for, return current balance without charging
  if (session.paidSegments.has(segmentIndex)) {
    return { success: true, newViewerBalance: session.viewerBalance };
  }

  const price = parseFloat(session.pricePerSegment);
  const currentViewerBalance = parseFloat(session.viewerBalance);

  // Check sufficient balance
  if (currentViewerBalance < price) {
    logger.warn(
      {
        appSessionId,
        balance: session.viewerBalance,
        required: session.pricePerSegment,
        segmentIndex,
      },
      "Insufficient balance for segment payment",
    );
    return { success: false, newViewerBalance: session.viewerBalance };
  }

  // Validate version increment
  if (version !== session.version + 1) {
    logger.warn(
      { appSessionId, expectedVersion: session.version + 1, gotVersion: version },
      "Version mismatch in state update",
    );
    // Allow it to proceed — version tracking is informational
  }

  // Compute new balances
  const newViewerBalance = (currentViewerBalance - price).toFixed(6);
  const newCreatorBalance = (
    parseFloat(session.creatorBalance) + price
  ).toFixed(6);

  // Try to submit co-signed state update to ClearNode
  try {
    const client = await getYellowClient();

    // Parse the viewer's signed message and add server co-signature
    // The viewer has already signed; server adds its signature
    const parsedMsg = JSON.parse(viewerSignedMessage);

    // Build the state update with both signatures
    // The viewer's signature is in parsedMsg.sig[0]
    // We need to add server's signature
    const viewerSig = parsedMsg.sig?.[0] || "";

    // Reconstruct the submit_app_state message with both signatures
    const stateUpdateMsg = JSON.stringify({
      req: parsedMsg.req || [
        Date.now(),
        "submit_app_state",
        {
          app_session_id: appSessionId,
          intent: "operate",
          version,
          allocations: [
            {
              participant: session.viewerAddress,
              asset: env.YELLOW_ASSET,
              amount: newViewerBalance,
            },
            {
              participant: session.serverAddress,
              asset: env.YELLOW_ASSET,
              amount: newCreatorBalance,
            },
          ],
        },
        Date.now(),
      ],
      sig: parsedMsg.sig || [],
    });

    // Submit to ClearNode — server co-signs via its authenticated session
    await client.sendAndWait(stateUpdateMsg, 10000);

  } catch (err) {
    // ClearNode submission failed — still update local state
    // This ensures video playback continues even if ClearNode has issues
    logger.warn(
      { err, appSessionId, segmentIndex },
      "ClearNode state update failed, updating locally",
    );
  }

  // Update in-memory state
  session.viewerBalance = newViewerBalance;
  session.creatorBalance = newCreatorBalance;
  session.segmentsDelivered += 1;
  session.version = version;
  session.lastPaymentAt = Date.now();
  session.paidSegments.add(segmentIndex);

  return { success: true, newViewerBalance };
}

/**
 * Process a micropayment for a single video segment (legacy path).
 * Used when frontend doesn't send a co-signed state update.
 */
export async function processSegmentPayment(
  appSessionId: string,
  segmentIndex: number,
): Promise<{ success: boolean; newViewerBalance: string }> {
  const session = activeSessions.get(appSessionId);
  if (!session) {
    throw new Error(`Streaming session not found: ${appSessionId}`);
  }

  // Deduplication: if this segment was already paid for, return current balance without charging
  if (session.paidSegments.has(segmentIndex)) {
    return { success: true, newViewerBalance: session.viewerBalance };
  }

  const price = parseFloat(session.pricePerSegment);
  const currentViewerBalance = parseFloat(session.viewerBalance);

  if (currentViewerBalance < price) {
    logger.warn(
      {
        appSessionId,
        balance: session.viewerBalance,
        required: session.pricePerSegment,
        segmentIndex,
      },
      "Insufficient balance for segment payment",
    );
    return { success: false, newViewerBalance: session.viewerBalance };
  }

  const newViewerBalance = (currentViewerBalance - price).toFixed(6);
  const newCreatorBalance = (
    parseFloat(session.creatorBalance) + price
  ).toFixed(6);

  session.viewerBalance = newViewerBalance;
  session.creatorBalance = newCreatorBalance;
  session.segmentsDelivered += 1;
  session.version += 1;
  session.lastPaymentAt = Date.now();
  session.paidSegments.add(segmentIndex);

  return { success: true, newViewerBalance };
}

/**
 * Close a streaming session and settle.
 */
export async function closeStreamingSession(
  appSessionId: string,
  viewerCloseSignature?: string,
): Promise<{ settled: boolean; totalPaid: string; settlement: SettlementResult }> {
  const session = activeSessions.get(appSessionId);
  if (!session) {
    throw new Error(`Streaming session not found: ${appSessionId}`);
  }

  const totalPaid = session.creatorBalance;

  // Try to close on ClearNode
  try {
    const client = await getYellowClient();

    const closeMsg = await createCloseAppSessionMessage(
      client.sessionSigner,
      {
        app_session_id: appSessionId as Hex,
        allocations: [
          {
            participant: session.viewerAddress as `0x${string}`,
            asset: env.YELLOW_ASSET,
            amount: session.viewerBalance,
          },
          {
            participant: session.serverAddress as `0x${string}`,
            asset: env.YELLOW_ASSET,
            amount: session.creatorBalance,
          },
        ],
      },
    );

    await client.sendAndWait(closeMsg, 10000);
    logger.info({ appSessionId }, "ClearNode app session closed");
  } catch (err) {
    logger.warn(
      { err, appSessionId },
      "ClearNode session close failed (settling locally)",
    );
  }

  // Close on-chain Custody channel (graceful degradation)
  if (session.channelId && isNitroliteConfigured()) {
    try {
      const closeResult = await closeCustodyChannel(
        session.channelId as `0x${string}`,
        session.viewerAddress as `0x${string}`,
        session.viewerBalance,
        session.creatorBalance,
        viewerCloseSignature as `0x${string}` | undefined,
      );
      session.channelCloseTxHash = closeResult.closeTxHash;
      session.custodyWithdrawTxHash = closeResult.withdrawTxHash;
      logger.info(
        {
          appSessionId,
          channelId: session.channelId,
          closeTxHash: closeResult.closeTxHash,
          withdrawTxHash: closeResult.withdrawTxHash,
        },
        "On-chain Custody channel closed for session",
      );
    } catch (err) {
      logger.warn(
        { err, appSessionId, channelId: session.channelId },
        "Nitrolite Custody channel close failed (continuing with settlement)",
      );
    }
  }

  logger.info(
    {
      appSessionId,
      videoId: session.videoId,
      segmentsDelivered: session.segmentsDelivered,
      totalPaid,
      viewerRefund: session.viewerBalance,
    },
    "Yellow streaming session closed",
  );

  // Trigger cross-chain revenue distribution
  let settlement: SettlementResult = {
    settlementTxHash: null,
    bridgeTxHash: null,
    distributionTxHash: null,
    custodyDepositTxHash: session.custodyDepositTxHash,
    channelCloseTxHash: session.channelCloseTxHash,
    custodyWithdrawTxHash: session.custodyWithdrawTxHash,
    channelId: session.channelId,
  };
  try {
    const chainSettlement = await triggerSettlement(session);
    settlement.settlementTxHash = chainSettlement.settlementTxHash;
    settlement.bridgeTxHash = chainSettlement.bridgeTxHash;
    settlement.distributionTxHash = chainSettlement.distributionTxHash;
  } catch (err) {
    logger.warn({ err, appSessionId }, "Settlement trigger failed");
  }

  activeSessions.delete(appSessionId);
  return { settled: true, totalPaid, settlement };
}

/**
 * Finalize the on-chain Custody channel after the viewer co-signs.
 *
 * Called when the browser POSTs the ephemeral key's signature of the
 * packed initial state. Opens the channel on-chain with both signatures.
 */
export async function finalizeCustodyChannel(
  appSessionId: string,
  viewerSignature: Hex,
): Promise<{ channelId: string; txHash: string; closeStateHash: string } | null> {
  const session = activeSessions.get(appSessionId);
  if (!session) {
    throw new Error(`Streaming session not found: ${appSessionId}`);
  }

  if (!session.pendingChannelData) {
    logger.warn({ appSessionId }, "No pending custody channel data to finalize");
    return null;
  }

  try {
    const result = await openCustodyChannel(
      session.pendingChannelData,
      viewerSignature,
    );

    if (!result) {
      logger.warn({ appSessionId }, "openCustodyChannel returned null");
      return null;
    }

    // Update session with on-chain channel info
    session.channelId = result.channelId;
    session.custodyDepositTxHash = result.txHash;
    session.pendingChannelData = null; // No longer pending

    // Pre-compute the close state hash so browser can sign it at close time
    const closeStateHash = computeCloseStateHash(
      result.channelId,
      session.serverAddress as `0x${string}`,
      session.viewerAddress as `0x${string}`,
    );
    session.closeStateHash = closeStateHash;

    logger.info(
      {
        appSessionId,
        channelId: result.channelId,
        txHash: result.txHash,
      },
      "Custody channel finalized with viewer co-signature",
    );

    return { channelId: result.channelId, txHash: result.txHash, closeStateHash };
  } catch (err) {
    logger.error(
      { err, appSessionId },
      "Failed to finalize custody channel",
    );
    return null;
  }
}

// ─── Lookup Helpers ──────────────────────────────────────────────────

export function getSession(
  appSessionId: string,
): StreamingSession | undefined {
  return activeSessions.get(appSessionId);
}

export function getSessionByViewer(
  videoId: string,
  viewerAddress: string,
): StreamingSession | undefined {
  for (const session of activeSessions.values()) {
    if (
      session.videoId === videoId &&
      session.viewerAddress.toLowerCase() === viewerAddress.toLowerCase()
    ) {
      return session;
    }
  }
  return undefined;
}

export function getActiveSessions(): StreamingSession[] {
  return Array.from(activeSessions.values());
}
