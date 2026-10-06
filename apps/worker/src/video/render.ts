import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss, resolveTemplate, type CaptionSettings, type CaptionWord } from "../captions/ass.js";
import { runFfmpeg } from "./ffmpeg.js";

export const ASS_FILE_NAME = "captions.ass";

// Center crop to 9:16, scale to 1080x1920, then burn the captions.
// "captions.ass" is a relative name because FFmpeg runs inside the work folder
// (this avoids Windows drive-letter problems in filter paths).
const BASE_FILTER = `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920,setsar=1,ass=${ASS_FILE_NAME}`;

export interface RenderArgsOptions {
  sourcePath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
  logoPath?: string | null;
}

export function buildRenderArgs(options: RenderArgsOptions): string[] {
  const { sourcePath, outputPath, startSeconds, endSeconds, logoPath } = options;
  if (!(endSeconds > startSeconds)) {
    throw new Error("Clip end time must be greater than start time.");
  }
  const duration = (endSeconds - startSeconds).toFixed(3);
  const graph = logoPath
    ? `[0:v]${BASE_FILTER}[base];[1:v]scale=180:-1[logo];[base][logo]overlay=W-w-40:60[vout]`
    : `[0:v]${BASE_FILTER}[vout]`;

  const args = ["-y", "-ss", String(startSeconds), "-i", sourcePath];
  if (logoPath) args.push("-i", logoPath);
  args.push(
    "-t", duration,
    "-filter_complex", graph,
    "-map", "[vout]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  );
  return args;
}

export interface RenderOptions {
  sourcePath: string;
  outputPath: string;
  thumbnailPath: string;
  workDir: string;
  startSeconds: number;
  endSeconds: number;
  words: CaptionWord[];
  captionSettings?: CaptionSettings;
  brandName?: string | null;
  logoPath?: string | null;
}

export async function renderShort(options: RenderOptions): Promise<void> {
  const sourcePath = path.resolve(options.sourcePath);
  const outputPath = path.resolve(options.outputPath);
  const thumbnailPath = path.resolve(options.thumbnailPath);
  const workDir = path.resolve(options.workDir);
  const logoPath = options.logoPath ? path.resolve(options.logoPath) : null;
  const duration = options.endSeconds - options.startSeconds;

  await mkdir(workDir, { recursive: true });
  await mkdir(path.dirname(outputPath), { recursive: true });

  const ass = buildAss({
    words: options.words,
    template: resolveTemplate(options.captionSettings),
    durationSeconds: duration,
    brandName: options.brandName,
  });
  await writeFile(path.join(workDir, ASS_FILE_NAME), ass, "utf8");

  await runFfmpeg(
    buildRenderArgs({
      sourcePath,
      outputPath,
      startSeconds: options.startSeconds,
      endSeconds: options.endSeconds,
      logoPath,
    }),
    { cwd: workDir },
  );

  // Thumbnail from the finished Short
  await runFfmpeg([
    "-y",
    "-ss", String(Math.min(1, duration / 2)),
    "-i", outputPath,
    "-frames:v", "1",
    "-vf", "scale=540:-2",
    "-q:v", "3",
    thumbnailPath,
  ]);
}