/**
 * Crypto constants for streaming protocol
 */

/** Default segment duration in seconds */
export const DEFAULT_SEGMENT_DURATION = 5;

/** HKDF salt for key derivation */
export const HKDF_SALT = "streamlock-v1";

/** HKDF info prefix for segment keys */
export const HKDF_INFO_KEY = "segment-key";

/** HKDF info prefix for segment IVs */
export const HKDF_INFO_IV = "segment-iv";

/** AES key length in bytes (128 bits) */
export const AES_KEY_LENGTH = 16;

/** AES IV length in bytes (128 bits) */
export const AES_IV_LENGTH = 16;

/** Master secret length in bytes (256 bits) */
export const MASTER_SECRET_LENGTH = 32;
