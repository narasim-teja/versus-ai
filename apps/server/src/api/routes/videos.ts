/**
 * Video API Routes
 *
 * Handles video upload, listing, and management.
 */

import { Hono } from "hono";
import { db } from "../../db/client";
import { videos, agents } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { processVideo } from "../../video/processor";
import { getStorageProvider, isSupabaseConfigured } from "../../integrations/supabase";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

const videoRoutes = new Hono();

/**
 * GET /api/videos - List all videos
 */
videoRoutes.get("/", async (c) => {
  const allVideos = await db
    .select({
      id: videos.id,
      agentId: videos.agentId,
      title: videos.title,
      description: videos.description,
      status: videos.status,
      durationSeconds: videos.durationSeconds,
      totalSegments: videos.totalSegments,
      quality: videos.quality,
      contentUri: videos.contentUri,
      thumbnailUri: videos.thumbnailUri,
      createdAt: videos.createdAt,
      processedAt: videos.processedAt,
    })
    .from(videos)
    .orderBy(desc(videos.createdAt));

  return c.json({ videos: allVideos });
});

/**
 * GET /api/videos/:id - Get video details
 */
videoRoutes.get("/:id", async (c) => {
  const videoId = c.req.param("id");

  const video = await db
    .select({
      id: videos.id,
      agentId: videos.agentId,
      title: videos.title,
      description: videos.description,
      status: videos.status,
      durationSeconds: videos.durationSeconds,
      totalSegments: videos.totalSegments,
      quality: videos.quality,
      contentUri: videos.contentUri,
      merkleRoot: videos.merkleRoot,
      thumbnailUri: videos.thumbnailUri,
      createdAt: videos.createdAt,
      processedAt: videos.processedAt,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (video.length === 0) {
    return c.json({ error: "Video not found" }, 404);
  }

  return c.json({ video: video[0] });
});

/**
 * GET /api/videos/:id/status - Get processing status
 */
videoRoutes.get("/:id/status", async (c) => {
  const videoId = c.req.param("id");

  const video = await db
    .select({
      id: videos.id,
      status: videos.status,
      totalSegments: videos.totalSegments,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);

  if (video.length === 0) {
    return c.json({ error: "Video not found" }, 404);
  }

  return c.json(video[0]);
});

/**
 * POST /api/videos/upload - Upload and process a video
 *
 * Accepts multipart form data with:
 * - file: Video file
 * - title: Video title
 * - description: (optional) Video description
 * - agentId: (optional) Creator agent ID
 */
videoRoutes.post("/upload", async (c) => {
  if (!isSupabaseConfigured()) {
    return c.json(
      { error: "Supabase storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY." },
      503
    );
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const title = formData.get("title") as string;
    const description = (formData.get("description") as string) || undefined;
    const agentId = (formData.get("agentId") as string) || undefined;

    if (!file || !(file instanceof File)) {
      return c.json({ error: "No video file provided" }, 400);
    }

    if (!title) {
      return c.json({ error: "Title is required" }, 400);
    }

    logger.info(
      { fileName: file.name, fileSize: file.size, title, agentId },
      "Video upload received"
    );

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const videoBuffer = Buffer.from(arrayBuffer);

    // Determine key server base URL
    const keyServerBaseUrl =
      env.FRONTEND_URL || `http://localhost:${env.PORT}`;

    // Process the video through the full pipeline
    const storage = getStorageProvider();
    const result = await processVideo(videoBuffer, storage, {
      segmentDuration: env.VIDEO_SEGMENT_DURATION,
      quality: env.VIDEO_QUALITY as "480p" | "720p" | "1080p",
      keyServerBaseUrl,
    });

    // Store in database
    await db.insert(videos).values({
      id: result.videoId,
      agentId: agentId || null,
      title,
      description: description || null,
      status: "ready",
      durationSeconds: result.durationSeconds,
      totalSegments: result.totalSegments,
      quality: result.quality,
      masterSecret: result.masterSecret,
      merkleRoot: result.merkleRoot,
      merkleTreeData: result.merkleTreeData,
      contentUri: result.contentUri,
      processedAt: Date.now(),
    });

    logger.info(
      {
        videoId: result.videoId,
        totalSegments: result.totalSegments,
        duration: result.durationSeconds,
      },
      "Video processed and stored"
    );

    return c.json({
      video: {
        id: result.videoId,
        title,
        description,
        agentId,
        status: "ready",
        totalSegments: result.totalSegments,
        durationSeconds: result.durationSeconds,
        quality: result.quality,
        contentUri: result.contentUri,
        merkleRoot: result.merkleRoot,
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Video upload failed"
    );
    return c.json(
      {
        error: "Video processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * POST /api/videos/agent-upload - Agent auto-upload via URL
 *
 * Accepts JSON body:
 * - agentId: The creator agent ID (must exist in agents table)
 * - title: Video title
 * - description: (optional) Video description
 * - videoUrl: URL to fetch the video from
 *
 * Fetches the video, runs it through the full processing pipeline,
 * and stores it linked to the agent.
 */
videoRoutes.post("/agent-upload", async (c) => {
  if (!isSupabaseConfigured()) {
    return c.json(
      { error: "Supabase storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY." },
      503
    );
  }

  let body: {
    agentId: string;
    title: string;
    description?: string;
    videoUrl: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { agentId, title, description, videoUrl } = body;

  if (!agentId || !title || !videoUrl) {
    return c.json(
      { error: "Missing required fields: agentId, title, videoUrl" },
      400
    );
  }

  // Validate agent exists
  const agent = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (agent.length === 0) {
    return c.json({ error: `Agent not found: ${agentId}` }, 404);
  }

  try {
    logger.info(
      { agentId, title, videoUrl },
      "Agent auto-upload: fetching video"
    );

    // Fetch video from URL
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      return c.json(
        { error: `Failed to fetch video: ${videoResponse.status} ${videoResponse.statusText}` },
        400
      );
    }

    const arrayBuffer = await videoResponse.arrayBuffer();
    const videoBuffer = Buffer.from(arrayBuffer);

    logger.info(
      { agentId, title, size: videoBuffer.length },
      "Agent auto-upload: video fetched, processing"
    );

    // Process through existing pipeline
    const keyServerBaseUrl =
      env.FRONTEND_URL || `http://localhost:${env.PORT}`;

    const storage = getStorageProvider();
    const result = await processVideo(videoBuffer, storage, {
      segmentDuration: env.VIDEO_SEGMENT_DURATION,
      quality: env.VIDEO_QUALITY as "480p" | "720p" | "1080p",
      keyServerBaseUrl,
    });

    // Store in database linked to agent
    await db.insert(videos).values({
      id: result.videoId,
      agentId,
      title,
      description: description || null,
      status: "ready",
      durationSeconds: result.durationSeconds,
      totalSegments: result.totalSegments,
      quality: result.quality,
      masterSecret: result.masterSecret,
      merkleRoot: result.merkleRoot,
      merkleTreeData: result.merkleTreeData,
      contentUri: result.contentUri,
      processedAt: Date.now(),
    });

    logger.info(
      {
        videoId: result.videoId,
        agentId,
        totalSegments: result.totalSegments,
        duration: result.durationSeconds,
      },
      "Agent auto-upload: video processed and stored"
    );

    return c.json({
      video: {
        id: result.videoId,
        title,
        description,
        agentId,
        agentName: agent[0].name,
        status: "ready",
        totalSegments: result.totalSegments,
        durationSeconds: result.durationSeconds,
        quality: result.quality,
        contentUri: result.contentUri,
        merkleRoot: result.merkleRoot,
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "Unknown error", agentId, videoUrl },
      "Agent auto-upload failed"
    );
    return c.json(
      {
        error: "Video processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default videoRoutes;
