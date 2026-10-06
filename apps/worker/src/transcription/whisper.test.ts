import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTranscript } from "./whisper.js";

test("parses a valid transcript", () => {
  const transcript = parseTranscript({
    text: "Hello world",
    language: "en",
    duration: 4.2,
    segments: [{ start: 0, end: 4.2, text: "Hello world", words: [{ start: 0, end: 1, word: "Hello" }] }],
  });
  assert.equal(transcript.segments.length, 1);
});

test("rejects a segment that ends before it starts", () => {
  assert.throws(() =>
    parseTranscript({ text: "x", duration: 5, segments: [{ start: 4, end: 2, text: "x" }] }),
  );
});