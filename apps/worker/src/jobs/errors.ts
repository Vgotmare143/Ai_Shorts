import { StorageError } from "../storage/supabase.js";
import { TranscriptionError } from "../transcription/whisper.js";
import { FfmpegError } from "../video/ffmpeg.js";

export class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "JobCancelledError";
  }
}

export class DownloadError extends Error {
  constructor(public readonly details: string) {
    super("Could not download the video. Check the link, and note that videos over 90 minutes are not supported.");
    this.name = "DownloadError";
  }
}

export class UserFacingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UserFacingError";
  }
}

export interface UserError {
  code: string;
  message: string; // safe to show to the user
  details: string; // technical, for the worker console only
}

export function toUserError(error: unknown): UserError {
  if (error instanceof DownloadError) {
    return { code: "DOWNLOAD_FAILED", message: error.message, details: error.details };
  }
  if (error instanceof TranscriptionError) {
    return { code: "TRANSCRIPTION_FAILED", message: error.message, details: error.details };
  }
  if (error instanceof FfmpegError) {
    return { code: "RENDER_FAILED", message: error.message, details: error.details };
  }
  if (error instanceof StorageError) {
    return { code: "UPLOAD_FAILED", message: error.message, details: error.details };
  }
  if (error instanceof UserFacingError) {
    return { code: error.code, message: error.message, details: error.message };
  }
  return {
    code: "INTERNAL",
    message: "Something went wrong. Please try again.",
    details: error instanceof Error ? (error.stack ?? error.message) : String(error),
  };
}