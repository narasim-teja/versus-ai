/**
 * Streaming API Routes
 *
 * Handles HLS playlist serving, key delivery, and viewer sessions.
 */

import { Hono } from "hono";
import { db } from "../../db/client";
import { videos, viewerSessions } from "../../db/schema";
import { eq, and, gt } from "drizzle-orm";
import { getSegmentKey, getSegmentKeyRaw } from "../../video/key-handler";
import { randomUUID } from "crypto";
import { logger } from "../../utils/logger";

const streamingRoutes = new Hono();

/**
 * POST /api/videos/:videoId/session - Create a viewer session
 *
 * Returns a bearer token for accessing decryption keys.
 * In Phase 4.5, this will be replaced by Yellow Network state channels.
 */
streamingRoutes.post("/:videoId/session", async (c) => {
  const videoId = c.req.param("videoId");

  // Verify video exists and is ready
  const video = await db
    .select({ id: videos.id, status: videos.status })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (video.length === 0) {
    return c.json({ error: "Video not found" }, 404);
  }

  if (video[0].status !== "ready") {
    return c.json({ error: "Video is not ready for streaming" }, 400);
  }

  // Parse optional viewer address from body
  let viewerAddress: string | undefined;
  try {
    const body = await c.req.json();
    viewerAddress = body.viewerAddress;
  } catch {
    // No body is fine
  }

  // Create session with 2-hour expiry
  const sessionId = randomUUID();
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

  await db.insert(viewerSessions).values({
    id: sessionId,
    videoId,
    viewerAddress: viewerAddress || null,
    expiresAt,
  });

  logger.info({ sessionId, videoId }, "Viewer session created");

  return c.json({
    sessionId,
    videoId,
    expiresAt,
  });
});

/**
 * GET /api/videos/:videoId/key/:segment - Get decryption key for a segment
 *
 * Requires Authorization: Bearer <sessionToken> header.
 * Returns raw 16-byte AES key for HLS.js compatibility.
 *
 * In Phase 4.5, this returns 402 Payment Required with Yellow payment instructions
 * when no valid payment is found.
 */
streamingRoutes.get("/:videoId/key/:segment", async (c) => {
  const videoId = c.req.param("videoId");
  const segmentIndex = parseInt(c.req.param("segment"), 10);

  if (isNaN(segmentIndex) || segmentIndex < 0) {
    return c.json({ error: "Invalid segment index" }, 400);
  }

  // Check authorization
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Authorization required",
        message: "Provide a session token via Authorization: Bearer <token>",
      },
      401
    );
  }

  const sessionToken = authHeader.slice(7);

  // Validate session
  const session = await db
    .select()
    .from(viewerSessions)
    .where(
      and(
        eq(viewerSessions.id, sessionToken),
        eq(viewerSessions.videoId, videoId),
        gt(viewerSessions.expiresAt, Date.now())
      )
    )
    .limit(1);

  if (session.length === 0) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  // Get video's master secret
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

  // Return raw key for HLS.js
  const key = getSegmentKeyRaw(video[0].masterSecret, videoId, segmentIndex);
  if (!key) {
    return c.json({ error: "Failed to derive key" }, 500);
  }

  // Increment segments accessed
  await db
    .update(viewerSessions)
    .set({
      segmentsAccessed: (session[0].segmentsAccessed || 0) + 1,
    })
    .where(eq(viewerSessions.id, sessionToken));

  // Return raw 16-byte key as binary
  return new Response(key, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": key.length.toString(),
      "Access-Control-Allow-Origin": "*",
    },
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

  // Check authorization
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Authorization required" }, 401);
  }

  const sessionToken = authHeader.slice(7);

  // Validate session
  const session = await db
    .select()
    .from(viewerSessions)
    .where(
      and(
        eq(viewerSessions.id, sessionToken),
        eq(viewerSessions.videoId, videoId),
        gt(viewerSessions.expiresAt, Date.now())
      )
    )
    .limit(1);

  if (session.length === 0) {
    return c.json({ error: "Invalid or expired session" }, 401);
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
    segmentIndex
  );

  if (!keyResponse) {
    return c.json({ error: "Failed to derive key" }, 500);
  }

  return c.json(keyResponse);
});

export default streamingRoutes;
