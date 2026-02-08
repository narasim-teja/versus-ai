/**
 * LTX-2 Video Generation API Client
 *
 * Calls the LTX-2 API to generate videos from text prompts.
 * The API returns binary MP4 data synchronously.
 *
 * Pricing: 1920x1080 at $0.06/sec (ltx-2-pro)
 */

import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

const LTX_API_URL = "https://api.ltx.video/v1/text-to-video";
const LTX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface LtxGenerateOptions {
  prompt: string;
  duration: number;
  resolution?: string;
  model?: string;
  generateAudio?: boolean;
}

export interface LtxGenerateResult {
  videoBuffer: Buffer;
  durationRequested: number;
  sizeBytes: number;
}

export function isLtxConfigured(): boolean {
  return Boolean(env.LTX_API_KEY);
}

/**
 * Generate a video from a text prompt via LTX-2 API.
 * Returns the raw MP4 buffer. The API is synchronous --
 * it blocks until generation is complete.
 */
export async function generateVideo(
  options: LtxGenerateOptions
): Promise<LtxGenerateResult> {
  if (!isLtxConfigured()) {
    throw new Error("LTX_API_KEY not configured");
  }

  const {
    prompt,
    resolution = "1920x1080",
    model = "ltx-2-pro",
    generateAudio = true,
  } = options;

  // ltx-2-pro only supports 6, 8, or 10 second durations
  const validDurations = [6, 8, 10] as const;
  const duration = validDurations.reduce((best, d) =>
    Math.abs(d - options.duration) < Math.abs(best - options.duration) ? d : best
  );

  logger.info(
    { prompt: prompt.substring(0, 100), duration, resolution, model },
    "Calling LTX-2 API for video generation"
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LTX_TIMEOUT_MS);

  try {
    const response = await fetch(LTX_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LTX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        model,
        duration,
        resolution,
        generate_audio: generateAudio,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `LTX-2 API error: HTTP ${response.status} - ${errorText || response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const videoBuffer = Buffer.from(arrayBuffer);

    logger.info(
      { sizeBytes: videoBuffer.length, duration },
      "LTX-2 video generated successfully"
    );

    return {
      videoBuffer,
      durationRequested: duration,
      sizeBytes: videoBuffer.length,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LTX-2 API timed out after ${LTX_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
