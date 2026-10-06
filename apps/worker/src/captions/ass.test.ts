import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAss,
  CAPTION_TEMPLATES,
  escapeAss,
  extractClipWords,
  formatAssTime,
  groupIntoChunks,
} from "./ass.js";

const transcript = {
  text: "",
  duration: 20,
  segments: [
    {
      start: 10,
      end: 14,
      text: "Hello brave world.",
      words: [
        { start: 10, end: 11, word: " Hello" },
        { start: 11, end: 12.5, word: " brave" },
        { start: 12.5, end: 14, word: " world." },
      ],
    },
  ],
};

test("formats ASS times", () => {
  assert.equal(formatAssTime(0), "0:00:00.00");
  assert.equal(formatAssTime(65.5), "0:01:05.50");
  assert.equal(formatAssTime(3661.25), "1:01:01.25");
});

test("removes characters that would break ASS", () => {
  assert.equal(escapeAss("a{b}c\\d"), "abcd");
});

test("extracts words relative to the clip start", () => {
  const words = extractClipWords(transcript, 10, 14);
  assert.equal(words.length, 3);
  assert.equal(words[0].text, "Hello");
  assert.equal(words[0].start, 0);
  assert.equal(words[2].end, 4);
});

test("groups words into chunks of at most 4", () => {
  const words = Array.from({ length: 8 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, text: `w${i}` }));
  const chunks = groupIntoChunks(words);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 4);
});

test("builds an ASS file with captions, brand and progress bar", () => {
  const words = Array.from({ length: 4 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, text: `w${i}` }));
  const ass = buildAss({ words, template: CAPTION_TEMPLATES.Highlight, durationSeconds: 8, brandName: "My Brand" });
  assert.ok(ass.includes("PlayResX: 1080"));
  assert.ok(ass.includes("PlayResY: 1920"));
  assert.ok(ass.includes("Style: Caption,"));
  assert.ok(ass.includes("My Brand"));
  assert.equal(ass.split("Dialogue: 1,").length - 1, 4); // one line per highlighted word
});