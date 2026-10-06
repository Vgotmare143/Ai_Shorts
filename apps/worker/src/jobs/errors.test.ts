import assert from "node:assert/strict";
import { test } from "node:test";
import { StorageError } from "../storage/supabase.js";
import { TranscriptionError } from "../transcription/whisper.js";
import { FfmpegError } from "../video/ffmpeg.js";
import { DownloadError, toUserError, UserFacingError } from "./errors.js";

test("maps known failures to readable messages", () => {
  assert.equal(toUserError(new FfmpegError("x")).message, "Video rendering failed. Check FFmpeg installation.");
  assert.equal(
    toUserError(new TranscriptionError("x")).message,
    "Transcription failed. Check local Whisper installation.",
  );
  assert.equal(toUserError(new StorageError("x")).message, "Unable to upload generated video.");
  assert.equal(toUserError(new DownloadError("x")).code, "DOWNLOAD_FAILED");
  assert.equal(toUserError(new UserFacingError("NO_CLIPS", "None found")).code, "NO_CLIPS");
});

test("never exposes unknown errors to the user", () => {
  const result = toUserError(new Error("secret stack trace with C:\\path"));
  assert.equal(result.code, "INTERNAL");
  assert.equal(result.message, "Something went wrong. Please try again.");
  assert.ok(result.details.includes("secret stack trace"));
});