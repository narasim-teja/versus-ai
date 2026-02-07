/**
 * Encryption utilities for at-rest encryption of sensitive data (e.g., video master secrets).
 * Uses AES-256-GCM with random IVs.
 *
 * Encrypted format: base64(iv + authTag + ciphertext)
 *   - iv: 12 bytes (96 bits, GCM standard)
 *   - authTag: 16 bytes (128 bits)
 *   - ciphertext: variable length
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKeyBuffer(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "hex");
}

/**
 * Encrypt a plaintext hex string (e.g., master secret) for database storage.
 * Returns a base64 string containing iv + authTag + ciphertext.
 */
export function encryptSecret(plaintextHex: string): string {
  const key = getKeyBuffer();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const plaintext = Buffer.from(plaintextHex, "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt a base64-encoded encrypted secret back to a hex string.
 */
export function decryptSecret(encryptedBase64: string): string {
  const key = getKeyBuffer();
  const packed = Buffer.from(encryptedBase64, "base64");

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}
