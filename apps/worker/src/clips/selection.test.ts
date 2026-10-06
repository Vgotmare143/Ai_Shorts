import assert from "node:assert/strict";
import { test } from "node:test";
import { AIUnavailableError, type AIProvider, type AIStatus } from "../ai/types.js";
import { AI_UNAVAILABLE_NOTICE, selectClips } from "./selection.js";

function buildTranscript() {
  const segments = Array.from({ length: 24 }, (_, i) => ({
    start: i * 5,
    end: i * 5 + 5,
    text: "We kept going on with the same ordinary point.",
    words: [],
  }));
  return { text: "", duration: 120, segments };
}

class FakeProvider implements AIProvider {
  readonly name = "fake";
  calls = 0;

  constructor(
    private readonly status: AIStatus,
    private readonly answers: (string | Error)[],
  ) {}

  async checkStatus(): Promise<AIStatus> {
    return this.status;
  }

  async generateJson(): Promise<string> {
    const next = this.answers[Math.min(this.calls, this.answers.length - 1)];
    this.calls += 1;
    if (next instanceof Error) throw next;
    return next;
  }
}

const goodAnswer = JSON.stringify({
  clips: [{ start: 30, end: 55, title: "Mistake", hook: "Here's the mistake", score: 92, reason: "Strong" }],
});

test("falls back to automatic selection when AI is not running", async () => {
  const result = await selectClips({
    transcript: buildTranscript(),
    clipCount: 3,
    durationRange: "15-30",
    provider: new FakeProvider("not_running", []),
  });
  assert.equal(result.method, "heuristic");
  assert.equal(result.notice, AI_UNAVAILABLE_NOTICE);
  assert.equal(result.clips.length, 3);
});

test("retries with a correction prompt after invalid JSON", async () => {
  const provider = new FakeProvider("ready", ["this is not json", goodAnswer]);
  const result = await selectClips({
    transcript: buildTranscript(),
    clipCount: 1,
    durationRange: "15-30",
    provider,
  });
  assert.equal(provider.calls, 2);
  assert.equal(result.method, "llm");
  assert.equal(result.clips[0].start, 30);
  assert.equal(result.notice, null);
});

test("falls back when the AI fails during analysis", async () => {
  const result = await selectClips({
    transcript: buildTranscript(),
    clipCount: 2,
    durationRange: "15-30",
    provider: new FakeProvider("ready", [new AIUnavailableError()]),
  });
  assert.equal(result.method, "heuristic");
  assert.equal(result.clips.length, 2);
});
