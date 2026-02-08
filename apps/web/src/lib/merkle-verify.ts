/**
 * Browser-native merkle proof verification.
 * Uses @noble/hashes (no Node.js Buffer dependency).
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export interface MerkleProof {
  leaf: string;
  proof: string[];
  root: string;
  index: number;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

/**
 * Verify that a segment key matches the merkle proof.
 * Returns true if the key hashes up to the expected root.
 */
export function verifySegmentProof(
  keyBytes: Uint8Array,
  proof: MerkleProof,
): boolean {
  let current = sha256(keyBytes);
  let index = proof.index;

  for (const siblingHex of proof.proof) {
    const sibling = hexToBytes(siblingHex);
    const isLeft = index % 2 === 0;

    current = isLeft
      ? sha256(concat(current, sibling))
      : sha256(concat(sibling, current));

    index = Math.floor(index / 2);
  }

  return bytesToHex(current) === proof.root;
}
