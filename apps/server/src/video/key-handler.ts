/**
 * Key release endpoint handler
 *
 * Derives decryption keys for video segments and generates Merkle proofs.
 */

import type { KeyResponse } from "@versus/streaming";
import {
  deriveSegmentKeyPair,
  generateMerkleProof,
  deserializeMerkleTree,
} from "@versus/streaming";

/**
 * Get a decryption key for a specific video segment
 *
 * @param masterSecretHex - Hex-encoded master secret from DB
 * @param merkleTreeJson - Serialized Merkle tree JSON from DB
 * @param videoId - Video identifier
 * @param segmentIndex - Segment index to get key for
 * @returns KeyResponse with key, iv, and Merkle proof, or null if invalid
 */
export function getSegmentKey(
  masterSecretHex: string,
  merkleTreeJson: string,
  videoId: string,
  segmentIndex: number
): KeyResponse | null {
  try {
    const masterSecret = Buffer.from(masterSecretHex, "hex");
    const tree = deserializeMerkleTree(merkleTreeJson);

    if (segmentIndex < 0 || segmentIndex >= tree.leaves.length) {
      return null;
    }

    const { key, iv } = deriveSegmentKeyPair(masterSecret, videoId, segmentIndex);
    const proof = generateMerkleProof(tree, segmentIndex);

    return {
      key: key.toString("base64"),
      iv: iv.toString("base64"),
      proof,
      segmentIndex,
    };
  } catch {
    return null;
  }
}

/**
 * Get a raw decryption key for HLS.js (returns 16-byte binary)
 *
 * HLS.js expects the key endpoint to return raw 16-byte AES key
 */
export function getSegmentKeyRaw(
  masterSecretHex: string,
  videoId: string,
  segmentIndex: number
): Buffer | null {
  try {
    const masterSecret = Buffer.from(masterSecretHex, "hex");
    const { key } = deriveSegmentKeyPair(masterSecret, videoId, segmentIndex);
    return key;
  } catch {
    return null;
  }
}
