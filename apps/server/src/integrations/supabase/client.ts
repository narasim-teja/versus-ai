/**
 * Supabase client for video storage
 */

import { SupabaseStorageProvider, type StorageProvider } from "../../video/storage";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

let storageProvider: StorageProvider | null = null;

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

/**
 * Get the Supabase storage provider (singleton)
 */
export function getStorageProvider(): StorageProvider {
  if (!storageProvider) {
    if (!isSupabaseConfigured()) {
      throw new Error(
        "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY."
      );
    }

    storageProvider = new SupabaseStorageProvider({
      supabaseUrl: env.SUPABASE_URL!,
      supabaseKey: env.SUPABASE_SERVICE_KEY!,
      bucketName: env.SUPABASE_STORAGE_BUCKET,
    });

    logger.info(
      { bucket: env.SUPABASE_STORAGE_BUCKET },
      "Supabase storage provider initialized"
    );
  }

  return storageProvider;
}
