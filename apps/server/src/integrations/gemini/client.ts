/**
 * Gemini Image Generation Client
 *
 * Uses Gemini 2.5 Flash Image model to generate thumbnail images.
 * Uploads result to Supabase and returns the public URL.
 */

import { env } from "../../utils/env";
import { logger } from "../../utils/logger";
import { getStorageProvider, isSupabaseConfigured } from "../supabase";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-image-generation:generateContent";
const GEMINI_TIMEOUT_MS = 60_000; // 1 minute

export interface ThumbnailResult {
  thumbnailUrl: string;
  storagePath: string;
}

export function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

/**
 * Generate a thumbnail image using Gemini and upload to Supabase.
 *
 * @param prompt - Text description of desired thumbnail
 * @param videoId - Video ID for storage path naming
 * @returns URL of uploaded thumbnail, or null on failure
 */
export async function generateThumbnail(
  prompt: string,
  videoId: string
): Promise<ThumbnailResult | null> {
  if (!isGeminiConfigured()) {
    logger.warn("Gemini API key not configured, skipping thumbnail generation");
    return null;
  }

  if (!isSupabaseConfigured()) {
    logger.warn("Supabase not configured, cannot upload thumbnail");
    return null;
  }

  logger.info(
    { videoId, prompt: prompt.substring(0, 100) },
    "Generating thumbnail via Gemini"
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_API_URL}?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Generate a video thumbnail image: ${prompt}. The image should be landscape orientation, suitable as a YouTube-style video thumbnail. No text overlays.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["image", "text"],
          },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Gemini API error: HTTP ${response.status} - ${errorText}`
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
          }>;
        };
      }>;
    };

    // Extract image data from Gemini response
    const parts = data.candidates?.[0]?.content?.parts;
    const imagePart = parts?.find(
      (p: { inlineData?: { mimeType?: string } }) =>
        p.inlineData?.mimeType?.startsWith("image/")
    );

    if (!imagePart?.inlineData?.data) {
      throw new Error("Gemini response did not contain image data");
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");
    const mimeType: string =
      imagePart.inlineData.mimeType || "image/png";
    const extension = mimeType.includes("jpeg") ? "jpg" : "png";
    const storagePath = `thumbnails/${videoId}.${extension}`;

    // Upload to Supabase
    const storage = getStorageProvider();
    const thumbnailUrl = await storage.upload(
      storagePath,
      imageBuffer,
      mimeType
    );

    logger.info(
      { videoId, thumbnailUrl, sizeBytes: imageBuffer.length },
      "Thumbnail generated and uploaded"
    );

    return { thumbnailUrl, storagePath };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.error({ videoId }, "Gemini API timed out");
    } else {
      logger.error(
        {
          videoId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Thumbnail generation failed"
      );
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
