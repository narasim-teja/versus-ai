/**
 * Video Generation Scheduler
 *
 * Manages the periodic autonomous video generation for all agents.
 * Each agent generates a video every 4 hours, staggered by 2 hours.
 *
 * Schedule from server start time (T):
 *   Alice: T+0, T+4h, T+8h, ...
 *   Bob:   T+2h, T+6h, T+10h, ...
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { videoGenerations } from "../../db/schema";
import { logger } from "../../utils/logger";
import { env } from "../../utils/env";
import { isLtxConfigured } from "../../integrations/ltx";
import { isOpenRouterConfigured } from "../../integrations/openrouter/client";
import { isSupabaseConfigured } from "../../integrations/supabase";
import {
  executeVideoGeneration,
  type GenerationProgress,
  type GenerationStatus,
} from "./generate";
import { aliceCharacter } from "../configs/alice-character";
import { bobCharacter } from "../configs/bob-character";
import type { AgentCharacter } from "../configs/alice-character";
import type { AgentConfig } from "../types";

/** In-memory scheduler state for each agent */
interface SchedulerEntry {
  agentId: string;
  character: AgentCharacter;
  agentConfig: AgentConfig;
  intervalId: ReturnType<typeof setInterval> | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
  nextGenerationAt: Date;
  lastGeneration: GenerationProgress | null;
  currentGeneration: GenerationProgress | null;
  isGenerating: boolean;
  generationCount: number;
}

/** Public schedule status for API */
export interface ScheduleStatus {
  agentId: string;
  nextGenerationAt: string;
  msUntilNext: number;
  lastGenerationStatus: GenerationStatus | null;
  lastGenerationVideoId: string | null;
  lastGenerationTitle: string | null;
  lastGenerationAt: string | null;
  currentGenerationStatus: GenerationStatus | null;
  isGenerating: boolean;
  generationCount: number;
  isEnabled: boolean;
}

const schedulerEntries = new Map<string, SchedulerEntry>();

/**
 * Check if all required services are configured for video generation
 */
export function isVideoGenerationConfigured(): boolean {
  return isOpenRouterConfigured() && isLtxConfigured() && isSupabaseConfigured();
}

/**
 * Query the DB for the most recent generation for an agent.
 * Returns ms since that generation started, or null if no prior generation exists.
 */
async function getMsSinceLastGeneration(agentId: string): Promise<number | null> {
  const [lastGen] = await db
    .select({ startedAt: videoGenerations.startedAt })
    .from(videoGenerations)
    .where(eq(videoGenerations.agentId, agentId))
    .orderBy(desc(videoGenerations.startedAt))
    .limit(1);

  if (!lastGen) return null;
  return Date.now() - lastGen.startedAt.getTime();
}

/**
 * Start the video generation scheduler for all agents.
 * Checks DB for recent generations to avoid re-triggering on restart.
 */
export async function startVideoScheduler(agentConfigs: AgentConfig[]): Promise<void> {
  if (!isVideoGenerationConfigured()) {
    logger.warn(
      "Video generation not fully configured (need OPENROUTER_API_KEY + LTX_API_KEY + Supabase). Scheduler disabled."
    );
    return;
  }

  const intervalMs = env.VIDEO_GEN_INTERVAL_MS;
  const offsetMs = env.VIDEO_GEN_OFFSET_MS;

  logger.info(
    {
      intervalHours: intervalMs / (60 * 60 * 1000),
      offsetHours: offsetMs / (60 * 60 * 1000),
    },
    "Starting video generation scheduler"
  );

  const characters: Record<string, AgentCharacter> = {
    alice: aliceCharacter,
    bob: bobCharacter,
  };

  const agentOrder = ["alice", "bob"];

  for (let i = 0; i < agentOrder.length; i++) {
    const agentId = agentOrder[i];
    const config = agentConfigs.find((c) => c.id === agentId);
    const character = characters[agentId];

    if (!config || !character) {
      logger.warn(
        { agentId },
        "Agent config or character not found, skipping scheduler"
      );
      continue;
    }

    // Check DB for the last generation to avoid re-triggering on restart
    const msSinceLast = await getMsSinceLastGeneration(agentId);
    const defaultOffsetMs = i * offsetMs;
    let firstDelayMs: number;

    if (msSinceLast !== null && msSinceLast < intervalMs) {
      // Recent generation exists — wait for the remaining interval time
      firstDelayMs = intervalMs - msSinceLast;
      logger.info(
        {
          agentId,
          msSinceLast,
          waitingMs: firstDelayMs,
          waitingMinutes: Math.round(firstDelayMs / 60000),
        },
        "Recent generation found in DB, delaying first generation to respect interval"
      );
    } else {
      // No recent generation — use the default stagger offset
      firstDelayMs = defaultOffsetMs;
    }

    const nextGenerationAt = new Date(Date.now() + firstDelayMs);

    const entry: SchedulerEntry = {
      agentId,
      character,
      agentConfig: config,
      intervalId: null,
      timeoutId: null,
      nextGenerationAt,
      lastGeneration: null,
      currentGeneration: null,
      isGenerating: false,
      generationCount: 0,
    };

    schedulerEntries.set(agentId, entry);

    // Schedule first generation after computed delay, then every interval
    entry.timeoutId = setTimeout(() => {
      triggerGeneration(entry);

      entry.intervalId = setInterval(() => {
        triggerGeneration(entry);
      }, intervalMs);
    }, firstDelayMs);

    logger.info(
      {
        agentId,
        firstGenerationAt: nextGenerationAt.toISOString(),
        delayMinutes: Math.round(firstDelayMs / 60000),
        intervalHours: intervalMs / (60 * 60 * 1000),
        hadRecentGeneration: msSinceLast !== null && msSinceLast < intervalMs,
      },
      "Agent video scheduler registered"
    );
  }
}

/**
 * Trigger a video generation for an agent (guard against overlapping runs)
 */
async function triggerGeneration(entry: SchedulerEntry): Promise<void> {
  const intervalMs = env.VIDEO_GEN_INTERVAL_MS;

  if (entry.isGenerating) {
    logger.warn(
      { agentId: entry.agentId },
      "Skipping video generation -- previous generation still in progress"
    );
    entry.nextGenerationAt = new Date(Date.now() + intervalMs);
    return;
  }

  entry.isGenerating = true;
  entry.nextGenerationAt = new Date(Date.now() + intervalMs);

  try {
    logger.info(
      { agentId: entry.agentId, generationNumber: entry.generationCount + 1 },
      "Triggering autonomous video generation"
    );

    const progress = await executeVideoGeneration(
      entry.character,
      entry.agentConfig
    );
    entry.currentGeneration = null;
    entry.lastGeneration = progress;
    entry.generationCount++;

    if (progress.status === "failed") {
      logger.error(
        { agentId: entry.agentId, error: progress.error },
        "Video generation failed -- will retry at next scheduled interval"
      );
    }
  } catch (error) {
    logger.error(
      {
        agentId: entry.agentId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Unexpected error during video generation trigger"
    );
  } finally {
    entry.isGenerating = false;
  }
}

/**
 * Get schedule status for an agent (used by API endpoint)
 */
export function getScheduleStatus(agentId: string): ScheduleStatus {
  const entry = schedulerEntries.get(agentId);
  if (!entry) {
    return {
      agentId,
      nextGenerationAt: "",
      msUntilNext: 0,
      lastGenerationStatus: null,
      lastGenerationVideoId: null,
      lastGenerationTitle: null,
      lastGenerationAt: null,
      currentGenerationStatus: null,
      isGenerating: false,
      generationCount: 0,
      isEnabled: false,
    };
  }

  const msUntilNext = Math.max(
    0,
    entry.nextGenerationAt.getTime() - Date.now()
  );

  return {
    agentId: entry.agentId,
    nextGenerationAt: entry.nextGenerationAt.toISOString(),
    msUntilNext,
    lastGenerationStatus: entry.lastGeneration?.status ?? null,
    lastGenerationVideoId: entry.lastGeneration?.videoId ?? null,
    lastGenerationTitle: entry.lastGeneration?.videoIdea?.title ?? null,
    lastGenerationAt:
      entry.lastGeneration?.completedAt?.toISOString() ?? null,
    currentGenerationStatus: entry.isGenerating
      ? (entry.currentGeneration?.status ?? "generating_video")
      : null,
    isGenerating: entry.isGenerating,
    generationCount: entry.generationCount,
    isEnabled: true,
  };
}

/**
 * Get all schedule statuses
 */
export function getAllScheduleStatuses(): ScheduleStatus[] {
  return ["alice", "bob"].map((id) => getScheduleStatus(id));
}

/**
 * Stop the video generation scheduler for all agents
 */
export function stopVideoScheduler(): void {
  logger.info(
    { count: schedulerEntries.size },
    "Stopping video generation scheduler"
  );

  for (const [agentId, entry] of schedulerEntries) {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    if (entry.intervalId) clearInterval(entry.intervalId);
    logger.info({ agentId }, "Agent video scheduler stopped");
  }

  schedulerEntries.clear();
}

/**
 * Force trigger a video generation for an agent (for testing/manual use)
 */
export async function forceVideoGeneration(
  agentId: string
): Promise<GenerationProgress | null> {
  const entry = schedulerEntries.get(agentId);
  if (!entry) {
    logger.warn(
      { agentId },
      "Agent not found in scheduler for force generation"
    );
    return null;
  }

  if (entry.isGenerating) {
    logger.warn({ agentId }, "Cannot force generation -- already generating");
    return null;
  }

  await triggerGeneration(entry);
  return entry.lastGeneration;
}
