/**
 * Video Generation Orchestrator
 *
 * Full pipeline: ideate -> generate video -> generate thumbnail ->
 * process through existing pipeline -> store in DB -> register on-chain
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../../db/client";
import { videos, videoGenerations } from "../../db/schema";
import { ideateVideo, type VideoIdea } from "./ideate";
import { generateVideo } from "../../integrations/ltx";
import { generateThumbnail } from "../../integrations/gemini";
import { processVideo } from "../../video/processor";
import { getStorageProvider } from "../../integrations/supabase";
import { encryptSecret } from "../../utils/encryption";
import { registerVideoOnChain } from "../../integrations/chain/video-registry";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";
import type { AgentCharacter } from "../configs/alice-character";
import type { AgentConfig } from "../types";

export type GenerationStatus =
  | "pending"
  | "ideating"
  | "generating_video"
  | "generating_thumbnail"
  | "processing"
  | "uploading"
  | "completed"
  | "failed";

export interface GenerationProgress {
  generationId: number;
  agentId: string;
  status: GenerationStatus;
  videoIdea: VideoIdea | null;
  videoId: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  costEstimate: number | null;
}

/**
 * Execute the full video generation pipeline for an agent.
 */
export async function executeVideoGeneration(
  character: AgentCharacter,
  agentConfig: AgentConfig
): Promise<GenerationProgress> {
  const progress: GenerationProgress = {
    generationId: 0,
    agentId: character.agentId,
    status: "pending",
    videoIdea: null,
    videoId: null,
    error: null,
    startedAt: new Date(),
    completedAt: null,
    costEstimate: null,
  };

  // Insert generation record
  const [genRecord] = await db
    .insert(videoGenerations)
    .values({
      agentId: character.agentId,
      status: "pending",
      startedAt: new Date(),
    })
    .returning({ id: videoGenerations.id });
  progress.generationId = genRecord.id;

  const updateStatus = async (
    status: GenerationStatus,
    extra: Record<string, unknown> = {}
  ) => {
    progress.status = status;
    await db
      .update(videoGenerations)
      .set({ status, ...extra, updatedAt: new Date() })
      .where(eq(videoGenerations.id, progress.generationId));
  };

  try {
    // Step 1: Ideate content
    await updateStatus("ideating");
    logger.info(
      { agentId: character.agentId },
      "Step 1/6: Ideating video content"
    );

    const recentVideos = await db
      .select({ title: videos.title })
      .from(videos)
      .where(eq(videos.agentId, character.agentId))
      .orderBy(desc(videos.createdAt))
      .limit(10);
    const recentTitles = recentVideos.map((v) => v.title);

    const idea = await ideateVideo(character, recentTitles);
    progress.videoIdea = idea;
    await updateStatus("generating_video", {
      title: idea.title,
      description: idea.description,
      videoPrompt: idea.videoPrompt,
      thumbnailPrompt: idea.thumbnailPrompt,
      duration: idea.duration,
    });

    // Step 2: Generate video via LTX-2
    logger.info(
      { agentId: character.agentId, title: idea.title },
      "Step 2/6: Generating video via LTX-2"
    );
    const costEstimate = idea.duration * 0.06;
    progress.costEstimate = costEstimate;

    const ltxResult = await generateVideo({
      prompt: idea.videoPrompt,
      duration: idea.duration,
    });

    await updateStatus("generating_thumbnail", {
      sizeBytes: ltxResult.sizeBytes,
    });

    // Step 3: Generate thumbnail (non-fatal if it fails)
    logger.info(
      { agentId: character.agentId },
      "Step 3/6: Generating thumbnail via Gemini"
    );
    let thumbnailUrl: string | null = null;
    try {
      const thumbnailResult = await generateThumbnail(
        idea.thumbnailPrompt,
        `gen-${progress.generationId}`
      );
      thumbnailUrl = thumbnailResult?.thumbnailUrl ?? null;
    } catch (thumbnailError) {
      logger.warn(
        {
          agentId: character.agentId,
          error: (thumbnailError as Error).message,
        },
        "Thumbnail generation failed (non-fatal)"
      );
    }

    // Step 4: Process through existing video pipeline
    await updateStatus("processing");
    logger.info(
      { agentId: character.agentId },
      "Step 4/6: Processing video through pipeline"
    );

    const storage = getStorageProvider();
    const keyServerBaseUrl =
      env.FRONTEND_URL || `http://localhost:${env.PORT}`;

    const processResult = await processVideo(ltxResult.videoBuffer, storage, {
      segmentDuration: env.VIDEO_SEGMENT_DURATION,
      quality: env.VIDEO_QUALITY as "480p" | "720p" | "1080p",
      keyServerBaseUrl,
    });
    progress.videoId = processResult.videoId;

    // Step 5: Store in database
    await updateStatus("uploading");
    logger.info(
      { agentId: character.agentId, videoId: processResult.videoId },
      "Step 5/6: Storing in database"
    );

    await db.insert(videos).values({
      id: processResult.videoId,
      agentId: character.agentId,
      title: idea.title,
      description: idea.description,
      status: "ready",
      durationSeconds: processResult.durationSeconds,
      totalSegments: processResult.totalSegments,
      quality: processResult.quality,
      masterSecret: encryptSecret(processResult.masterSecret),
      merkleRoot: processResult.merkleRoot,
      merkleTreeData: processResult.merkleTreeData,
      contentUri: processResult.contentUri,
      thumbnailUri: thumbnailUrl,
      creatorWallet: agentConfig.evmAddress,
      creatorTokenAddress: agentConfig.tokenAddress,
      creatorBondingCurveAddress: agentConfig.bondingCurveAddress,
      processedAt: new Date(),
    });

    // Step 6: Register on-chain (fire-and-forget)
    logger.info(
      { agentId: character.agentId, videoId: processResult.videoId },
      "Step 6/6: Registering on-chain"
    );
    const registryTxHash = await registerVideoOnChain(
      processResult.videoId,
      processResult.merkleRoot,
      agentConfig.evmAddress,
      processResult.totalSegments
    );

    if (registryTxHash) {
      await db
        .update(videos)
        .set({ registryTxHash, registryChainId: 84532 })
        .where(eq(videos.id, processResult.videoId));
    }

    // Mark generation as completed
    progress.completedAt = new Date();
    await updateStatus("completed", {
      videoId: processResult.videoId,
      completedAt: progress.completedAt,
      costEstimate: costEstimate.toFixed(2),
    });

    logger.info(
      {
        agentId: character.agentId,
        videoId: processResult.videoId,
        title: idea.title,
        durationMs: Date.now() - progress.startedAt.getTime(),
        costEstimate: `$${costEstimate.toFixed(2)}`,
      },
      "Video generation pipeline completed successfully"
    );

    return progress;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    progress.error = errorMessage;
    progress.status = "failed";

    await updateStatus("failed", {
      error: errorMessage,
      completedAt: new Date(),
    });

    logger.error(
      { agentId: character.agentId, error: errorMessage },
      "Video generation pipeline failed"
    );

    return progress;
  }
}
