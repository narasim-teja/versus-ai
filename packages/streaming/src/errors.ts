/**
 * Error classes for streaming protocol
 */

/** Base error class */
export class StreamingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "StreamingError";
  }
}

/** Encryption error */
export class EncryptionError extends StreamingError {
  constructor(message: string) {
    super(message, "ENCRYPTION_ERROR");
    this.name = "EncryptionError";
  }
}

/** Decryption error */
export class DecryptionError extends StreamingError {
  constructor(message: string) {
    super(message, "DECRYPTION_ERROR");
    this.name = "DecryptionError";
  }
}

/** Video processing error */
export class VideoProcessingError extends StreamingError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VIDEO_PROCESSING_ERROR", details);
    this.name = "VideoProcessingError";
  }
}

/** Invalid Merkle proof */
export class InvalidProofError extends StreamingError {
  constructor(segmentIndex: number) {
    super(
      `Invalid Merkle proof for segment ${segmentIndex}`,
      "INVALID_PROOF",
      { segmentIndex }
    );
    this.name = "InvalidProofError";
  }
}

/** Video not found */
export class VideoNotFoundError extends StreamingError {
  constructor(videoId: string) {
    super(`Video not found: ${videoId}`, "VIDEO_NOT_FOUND", { videoId });
    this.name = "VideoNotFoundError";
  }
}
