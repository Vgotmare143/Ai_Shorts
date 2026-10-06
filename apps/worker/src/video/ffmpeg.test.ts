import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAudioArgs, buildClipArgs } from "./ffmpeg.js";

test("builds a 9:16 clip command", () => {
  const args = buildClipArgs({ inputPath: "in.mp4", outputPath: "out.mp4", startSeconds: 31, endSeconds: 67 });
  assert.equal(args[args.indexOf("-ss") + 1], "31");
  assert.equal(args[args.indexOf("-t") + 1], "36");
  assert.ok(args[args.indexOf("-vf") + 1].includes("scale=1080:1920"));
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("aac"));
  assert.equal(args.at(-1), "out.mp4");
});

test("rejects a clip that ends before it starts", () => {
  assert.throws(() => buildClipArgs({ inputPath: "a", outputPath: "b", startSeconds: 10, endSeconds: 5 }));
});

test("builds a 16 kHz mono audio command", () => {
  const args = buildAudioArgs("in.mp4", "out.wav");
  assert.ok(args.includes("16000"));
  assert.equal(args.at(-1), "out.wav");
});