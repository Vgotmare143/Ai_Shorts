import { z } from "zod";

// Free tier limit per file. Finished Shorts must stay below this.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const idSchema = z.string().uuid();

export interface ClipIds {
  userId: string;
  projectId: string;
  clipId: string;
}

// Only UUIDs are allowed in paths, so a bad value can never escape the user's folder.
export function clipPaths(ids: ClipIds): { video: string; thumbnail: string } {
  const userId = idSchema.parse(ids.userId);
  const projectId = idSchema.parse(ids.projectId);
  const clipId = idSchema.parse(ids.clipId);
  const base = `users/${userId}/projects/${projectId}`;
  return {
    video: `${base}/clips/${clipId}.mp4`,
    thumbnail: `${base}/thumbnails/${clipId}.jpg`,
  };
}
