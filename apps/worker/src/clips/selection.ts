import type { AIProvider } from "../ai/types.js";
import type { Transcript } from "../transcription/whisper.js";
import { rankHeuristic } from "./heuristic.js";
import { selectWithLlm } from "./llm.js";
import { DURATION_RANGES, type ClipCandidate, type DurationRangeKey, type SelectionResult } from "./types.js";
import { overlapRatio, pickTop } from "./validate.js";

export const AI_UNAVAILABLE_NOTICE = "AI unavailable — using smart automatic clip selection.";

export interface SelectClipsOptions {
  transcript: Transcript;
  clipCount: number;
  durationRange: DurationRangeKey;
  provider: AIProvider | null;
  onLog?: (message: string) => void;
}

export async function selectClips(options: SelectClipsOptions): Promise<SelectionResult> {
  const range = DURATION_RANGES[options.durationRange];
  let llmClips: ClipCandidate[] = [];

  if (options.provider) {
    const status = await options.provider.checkStatus();
    if (status === "ready") {
      const result = await selectWithLlm(options.provider, options.transcript, {
        range,
        clipCount: options.clipCount,
        videoDuration: options.transcript.duration,
        onLog: options.onLog,
      });
      llmClips = pickTop(result.clips, options.clipCount);
    } else {
      options.onLog?.(status === "model_missing" ? "AI model is not installed." : "Local AI is not running.");
    }
  }

  // Top up with automatic selection if the AI found fewer clips than requested.
  const merged = [...llmClips];
  if (merged.length < options.clipCount) {
    for (const candidate of rankHeuristic(options.transcript, range)) {
      if (merged.length >= options.clipCount) break;
      if (!merged.some((existing) => overlapRatio(candidate, existing) > 0.05)) merged.push(candidate);
    }
  }

  const clips = merged.sort((a, b) => b.score - a.score);
  const aiCount = llmClips.length;

  if (aiCount === 0) {
    return { clips, method: "heuristic", notice: AI_UNAVAILABLE_NOTICE };
  }
  if (aiCount < clips.length) {
    return {
      clips,
      method: "mixed",
      notice: `Local AI found ${aiCount} moment(s); the rest were chosen automatically.`,
    };
  }
  return { clips, method: "llm", notice: null };
}