import { AIUnavailableError, type AIProvider } from "../ai/types.js";
import type { Transcript } from "../transcription/whisper.js";
import { buildCorrectionPrompt, buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import type { ClipCandidate, DurationRange } from "./types.js";
import { LlmOutputError, parseLlmClips, snapToSegments, validateClips, type RawClip } from "./validate.js";

type Segment = Transcript["segments"][number];

const MAX_ATTEMPTS = 3;
const WINDOW_SECONDS = 420;

export interface TranscriptWindow {
  start: number;
  end: number;
  segments: Segment[];
}

function toWindow(segments: Segment[]): TranscriptWindow {
  return { start: segments[0].start, end: segments[segments.length - 1].end, segments };
}

export function splitIntoWindows(segments: Segment[], windowSeconds = WINDOW_SECONDS): TranscriptWindow[] {
  const windows: TranscriptWindow[] = [];
  let current: Segment[] = [];
  for (const segment of segments) {
    if (current.length > 0 && segment.end - current[0].start > windowSeconds) {
      windows.push(toWindow(current));
      current = [];
    }
    current.push(segment);
  }
  if (current.length > 0) windows.push(toWindow(current));
  return windows;
}

function toCandidate(raw: RawClip): ClipCandidate {
  // Small models sometimes score from 0 to 1 instead of 0 to 100.
  const score = raw.score > 0 && raw.score <= 1 ? raw.score * 100 : raw.score;
  return {
    start: raw.start,
    end: raw.end,
    title: raw.title,
    hook: raw.hook,
    score: Math.round(score),
    reason: raw.reason,
    method: "llm",
  };
}

interface LlmOptions {
  range: DurationRange;
  clipCount: number;
  videoDuration: number;
  onLog?: (message: string) => void;
}

async function analyzeWindow(
  provider: AIProvider,
  window: TranscriptWindow,
  options: LlmOptions,
  maxClips: number,
): Promise<ClipCandidate[]> {
  const lines = window.segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text.trim()}`)
    .join("\n");
  const userPrompt = buildUserPrompt({
    lines,
    range: options.range,
    windowStart: window.start,
    windowEnd: window.end,
    maxClips,
  });

  let prompt = userPrompt;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = await provider.generateJson({ system: SYSTEM_PROMPT, prompt });
    let issues: string[];
    try {
      const parsed = parseLlmClips(raw);
      if (parsed.length === 0) return [];
      const candidates = parsed.map(toCandidate).map((clip) => snapToSegments(clip, window.segments));
      const result = validateClips(candidates, {
        videoDuration: options.videoDuration,
        range: options.range,
        windowStart: window.start,
        windowEnd: window.end,
      });
      if (result.valid.length > 0) return result.valid.slice(0, maxClips);
      issues = result.issues;
    } catch (error) {
      if (!(error instanceof LlmOutputError)) throw error;
      issues = [error.message];
    }
    options.onLog?.(`AI answer was invalid (attempt ${attempt} of ${MAX_ATTEMPTS}): ${issues[0]}`);
    prompt = buildCorrectionPrompt(userPrompt, raw, issues);
  }
  return [];
}

export async function selectWithLlm(
  provider: AIProvider,
  transcript: Transcript,
  options: LlmOptions,
): Promise<{ clips: ClipCandidate[]; aiFailed: boolean }> {
  const windows = splitIntoWindows(transcript.segments);
  const perWindow = Math.min(4, Math.max(2, Math.ceil(options.clipCount / Math.max(windows.length, 1)) + 1));
  const collected: ClipCandidate[] = [];
  let aiFailed = false;

  for (const [index, window] of windows.entries()) {
    options.onLog?.(`Analyzing part ${index + 1} of ${windows.length}...`);
    try {
      collected.push(...(await analyzeWindow(provider, window, options, perWindow)));
    } catch (error) {
      if (error instanceof AIUnavailableError) {
        aiFailed = true;
        break;
      }
      throw error;
    }
  }
  return { clips: collected, aiFailed };
}