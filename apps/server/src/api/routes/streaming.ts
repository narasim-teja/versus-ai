/**
 * Streaming API Routes
 *
 * Handles HLS playlist serving, key delivery, and viewer sessions.
 * Supports Yellow Network state channel micropayments (Phase 4.5)
 * with fallback to legacy bearer token auth.
 */

import { Hono } from "hono";
import { db } from "../../db/client";
import { agents, videos, viewerSessions, yellowSessions } from "../../db/schema";
import { eq, and, gt } from "drizzle-orm";
import { getSegmentKey, getSegmentKeyRaw } from "../../video/key-handler";
import { randomUUID } from "crypto";
import { logger } from "../../utils/logger";
import { env } from "../../utils/env";
import {
  isYellowConfigured,
  createStreamingSession,
  processSegmentPayment,
  closeStreamingSession,
  getSession,
} from "../../integrations/yellow";

const streamingRoutes = new Hono();

/**
 * POST /api/videos/:videoId/session - Create a viewer session
 *
 * If Yellow is configured: creates a state channel payment session.
 * Otherwise: creates a legacy bearer token session (2hr expiry).
 */
streamingRoutes.post("/:videoId/session", async (c) => {
  const videoId = c.req.param("videoId");

  // Verify video exists and is ready
  const video = await db
    .select({
      id: videos.id,
      status: videos.status,
      agentId: videos.agentId,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (video.length === 0) {
    return c.json({ error: "Video not found" }, 404);
  }

  if (video[0].status !== "ready") {
    return c.json({ error: "Video is not ready for streaming" }, 400);
  }

  // Parse body
  let viewerAddress: string | undefined;
  let depositAmount: string | undefined;
  try {
    const body = await c.req.json();
    viewerAddress = body.viewerAddress;
    depositAmount = body.depositAmount;
  } catch {
    // No body is fine for legacy path
  }

  // ─── Yellow Payment Path ───
  if (isYellowConfigured()) {
    if (!viewerAddress) {
      return c.json(
        { error: "viewerAddress is required for payment sessions" },
        400,
      );
    }

    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      return c.json(
        { error: "depositAmount is required and must be > 0" },
        400,
      );
    }

    // Use agent's EVM address as creator, or a default
    const creatorAddress =
      video[0].agentId || "0x0000000000000000000000000000000000000000";

    try {
      // Look up creator's EVM address from agents table if agentId exists
      let creatorEvmAddress = creatorAddress;
      if (video[0].agentId) {
        const agent = await db
          .select({ evmAddress: agents.evmAddress })
          .from(agents)
          .where(eq(agents.id, video[0].agentId))
          .limit(1);
        if (agent.length > 0) {
          creatorEvmAddress = agent[0].evmAddress;
        }
      }

      const session = await createStreamingSession(
        videoId,
        viewerAddress,
        creatorEvmAddress,
        depositAmount,
      );

      // Persist to database
      await db.insert(yellowSessions).values({
        id: session.appSessionId,
        videoId,
        viewerAddress: session.viewerAddress,
        creatorAddress: session.creatorAddress,
        serverAddress: session.serverAddress,
        totalDeposited: session.totalDeposited,
        viewerBalance: session.viewerBalance,
        creatorBalance: session.creatorBalance,
        segmentsDelivered: 0,
        pricePerSegment: session.pricePerSegment,
        status: "active",
      });

      logger.info(
        { appSessionId: session.appSessionId, videoId, viewerAddress },
        "Yellow payment session created",
      );

      return c.json({
        appSessionId: session.appSessionId,
        videoId,
        pricePerSegment: session.pricePerSegment,
        viewerBalance: session.viewerBalance,
        totalDeposited: session.totalDeposited,
        asset: env.YELLOW_ASSET,
      });
    } catch (err) {
      logger.error({ err, videoId, viewerAddress }, "Failed to create Yellow session");
      return c.json(
        { error: "Failed to create payment session", details: String(err) },
        500,
      );
    }
  }

  // ─── Legacy Bearer Token Path ───
  const sessionId = randomUUID();
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

  await db.insert(viewerSessions).values({
    id: sessionId,
    videoId,
    viewerAddress: viewerAddress || null,
    expiresAt,
  });

  logger.info({ sessionId, videoId }, "Legacy viewer session created");

  return c.json({
    sessionId,
    videoId,
    expiresAt,
  });
});

/**
 * GET /api/videos/:videoId/key/:segment - Get decryption key for a segment
 *
 * Payment verification order:
 * 1. X-Yellow-Session header -> Yellow micropayment (deducts per segment)
 * 2. Authorization: Bearer <token> -> legacy session check
 * 3. Neither -> 402 Payment Required with instructions
 *
 * Returns raw 16-byte AES key for HLS.js compatibility.
 */
streamingRoutes.get("/:videoId/key/:segment", async (c) => {
  const videoId = c.req.param("videoId");
  const segmentIndex = parseInt(c.req.param("segment"), 10);

  if (isNaN(segmentIndex) || segmentIndex < 0) {
    return c.json({ error: "Invalid segment index" }, 400);
  }

  // ─── Yellow Payment Path ───
  const yellowSessionId = c.req.header("X-Yellow-Session");

  if (yellowSessionId) {
    const session = getSession(yellowSessionId);
    if (!session) {
      return c.json({ error: "Invalid or expired Yellow session" }, 401);
    }

    if (session.videoId !== videoId) {
      return c.json({ error: "Session does not match video" }, 403);
    }

    // Process micropayment
    try {
      const result = await processSegmentPayment(yellowSessionId, segmentIndex);

      if (!result.success) {
        return c.json(
          {
            error: "Insufficient balance",
            viewerBalance: result.newViewerBalance,
            pricePerSegment: session.pricePerSegment,
            message: "Top up your session or close it to reclaim remaining funds",
          },
          402,
        );
      }

      // Update database with new balances
      await db
        .update(yellowSessions)
        .set({
          viewerBalance: result.newViewerBalance,
          creatorBalance: session.creatorBalance,
          segmentsDelivered: session.segmentsDelivered,
        })
        .where(eq(yellowSessions.id, yellowSessionId));
    } catch (err) {
      logger.error(
        { err, yellowSessionId, segmentIndex },
        "Yellow payment processing failed",
      );
      return c.json({ error: "Payment processing failed" }, 500);
    }

    // Payment succeeded - deliver the key
    return await deliverSegmentKey(c, videoId, segmentIndex);
  }

  // ─── Legacy Bearer Token Path ───
  const authHeader = c.req.header("Authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const sessionToken = authHeader.slice(7);

    // Validate session
    const session = await db
      .select()
      .from(viewerSessions)
      .where(
        and(
          eq(viewerSessions.id, sessionToken),
          eq(viewerSessions.videoId, videoId),
          gt(viewerSessions.expiresAt, Date.now()),
        ),
      )
      .limit(1);

    if (session.length === 0) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }

    // Increment segments accessed
    await db
      .update(viewerSessions)
      .set({
        segmentsAccessed: (session[0].segmentsAccessed || 0) + 1,
      })
      .where(eq(viewerSessions.id, sessionToken));

    return await deliverSegmentKey(c, videoId, segmentIndex);
  }

  // ─── No Auth: Return 402 Payment Required ───
  return c.json(
    {
      error: "Payment required",
      instructions: {
        step1:
          "POST /api/videos/:videoId/session with { viewerAddress, depositAmount }",
        step2:
          "Include X-Yellow-Session header with the returned appSessionId",
        pricePerSegment: env.YELLOW_PRICE_PER_SEGMENT,
        asset: env.YELLOW_ASSET,
      },
    },
    402,
  );
});

/**
 * POST /api/videos/:videoId/session/:sessionId/close - Close a Yellow session
 *
 * Closes the app session on ClearNode, returns remaining balance to viewer,
 * and triggers settlement for creator earnings.
 */
streamingRoutes.post("/:videoId/session/:sessionId/close", async (c) => {
  const videoId = c.req.param("videoId");
  const sessionId = c.req.param("sessionId");

  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: "Session not found or already closed" }, 404);
  }

  if (session.videoId !== videoId) {
    return c.json({ error: "Session does not match video" }, 403);
  }

  try {
    const result = await closeStreamingSession(sessionId);

    // Update database
    await db
      .update(yellowSessions)
      .set({
        viewerBalance: session.viewerBalance,
        creatorBalance: session.creatorBalance,
        segmentsDelivered: session.segmentsDelivered,
        status: "closed",
        closedAt: Date.now(),
      })
      .where(eq(yellowSessions.id, sessionId));

    logger.info(
      { sessionId, videoId, totalPaid: result.totalPaid },
      "Yellow session closed",
    );

    return c.json({
      closed: true,
      totalPaid: result.totalPaid,
      settled: result.settled,
      segmentsDelivered: session.segmentsDelivered,
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Failed to close Yellow session");
    return c.json(
      { error: "Failed to close session", details: String(err) },
      500,
    );
  }
});

/**
 * GET /api/videos/:videoId/session/:sessionId/status - Check session status
 *
 * Returns current balances, segments delivered, and time watched.
 */
streamingRoutes.get("/:videoId/session/:sessionId/status", async (c) => {
  const videoId = c.req.param("videoId");
  const sessionId = c.req.param("sessionId");

  // Check in-memory first (active sessions)
  const activeSession = getSession(sessionId);
  if (activeSession && activeSession.videoId === videoId) {
    const segmentDuration = env.VIDEO_SEGMENT_DURATION || 5;
    return c.json({
      appSessionId: activeSession.appSessionId,
      videoId: activeSession.videoId,
      status: "active",
      viewerBalance: activeSession.viewerBalance,
      creatorBalance: activeSession.creatorBalance,
      totalDeposited: activeSession.totalDeposited,
      segmentsDelivered: activeSession.segmentsDelivered,
      secondsWatched: activeSession.segmentsDelivered * segmentDuration,
      pricePerSegment: activeSession.pricePerSegment,
      asset: env.YELLOW_ASSET,
    });
  }

  // Fallback to database (closed sessions)
  const dbSession = await db
    .select()
    .from(yellowSessions)
    .where(
      and(eq(yellowSessions.id, sessionId), eq(yellowSessions.videoId, videoId)),
    )
    .limit(1);

  if (dbSession.length === 0) {
    return c.json({ error: "Session not found" }, 404);
  }

  const s = dbSession[0];
  const segmentDuration = env.VIDEO_SEGMENT_DURATION || 5;

  return c.json({
    appSessionId: s.id,
    videoId: s.videoId,
    status: s.status,
    viewerBalance: s.viewerBalance,
    creatorBalance: s.creatorBalance,
    totalDeposited: s.totalDeposited,
    segmentsDelivered: s.segmentsDelivered || 0,
    secondsWatched: (s.segmentsDelivered || 0) * segmentDuration,
    pricePerSegment: s.pricePerSegment,
    closedAt: s.closedAt,
  });
});

/**
 * GET /api/videos/:videoId/key-json/:segment - Get decryption key with Merkle proof (JSON)
 *
 * Alternative endpoint that returns the full key response with Merkle proof.
 * Useful for custom players that verify proofs.
 */
streamingRoutes.get("/:videoId/key-json/:segment", async (c) => {
  const videoId = c.req.param("videoId");
  const segmentIndex = parseInt(c.req.param("segment"), 10);

  if (isNaN(segmentIndex) || segmentIndex < 0) {
    return c.json({ error: "Invalid segment index" }, 400);
  }

  // Check authorization (same dual-path logic)
  const yellowSessionId = c.req.header("X-Yellow-Session");

  if (yellowSessionId) {
    const session = getSession(yellowSessionId);
    if (!session || session.videoId !== videoId) {
      return c.json({ error: "Invalid Yellow session" }, 401);
    }

    const result = await processSegmentPayment(yellowSessionId, segmentIndex);
    if (!result.success) {
      return c.json(
        {
          error: "Insufficient balance",
          viewerBalance: result.newViewerBalance,
          pricePerSegment: session.pricePerSegment,
        },
        402,
      );
    }

    // Update database
    await db
      .update(yellowSessions)
      .set({
        viewerBalance: result.newViewerBalance,
        creatorBalance: session.creatorBalance,
        segmentsDelivered: session.segmentsDelivered,
      })
      .where(eq(yellowSessions.id, yellowSessionId));
  } else {
    // Legacy bearer auth
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          error: "Payment required",
          instructions: {
            step1:
              "POST /api/videos/:videoId/session with { viewerAddress, depositAmount }",
            step2:
              "Include X-Yellow-Session header with the returned appSessionId",
            pricePerSegment: env.YELLOW_PRICE_PER_SEGMENT,
            asset: env.YELLOW_ASSET,
          },
        },
        402,
      );
    }

    const sessionToken = authHeader.slice(7);
    const session = await db
      .select()
      .from(viewerSessions)
      .where(
        and(
          eq(viewerSessions.id, sessionToken),
          eq(viewerSessions.videoId, videoId),
          gt(viewerSessions.expiresAt, Date.now()),
        ),
      )
      .limit(1);

    if (session.length === 0) {
      return c.json({ error: "Invalid or expired session" }, 401);
    }
  }

  // Get video data
  const video = await db
    .select({
      masterSecret: videos.masterSecret,
      merkleTreeData: videos.merkleTreeData,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (
    video.length === 0 ||
    !video[0].masterSecret ||
    !video[0].merkleTreeData
  ) {
    return c.json({ error: "Video not found or not processed" }, 404);
  }

  const keyResponse = getSegmentKey(
    video[0].masterSecret,
    video[0].merkleTreeData,
    videoId,
    segmentIndex,
  );

  if (!keyResponse) {
    return c.json({ error: "Failed to derive key" }, 500);
  }

  return c.json(keyResponse);
});

// ─── Helper Functions ────────────────────────────────────────────────

/**
 * Deliver a raw 16-byte AES segment key.
 * Shared by both Yellow and legacy auth paths.
 */
async function deliverSegmentKey(c: any, videoId: string, segmentIndex: number) {
  const video = await db
    .select({
      masterSecret: videos.masterSecret,
      merkleTreeData: videos.merkleTreeData,
      totalSegments: videos.totalSegments,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (video.length === 0 || !video[0].masterSecret) {
    return c.json({ error: "Video not found or not processed" }, 404);
  }

  if (video[0].totalSegments && segmentIndex >= video[0].totalSegments) {
    return c.json({ error: "Segment index out of range" }, 400);
  }

  const key = getSegmentKeyRaw(video[0].masterSecret, videoId, segmentIndex);
  if (!key) {
    return c.json({ error: "Failed to derive key" }, 500);
  }

  return new Response(key, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": key.length.toString(),
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default streamingRoutes;
