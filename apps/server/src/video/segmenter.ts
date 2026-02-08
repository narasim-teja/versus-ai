/**
 * Video segmentation using FFmpeg
 */

import ffmpeg from "fluent-ffmpeg";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import type { Segment } from "@versus/streaming";
import { VideoProcessingError } from "@versus/streaming";

/** Segmenter options */
export interface SegmenterOptions {
  segmentDuration: number;
  quality: "480p" | "720p" | "1080p";
  ffmpegPath?: string;
  timeout?: number;
}

/** Quality presets */
const QUALITY_PRESETS = {
  "480p": { width: 854, height: 480, bitrate: "1000k" },
  "720p": { width: 1280, height: 720, bitrate: "2500k" },
  "1080p": { width: 1920, height: 1080, bitrate: "5000k" },
} as const;

/**
 * Segment a video file into HLS-compatible segments
 */
export async function segmentVideo(
  input: File | Buffer | string,
  options: SegmenterOptions
): Promise<Segment[]> {
  const {
    segmentDuration,
    quality,
    ffmpegPath,
    timeout = 5 * 60 * 1000,
  } = options;
  const preset = QUALITY_PRESETS[quality];

  if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  }

  const tempDir = join(tmpdir(), `versus-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    let inputPath: string;

    if (typeof input === "string") {
      inputPath = input;
    } else if (Buffer.isBuffer(input)) {
      inputPath = join(tempDir, "input.mp4");
      await writeFile(inputPath, input);
    } else {
      inputPath = join(tempDir, "input.mp4");
      const arrayBuffer = await input.arrayBuffer();
      await writeFile(inputPath, Buffer.from(arrayBuffer));
    }

    const segmentPattern = join(tempDir, "segment_%03d.ts");

    const FFMPEG_TIMEOUT_MS = timeout;
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      const command = ffmpeg(inputPath)
        .outputOptions([
          `-c:v libx264`,
          `-preset fast`,
          `-b:v ${preset.bitrate}`,
          `-vf scale=${preset.width}:${preset.height}`,
          `-c:a aac`,
          `-b:a 128k`,
          `-force_key_frames expr:gte(t,n_forced*${segmentDuration})`,
          `-f segment`,
          `-segment_format mpegts`,
          `-segment_time ${segmentDuration}`,
          `-reset_timestamps 1`,
          `-map 0:v:0`,
          `-map 0:a:0?`,
          `-bsf:v h264_mp4toannexb`,
        ])
        .output(segmentPattern)
        .on("end", () => {
          if (!timedOut) resolve();
        })
        .on("error", (err) => {
          if (!timedOut) {
            reject(new VideoProcessingError(`FFmpeg error: ${err.message}`));
          }
        });

      const timer = setTimeout(() => {
        timedOut = true;
        command.kill("SIGKILL");
        reject(
          new VideoProcessingError(
            `FFmpeg processing timed out after ${FFMPEG_TIMEOUT_MS / 1000} seconds`
          )
        );
      }, FFMPEG_TIMEOUT_MS);

      command.on("end", () => clearTimeout(timer));
      command.on("error", () => clearTimeout(timer));
      command.run();
    });

    const files = await readdir(tempDir);
    const segmentFiles = files
      .filter((f) => f.startsWith("segment_") && f.endsWith(".ts"))
      .sort();

    const segments: Segment[] = [];

    for (let i = 0; i < segmentFiles.length; i++) {
      const filePath = join(tempDir, segmentFiles[i]);
      const data = await readFile(filePath);

      // Probe actual duration of each segment (last segment is often shorter)
      let duration = segmentDuration;
      try {
        const meta = await getVideoMetadata(filePath);
        if (meta.duration > 0) {
          duration = Math.round(meta.duration * 100) / 100;
        }
      } catch {
        // Fallback to configured segmentDuration
      }

      segments.push({
        index: i,
        duration,
        data: Buffer.from(data),
      });
    }

    return segments;
  } catch (error) {
    if (error instanceof VideoProcessingError) {
      throw error;
    }
    throw new VideoProcessingError(
      `Failed to segment video: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Get video metadata (duration, resolution, etc.)
 */
export function getVideoMetadata(
  inputPath: string
): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(new VideoProcessingError(`Failed to probe video: ${err.message}`));
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === "video");
      if (!videoStream) {
        reject(new VideoProcessingError("No video stream found"));
        return;
      }

      let fps = 30;
      if (videoStream.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split("/");
        if (parts.length === 2) {
          const numerator = parseFloat(parts[0]);
          const denominator = parseFloat(parts[1]);
          if (denominator !== 0) {
            fps = numerator / denominator;
          }
        } else {
          fps = parseFloat(videoStream.r_frame_rate) || 30;
        }
      }

      resolve({
        duration: metadata.format.duration ?? 0,
        width: videoStream.width ?? 0,
        height: videoStream.height ?? 0,
        fps,
      });
    });
  });
}
