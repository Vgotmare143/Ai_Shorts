import { z } from "zod";
import type { ClipCandidate, DurationRange } from "./types.js";

export const DURATION_TOLERANCE_SECONDS = 2;

const rawClipSchema = z.object({
  start: z.coerce.number(),
  end: z.coerce.number(),
  title: z.string().min(1).max(200),
  hook: z.string().max(400).default(""),
  score: z.coerce.number(),
  reason: z.string().max(600).default(""),
});

const llmResponseSchema = z.object({ clips: z.array(rawClipSchema) });

export type RawClip = z.infer<typeof rawClipSchema>;

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

// Never trust raw LLM output: extract the JSON, then validate its shape with Zod.
export function parseLlmClips(raw: string): RawClip[] {
  const text = raw.trim();
  const open = text.search(/[\[{]/);
  const close = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (open === -1 || close <= open) throw new LlmOutputError("The answer is not JSON.");

  let data: unknown;
  try {
    data = JSON.parse(text.slice(open, close + 1));
  } catch {
    throw new LlmOutputError("The answer is not valid JSON.");
  }
  if (Array.isArray(data)) data = { clips: data };

  const result = llmResponseSchema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ");
    throw new LlmOutputError(`The JSON has the wrong shape: ${problems}`);
  }
  return result.data.clips;
}

export interface ValidationContext {
  videoDuration: number;
  range: DurationRange;
  windowStart?: number;
  windowEnd?: number;
}

export function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? overlap / shorter : 0;
}

// Keeps the highest-scoring clips and drops any that overlap an already kept clip.
export function removeOverlaps<T extends { start: number; end: number; score: number }>(
  clips: T[],
  maxRatio = 0.5,
): { kept: T[]; dropped: number } {
  const sorted = [...clips].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const clip of sorted) {
    if (!kept.some((other) => overlapRatio(clip, other) > maxRatio)) kept.push(clip);
  }
  return { kept, dropped: clips.length - kept.length };
}

export function pickTop<T extends { start: number; end: number; score: number }>(clips: T[], count: number): T[] {
  return removeOverlaps(clips, 0.05).kept.slice(0, count);
}

export function validateClips(
  clips: ClipCandidate[],
  context: ValidationContext,
): { valid: ClipCandidate[]; issues: string[] } {
  const issues: string[] = [];
  const passed: ClipCandidate[] = [];
  const minDuration = context.range.min - DURATION_TOLERANCE_SECONDS;
  const maxDuration = context.range.max + DURATION_TOLERANCE_SECONDS;

  clips.forEach((clip, index) => {
    const label = `Clip ${index + 1}`;
    const duration = clip.end - clip.start;

    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0) {
      issues.push(`${label}: start must be 0 or more`);
    } else if (clip.start >= clip.end) {
      issues.push(`${label}: start must be less than end`);
    } else if (clip.end > context.videoDuration + 0.5) {
      issues.push(`${label}: end ${clip.end} is after the video ends (${context.videoDuration}s)`);
    } else if (duration < minDuration || duration > maxDuration) {
      issues.push(
        `${label}: duration ${duration.toFixed(1)}s must be between ${context.range.min} and ${context.range.max} seconds`,
      );
    } else if (!(clip.score >= 0 && clip.score <= 100)) {
      issues.push(`${label}: score must be between 0 and 100`);
    } else if (
      context.windowStart !== undefined &&
      context.windowEnd !== undefined &&
      (clip.start < context.windowStart - 1 || clip.end > context.windowEnd + 1)
    ) {
      issues.push(`${label}: times must stay between ${context.windowStart} and ${context.windowEnd}`);
    } else {
      passed.push(clip);
    }
  });

  const { kept, dropped } = removeOverlaps(passed);
  if (dropped > 0) issues.push(`${dropped} duplicate or overlapping clip(s) removed`);
  return { valid: kept, issues };
}

function nearest(values: number[], target: number): number {
  return values.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best));
}

// Moves a clip's start and end to real sentence boundaries from the transcript.
export function snapToSegments<T extends { start: number; end: number }>(
  clip: T,
  segments: { start: number; end: number }[],
): T {
  if (segments.length === 0) return clip;
  const start = nearest(segments.map((segment) => segment.start), clip.start);
  const end = nearest(segments.map((segment) => segment.end), clip.end);
  return end > start ? { ...clip, start, end } : clip;
}