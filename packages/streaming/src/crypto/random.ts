/**
 * Secure random number generation
 */

import { randomBytes } from "crypto";

/**
 * Generate cryptographically secure random bytes
 */
export function generateSecureRandom(length: number): Buffer {
  return randomBytes(length);
}

/**
 * Generate a random video ID (32 bytes / 256 bits)
 * @returns 64-character hex string
 */
export function generateVideoId(): string {
  return generateSecureRandom(32).toString("hex");
}
