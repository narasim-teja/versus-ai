/**
 * Video segment encryption
 */

import type { Segment, EncryptedSegment } from "@versus/streaming";
import {
  encryptSegment,
  deriveSegmentIV,
  deriveAllSegmentKeys,
} from "@versus/streaming";

/** Encryption result */
export interface EncryptionResult {
  encryptedSegments: EncryptedSegment[];
  ivs: Buffer[];
  keys: Buffer[];
}

/**
 * Encrypt video segments using AES-128-CBC with master secret
 */
export async function encryptVideoSegments(
  segments: Segment[],
  masterSecret: Buffer,
  videoId: string
): Promise<EncryptionResult> {
  const keys = deriveAllSegmentKeys(masterSecret, videoId, segments.length);
  const encryptedSegments: EncryptedSegment[] = [];
  const ivs: Buffer[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const key = keys[i];
    const iv = deriveSegmentIV(masterSecret, videoId, i);

    const encryptedData = encryptSegment(segment.data, key, iv);

    encryptedSegments.push({
      index: i,
      data: encryptedData,
      iv,
    });

    ivs.push(iv);
  }

  return { encryptedSegments, ivs, keys };
}
