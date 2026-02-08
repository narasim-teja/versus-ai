/**
 * Full video processing pipeline
 *
 * Orchestrates: segment -> derive keys -> build Merkle tree -> encrypt -> package -> upload
 */

import {
  generateMasterSecret,
  buildMerkleTree,
  getMerkleRoot,
  serializeMerkleTree,
  generateVideoId,
} from "@versus/streaming";
import { segmentVideo, type SegmenterOptions } from "./segmenter";
import { encryptVideoSegments } from "./encryptor";
import { generateHLSPackage } from "./packager";
import type { StorageProvider, UploadFile } from "./storage";
import { logger } from "../utils/logger";

/** Video processing options */
export interface ProcessVideoOptions {
  segmentDuration?: number;
  quality?: "480p" | "720p" | "1080p";
  keyServerBaseUrl: string;
}

/** Video processing result */
export interface ProcessVideoResult {
  videoId: string;
  totalSegments: number;
  durationSeconds: number;
  masterSecret: string;
  merkleRoot: string;
  merkleTreeData: string;
  contentUri: string;
  quality: string;
}

/**
 * Process a video through the full pipeline
 */
export async function processVideo(
  input: File | Buffer | string,
  storage: StorageProvider,
  options: ProcessVideoOptions
): Promise<ProcessVideoResult> {
  const {
    segmentDuration = 5,
    quality = "720p",
    keyServerBaseUrl,
  } = options;

  const videoId = generateVideoId();
  logger.info({ videoId, quality, segmentDuration }, "Starting video processing");

  // Step 1: Segment the video with FFmpeg
  logger.info({ videoId }, "Segmenting video with FFmpeg");
  const segmenterOpts: SegmenterOptions = {
    segmentDuration,
    quality,
  };
  const segments = await segmentVideo(input, segmenterOpts);
  logger.info(
    { videoId, totalSegments: segments.length },
    "Video segmented successfully"
  );

  // Step 2: Generate master secret and derive keys
  const masterSecret = generateMasterSecret();
  logger.info({ videoId }, "Master secret generated");

  // Step 3: Encrypt segments
  logger.info({ videoId }, "Encrypting segments");
  const { encryptedSegments, ivs, keys } = await encryptVideoSegments(
    segments,
    masterSecret,
    videoId
  );
  logger.info({ videoId }, "Segments encrypted");

  // Step 4: Build Merkle tree from keys
  const merkleTree = buildMerkleTree(keys);
  const merkleRoot = getMerkleRoot(merkleTree);
  const merkleTreeData = serializeMerkleTree(merkleTree);
  logger.info({ videoId, merkleRoot }, "Merkle tree built");

  // Step 5: Generate HLS package
  const hlsPackage = generateHLSPackage(
    encryptedSegments,
    ivs,
    videoId,
    keyServerBaseUrl,
    segmentDuration
  );
  logger.info({ videoId }, "HLS package generated");

  // Step 6: Upload everything to storage
  logger.info({ videoId }, "Uploading to storage");
  const filesToUpload: UploadFile[] = [];

  // Master playlist
  filesToUpload.push({
    path: `${videoId}/master.m3u8`,
    data: Buffer.from(hlsPackage.masterPlaylist),
    contentType: "application/vnd.apple.mpegurl",
  });

  // Media playlists
  for (const [qualityKey, playlist] of hlsPackage.mediaPlaylists) {
    filesToUpload.push({
      path: `${videoId}/${qualityKey}/playlist.m3u8`,
      data: Buffer.from(playlist),
      contentType: "application/vnd.apple.mpegurl",
    });
  }

  // Encrypted segments
  for (const [segPath, segData] of hlsPackage.segments) {
    filesToUpload.push({
      path: `${videoId}/${segPath}`,
      data: segData,
      contentType: "video/mp2t",
    });
  }

  const uploadedUrls = await storage.uploadBatch(filesToUpload);
  const contentUri = storage.getUrl(`${videoId}/master.m3u8`);
  logger.info(
    { videoId, filesUploaded: uploadedUrls.size, contentUri },
    "Upload complete"
  );

  const totalDuration = Math.round(
    segments.reduce((acc, s) => acc + s.duration, 0)
  );

  return {
    videoId,
    totalSegments: segments.length,
    durationSeconds: totalDuration,
    masterSecret: masterSecret.toString("hex"),
    merkleRoot,
    merkleTreeData,
    contentUri,
    quality,
  };
}
