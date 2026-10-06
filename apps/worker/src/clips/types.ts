export type SelectionMethod = "llm" | "heuristic";

export interface ClipCandidate {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  method: SelectionMethod;
}

export interface DurationRange {
  min: number;
  max: number;
}

export const DURATION_RANGES = {
  "15-30": { min: 15, max: 30 },
  "30-60": { min: 30, max: 60 },
  "60-90": { min: 60, max: 90 },
} as const satisfies Record<string, DurationRange>;

export type DurationRangeKey = keyof typeof DURATION_RANGES;

export interface SelectionResult {
  clips: ClipCandidate[];
  method: "llm" | "heuristic" | "mixed";
  notice: string | null;
}