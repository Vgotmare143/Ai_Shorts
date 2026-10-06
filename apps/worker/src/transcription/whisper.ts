import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config, REPO_ROOT } from "../config.js";
import { runProcess } from "../process.js";

const wordSchema = z.object({ start: z.number(), end: z.number(), word: z.string() });

const segmentSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string(),
    words: z.array(wordSchema).default([]),
  })
  .refine((segment) => segment.end >= segment.start, { message: "Segment end is before its start" });

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().nonnegative(),
  segments: z.array(segmentSchema),
});

export type Transcript = z.infer<typeof transcriptSchema>;

export function parseTranscript(raw: unknown): Transcript {
  return transcriptSchema.parse(raw);
}

export class TranscriptionError extends Error {
  constructor(public readonly details: string) {
    super("Transcription failed. Check local Whisper installation.");
    this.name = "TranscriptionError";
  }
}

export async function transcribeAudio(audioPath: string, outputJsonPath: string): Promise<Transcript> {
  const python = path.resolve(REPO_ROOT, config.WHISPER_PYTHON);
  const script = path.join(REPO_ROOT, "scripts", "transcribe.py");
  try {
    const result = await runProcess(python, [script, audioPath, outputJsonPath, "--model", config.WHISPER_MODEL]);
    if (result.code !== 0) throw new TranscriptionError(result.stderr);
    return parseTranscript(JSON.parse(await readFile(outputJsonPath, "utf8")));
  } catch (error) {
    if (error instanceof TranscriptionError) throw error;
    throw new TranscriptionError(String(error));
  }
}
