import assert from "node:assert/strict";
import { test } from "node:test";
import { LlmOutputError, parseLlmClips, snapToSegments, validateClips } from "./validate.js";

const range = { min: 30, max: 60 };
const base = { title: "t", hook: "h", reason: "r", method: "llm" as const };

test("accepts a good clip", () => {
  const result = validateClips([{ ...base, start: 10, end: 50, score: 90 }], { videoDuration: 600, range });
  assert.equal(result.valid.length, 1);
});

test("rejects bad timestamps, durations and scores", () => {
  const clips = [
    { ...base, start: 50, end: 10, score: 80 },
    { ...base, start: 0, end: 700, score: 80 },
    { ...base, start: 0, end: 10, score: 80 },
    { ...base, start: 0, end: 40, score: 150 },
  ];
  const result = validateClips(clips, { videoDuration: 600, range });
  assert.equal(result.valid.length, 0);
  assert.equal(result.issues.length, 4);
});

test("removes duplicate clips and keeps the higher score", () => {
  const clips = [
    { ...base, start: 10, end: 50, score: 70 },
    { ...base, start: 12, end: 52, score: 95 },
  ];
  const result = validateClips(clips, { videoDuration: 600, range });
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].score, 95);
});

test("parses JSON wrapped in code fences", () => {
  const raw =
    '```json\n{"clips":[{"start":1,"end":40,"title":"x","hook":"h","score":80,"reason":"r"}]}\n```';
  assert.equal(parseLlmClips(raw).length, 1);
});

test("throws a readable error for invalid output", () => {
  assert.throws(() => parseLlmClips("not json at all"), LlmOutputError);
  assert.throws(() => parseLlmClips('{"clips":[{"start":"abc"}]}'), LlmOutputError);
});

test("snaps clip times to sentence boundaries", () => {
  const segments = [
    { start: 0, end: 4 },
    { start: 4, end: 9 },
    { start: 9, end: 15 },
  ];
  const snapped = snapToSegments({ start: 4.4, end: 8.7 }, segments);
  assert.equal(snapped.start, 4);
  assert.equal(snapped.end, 9);
});
