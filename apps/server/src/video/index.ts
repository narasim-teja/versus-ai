/**
 * Video processing module
 */

export { segmentVideo, getVideoMetadata, type SegmenterOptions } from "./segmenter";
export { encryptVideoSegments, type EncryptionResult } from "./encryptor";
export {
  generateHLSPackage,
  type HLSPackage,
} from "./packager";
export {
  SupabaseStorageProvider,
  type StorageProvider,
  type SupabaseStorageConfig,
  type UploadFile,
} from "./storage";
export {
  processVideo,
  type ProcessVideoOptions,
  type ProcessVideoResult,
} from "./processor";
export { getSegmentKey, getSegmentKeyRaw } from "./key-handler";
