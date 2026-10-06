import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDownloadArgs, downloadVideo } from "./download.js";
import { DownloadError } from "./errors.js";

test("builds safe yt-dlp arguments", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const args = buildDownloadArgs(url, "work/x");
  assert.ok(args.includes("--no-playlist"));
  assert.ok(args.includes("--remux-video"));
  assert.equal(args[args.length - 1], url);
  assert.equal(args[args.length - 2], "--");
});

test("rejects links that are not plain YouTube watch URLs", async () => {
  await assert.rejects(downloadVideo("https://evil.com/x", "work/x"), DownloadError);
  await assert.rejects(downloadVideo("--exec calc", "work/x"), DownloadError);
});