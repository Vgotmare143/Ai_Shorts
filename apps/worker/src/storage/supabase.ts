import { readFile, stat } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { clipPaths, MAX_UPLOAD_BYTES, type ClipIds } from "./paths.js";

export class StorageError extends Error {
  constructor(
    public readonly details: string,
    message = "Unable to upload generated video.",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

let cachedClient: SupabaseClient | null = null;

// Service-role client. Full access, so it lives only in the worker/API, never in the mobile app.
export function getAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new StorageError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env");
  }
  cachedClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

export async function uploadFile(localPath: string, storagePath: string, contentType: string): Promise<void> {
  try {
    const { size } = await stat(localPath);
    if (size > MAX_UPLOAD_BYTES) {
      throw new StorageError(`File is ${(size / 1048576).toFixed(1)} MB; the limit is 50 MB.`);
    }
    const body = await readFile(localPath);
    await withRetry(async () => {
      const { error } = await getAdminClient()
        .storage.from(config.STORAGE_BUCKET)
        .upload(storagePath, body, { contentType, upsert: true }); // upsert lets "Regenerate" overwrite
      if (error) throw new Error(error.message);
    });
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(error instanceof Error ? error.message : String(error));
  }
}

export interface UploadClipFilesOptions extends ClipIds {
  videoPath: string;
  thumbnailPath: string;
}

// Returns STORAGE PATHS (saved in clips.output_url and clips.thumbnail_url).
export async function uploadClipFiles(
  options: UploadClipFilesOptions,
): Promise<{ videoPath: string; thumbnailPath: string }> {
  const paths = clipPaths(options);
  await uploadFile(options.videoPath, paths.video, "video/mp4");
  await uploadFile(options.thumbnailPath, paths.thumbnail, "image/jpeg");
  return { videoPath: paths.video, thumbnailPath: paths.thumbnail };
}

export async function createSignedUrl(storagePath: string, seconds = 3600): Promise<string> {
  const { data, error } = await getAdminClient()
    .storage.from(config.STORAGE_BUCKET)
    .createSignedUrl(storagePath, seconds);
  if (error || !data) {
    throw new StorageError(error?.message ?? "No signed URL returned", "Unable to load the generated video.");
  }
  return data.signedUrl;
}

// Best effort: cleanup should never crash a job.
export async function removeFiles(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return;
  try {
    await getAdminClient().storage.from(config.STORAGE_BUCKET).remove(storagePaths);
  } catch {
    // ignore
  }
}
