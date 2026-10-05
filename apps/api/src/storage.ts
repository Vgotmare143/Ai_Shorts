import { config } from "./config.js";
import { supabaseAdmin } from "./supabase.js";

export async function signPath(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(config.STORAGE_BUCKET)
    .createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

export async function deleteProjectFiles(userId: string, projectId: string): Promise<void> {
  const bucket = supabaseAdmin.storage.from(config.STORAGE_BUCKET);
  const base = `users/${userId}/projects/${projectId}`;
  for (const folder of ["clips", "thumbnails"]) {
    const { data } = await bucket.list(`${base}/${folder}`);
    if (data && data.length > 0) {
      await bucket.remove(data.map((file: { name: string }) => `${base}/${folder}/${file.name}`)); 
    }
  }
}