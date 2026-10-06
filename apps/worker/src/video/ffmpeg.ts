import { runProcess, type ProcessOptions } from "../process.js";

import { runProcess } from "../process.js";

export interface ClipOptions {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  endSeconds: number;
}

// Center crop to 9:16, scale to 1080x1920, H.264 video + AAC audio.
const VERTICAL_FILTER = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920,setsar=1";

export function buildClipArgs(options: ClipOptions): string[] {
  const { inputPath, outputPath, startSeconds, endSeconds } = options;
  if (!(endSeconds > startSeconds)) {
    throw new Error("Clip end time must be greater than start time.");
  }
  const duration = endSeconds - startSeconds;
  return [
    "-y",
    "-ss", String(startSeconds),
    "-i", inputPath,
    "-t", String(duration),
    "-vf", VERTICAL_FILTER,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];
}

export function buildAudioArgs(inputPath: string, outputPath: string): string[] {
  return ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", outputPath];
}

export class FfmpegError extends Error {
  constructor(public readonly details: string) {
    super("Video rendering failed. Check FFmpeg installation.");
    this.name = "FfmpegError";
  }
}

export async function runFfmpeg(args: string[], options: ProcessOptions = {}): Promise<void> {
  try {
    const result = await runProcess("ffmpeg", args, options);
    if (result.code !== 0) throw new FfmpegError(result.stderr);
  } catch (error) {
    if (error instanceof FfmpegError) throw error;
    throw new FfmpegError(String(error));
  }
}