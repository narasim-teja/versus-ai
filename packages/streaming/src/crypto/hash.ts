/**
 * Hashing utilities
 */

import { sha256 } from "@noble/hashes/sha256";

/**
 * Hash data using SHA-256
 */
export function sha256Hash(data: Buffer | Uint8Array | string): Buffer {
  const input = typeof data === "string" ? Buffer.from(data) : data;
  return Buffer.from(sha256(input));
}

/**
 * Double SHA-256 hash
 */
export function doubleSha256(data: Buffer | Uint8Array | string): Buffer {
  return sha256Hash(sha256Hash(data));
}

/**
 * Hash multiple buffers concatenated
 */
export function hashConcat(...buffers: (Buffer | Uint8Array)[]): Buffer {
  return sha256Hash(Buffer.concat(buffers));
}

/**
 * Hash data and return as hex string
 */
export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return sha256Hash(data).toString("hex");
}
