import assert from "node:assert/strict";
import { test } from "node:test";
import { rankHeuristic } from "./heuristic.js";
import { pickTop } from "./validate.js";

const FILLER = "We kept going on with the same ordinary point.";
const HOOK = "Here's the biggest mistake beginners make, and it will cost you.";

function buildTranscript() {
  const segments = Array.from({ length: 24 }, (_, i) => ({
    start: i * 5,
    end: i * 5 + 5,
    text: i === 6 ? HOOK : FILLER,
    words: [],
  }));
  return { text: "", duration: 120, segments };
}

test("ranks the segment with a strong hook first", () => {
  const ranked = rankHeuristic(buildTranscript(), { min: 15, max: 30 });
  assert.equal(ranked[0].start, 30);
  assert.equal(ranked[0].method, "heuristic");
});

test("picks non-overlapping clips inside the duration range", () => {
  const ranked = rankHeuristic(buildTranscript(), { min: 15, max: 30 });
  const picked = pickTop(ranked, 3);
  assert.equal(picked.length, 3);
  for (const clip of picked) {
    const duration = clip.end - clip.start;
    assert.ok(duration >= 15 && duration <= 30);
  }
});
