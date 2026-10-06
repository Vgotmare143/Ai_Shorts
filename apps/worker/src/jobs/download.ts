import { existsSync } from "node:fs";
import path from "node:path";
import { runProcess } from "../process.js";
import { DownloadError } from "./errors.js";

const YOUTUBE_WATCH_URL = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

export function buildDownloadArgs(url: string, workDir: string): string[] {
  return [
    "--no-playlist",
    "--no-progress",
    "-f", "bv*[height<=720]+ba/b[height<=720]",
    "--merge-output-format", "mp4",
    "--remux-video", "mp4",
    "--max-filesize", "3G",
    "--match-filter", "duration<=5400", // 90 minutes
    "-o", path.join(workDir, "source.%(ext)s"),
    "--",
    url,
  ];
}

// Returns the path of the downloaded MP4 (workDir/source.mp4).
export async function downloadVideo(url: string, workDir: string): Promise<string> {
  // The API already normalizes URLs; this is a second safety check.
  if (!YOUTUBE_WATCH_URL.test(url)) {
    throw new DownloadError(`Rejected URL: ${url}`);
  }
  try {
    const result = await runProcess("yt-dlp", buildDownloadArgs(url, workDir));
    if (result.code !== 0) throw new DownloadError(result.stderr);
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(String(error));
  }
  const sourcePath = path.join(workDir, "source.mp4");
  if (!existsSync(sourcePath)) {
    throw new DownloadError("yt-dlp finished but produced no file (video may be filtered out).");
  }
  return sourcePath;
}