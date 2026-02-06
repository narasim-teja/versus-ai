/**
 * Storage provider interface and Supabase implementation
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** File to upload */
export interface UploadFile {
  path: string;
  data: Buffer;
  contentType: string;
}

/** Storage provider interface */
export interface StorageProvider {
  upload(path: string, data: Buffer, contentType: string): Promise<string>;
  uploadBatch(files: UploadFile[]): Promise<Map<string, string>>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getUrl(path: string): string;
}

/** Supabase storage configuration */
export interface SupabaseStorageConfig {
  supabaseUrl: string;
  supabaseKey: string;
  bucketName: string;
}

/**
 * Supabase storage provider for video segments
 */
export class SupabaseStorageProvider implements StorageProvider {
  private client: SupabaseClient;
  private bucketName: string;
  private supabaseUrl: string;

  constructor(config: SupabaseStorageConfig) {
    this.client = createClient(config.supabaseUrl, config.supabaseKey);
    this.bucketName = config.bucketName;
    this.supabaseUrl = config.supabaseUrl;
  }

  async upload(
    path: string,
    data: Buffer,
    contentType: string
  ): Promise<string> {
    const { error } = await this.client.storage
      .from(this.bucketName)
      .upload(path, data, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload ${path}: ${error.message}`);
    }

    return this.getUrl(path);
  }

  async uploadBatch(files: UploadFile[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    const BATCH_SIZE = 10;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (file) => {
          const url = await this.upload(file.path, file.data, file.contentType);
          results.set(file.path, url);
        })
      );
    }

    return results;
  }

  async delete(path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucketName)
      .remove([path]);

    if (error) {
      throw new Error(`Failed to delete ${path}: ${error.message}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .list(path.split("/").slice(0, -1).join("/"), {
        search: path.split("/").pop(),
      });

    if (error) {
      return false;
    }

    const fileName = path.split("/").pop();
    return data.some((file) => file.name === fileName);
  }

  getUrl(path: string): string {
    return `${this.supabaseUrl}/storage/v1/object/public/${this.bucketName}/${path}`;
  }
}
