import type { DurationRange } from "./types.js";

export const SYSTEM_PROMPT = `You are an expert short-form video editor. You find the strongest moments in a video transcript for YouTube Shorts, TikTok and Reels.

Judge each moment on:
- a strong hook in the first seconds
- useful information or educational value
- surprising statements
- emotional moments or storytelling
- standalone context: it must make sense without the rest of the video
- completeness: it starts at the beginning of a thought and ends when the thought is finished
- how interesting it would be to a viewer

Rules:
- Return ONLY valid JSON. No markdown, no code fences, no extra text.
- Use exactly this format: {"clips":[{"start":number,"end":number,"title":string,"hook":string,"score":number,"reason":string}]}
- start and end are seconds, taken from the numbers in square brackets in the transcript.
- A clip should start at the beginning of a sentence and end at the end of a sentence.
- score is an honest number from 0 to 100.
- Do not return overlapping clips.
- If nothing is worth clipping, return {"clips":[]}.`;

export interface UserPromptInput {
  lines: string;
  range: DurationRange;
  windowStart: number;
  windowEnd: number;
  maxClips: number;
}

export function buildUserPrompt(input: UserPromptInput): string {
  return `Find up to ${input.maxClips} of the strongest moments in this part of a transcript.
Each clip must be between ${input.range.min} and ${input.range.max} seconds long (end minus start).
All times must be between ${input.windowStart.toFixed(1)} and ${input.windowEnd.toFixed(1)}.

Transcript (format: [start-end] text):
${input.lines}

Return ONLY the JSON object.`;
}

export function buildCorrectionPrompt(originalPrompt: string, previousAnswer: string, issues: string[]): string {
  return `${originalPrompt}

Your previous answer was invalid:
${previousAnswer.slice(0, 1500)}

Problems found:
${issues.map((issue) => `- ${issue}`).join("\n")}

Fix these problems. Return ONLY the corrected JSON object in the required format.`;
}