/**
 * AES-128-CBC encryption/decryption for HLS compatibility
 */

import { createCipheriv, createDecipheriv } from "crypto";
import { EncryptionError, DecryptionError } from "../errors";

const ALGORITHM = "aes-128-cbc";

/**
 * Encrypt segment data using AES-128-CBC
 */
export function encryptSegment(
  data: Buffer,
  key: Buffer,
  iv: Buffer
): Buffer {
  if (key.length !== 16) {
    throw new EncryptionError(
      `Invalid key length: expected 16, got ${key.length}`
    );
  }
  if (iv.length !== 16) {
    throw new EncryptionError(
      `Invalid IV length: expected 16, got ${iv.length}`
    );
  }

  try {
    const cipher = createCipheriv(ALGORITHM, key, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
  } catch (error) {
    throw new EncryptionError(
      `Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Decrypt segment data using AES-128-CBC
 */
export function decryptSegment(
  encryptedData: Buffer,
  key: Buffer,
  iv: Buffer
): Buffer {
  if (key.length !== 16) {
    throw new DecryptionError(
      `Invalid key length: expected 16, got ${key.length}`
    );
  }
  if (iv.length !== 16) {
    throw new DecryptionError(
      `Invalid IV length: expected 16, got ${iv.length}`
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  } catch (error) {
    throw new DecryptionError(
      `Decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Encrypt multiple segments
 */
export function encryptSegments(
  segments: Buffer[],
  keys: Buffer[],
  ivs: Buffer[]
): Buffer[] {
  if (segments.length !== keys.length || segments.length !== ivs.length) {
    throw new EncryptionError(
      "Segments, keys, and IVs arrays must have same length"
    );
  }

  return segments.map((segment, i) => encryptSegment(segment, keys[i], ivs[i]));
}
