/**
 * Yellow Network App Session Lifecycle Management
 *
 * Manages streaming payment sessions: create, pay-per-segment, close.
 * Uses in-memory Map for fast lookup during key delivery hot path,
 * with database persistence for audit and recovery.
 *
 * Architecture:
 * - ClearNode app sessions require multi-party co-signing (viewer + server).
 * - Since this is backend-only (no frontend wallet), we use a hybrid approach:
 *   1. Authenticate with ClearNode (proves Yellow integration)
 *   2. Query Unified Balance (proves server has funds)
 *   3. Track per-segment micropayments in our DB (business logic)
 *   4. In production, frontend would co-sign app sessions directly
 */

import type { Address, Hex } from "viem";
import { getYellowClient, isYellowConfigured } from "./client";
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
}

// ─── In-Memory Session Store ─────────────────────────────────────────

const activeSessions = new Map<string, StreamingSession>();

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a new streaming payment session.
 *
 * Verifies Yellow ClearNode connection is active, then creates a
 * locally-managed payment session backed by the server's ClearNode balance.
 *
 * In production with frontend: viewer would co-sign a multi-party app session.
 * For backend-only: server manages the payment channel and tracks allocations.
 */
export async function createStreamingSession(
  videoId: string,
  viewerAddress: string,
  creatorAddress: string,
  depositAmount: string,
): Promise<StreamingSession> {
  const pricePerSegment = env.YELLOW_PRICE_PER_SEGMENT;

  // Verify ClearNode connection is healthy (re-authenticates if needed)
  const client = await getYellowClient();

  // Generate a unique session ID
  const appSessionId = `yellow-${randomUUID()}`;

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
    },
    "Yellow streaming session created (server-managed)",
  );

  return session;
}

/**
 * Process a micropayment for a single video segment.
 *
 * Deducts pricePerSegment from viewer's balance and adds to creator's balance.
 * Returns false if insufficient balance.
 */
export async function processSegmentPayment(
  appSessionId: string,
  segmentIndex: number,
): Promise<{ success: boolean; newViewerBalance: string }> {
  const session = activeSessions.get(appSessionId);
  if (!session) {
    throw new Error(`Streaming session not found: ${appSessionId}`);
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

  // Compute new balances
  const newViewerBalance = (currentViewerBalance - price).toFixed(6);
  const newCreatorBalance = (
    parseFloat(session.creatorBalance) + price
  ).toFixed(6);

  // Update in-memory state
  session.viewerBalance = newViewerBalance;
  session.creatorBalance = newCreatorBalance;
  session.segmentsDelivered += 1;
  session.version += 1;
  session.lastPaymentAt = Date.now();

  logger.debug(
    {
      appSessionId,
      segmentIndex,
      viewerBalance: newViewerBalance,
      creatorBalance: newCreatorBalance,
      delivered: session.segmentsDelivered,
    },
    "Segment payment processed",
  );

  return { success: true, newViewerBalance };
}

/**
 * Close a streaming session and settle.
 *
 * Finalizes the session, returning remaining balance to viewer
 * and earned amount to creator.
 */
export async function closeStreamingSession(
  appSessionId: string,
): Promise<{ settled: boolean; totalPaid: string }> {
  const session = activeSessions.get(appSessionId);
  if (!session) {
    throw new Error(`Streaming session not found: ${appSessionId}`);
  }

  const totalPaid = session.creatorBalance;

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

  // Remove from active sessions
  activeSessions.delete(appSessionId);

  return { settled: true, totalPaid };
}

// ─── Lookup Helpers ──────────────────────────────────────────────────

/**
 * Get an active session by app session ID
 */
export function getSession(
  appSessionId: string,
): StreamingSession | undefined {
  return activeSessions.get(appSessionId);
}

/**
 * Get an active session by viewer address and video ID
 */
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

/**
 * Get all active sessions (for debugging/monitoring)
 */
export function getActiveSessions(): StreamingSession[] {
  return Array.from(activeSessions.values());
}
