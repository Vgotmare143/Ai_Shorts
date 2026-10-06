import { readFile } from "node:fs/promises";
import { createAIProvider } from "../ai/index.js";
import type { AIProvider } from "../ai/types.js";
import { selectClips } from "../clips/selection.js";
import { DURATION_RANGES, type DurationRangeKey } from "../clips/types.js";
import { parseTranscript } from "../transcription/whisper.js";

const [inputPath, ...flags] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: tsx select-clips.ts <transcript.json> [--count 3] [--range 30-60] [--no-ai]");
  process.exit(1);
}

function flag(name: string): string | undefined {
  const index = flags.indexOf(`--${name}`);
  return index !== -1 ? flags[index + 1] : undefined;
}

const range = (flag("range") ?? "30-60") as DurationRangeKey;
if (!(range in DURATION_RANGES)) {
  console.error(`--range must be one of: ${Object.keys(DURATION_RANGES).join(", ")}`);
  process.exit(1);
}
const count = Number(flag("count") ?? 3);

let provider: AIProvider | null = null;
if (!flags.includes("--no-ai")) {
  try {
    provider = createAIProvider();
  } catch {
    provider = null;
  }
}

const transcript = parseTranscript(JSON.parse(await readFile(inputPath, "utf8")));
console.log(`Transcript: ${transcript.segments.length} segments, ${transcript.duration}s`);

const result = await selectClips({
  transcript,
  clipCount: count,
  durationRange: range,
  provider,
  onLog: (message) => console.log(`  ${message}`),
});

if (result.notice) console.log(`\n${result.notice}`);
console.log(`\nMethod: ${result.method}\n`);
for (const clip of result.clips) {
  const duration = (clip.end - clip.start).toFixed(1);
  console.log(`[${clip.method}] ${clip.start}s - ${clip.end}s (${duration}s) score ${clip.score}`);
  console.log(`  Title: ${clip.title}`);
  console.log(`  Hook:  ${clip.hook}`);
  console.log(`  Why:   ${clip.reason}\n`);
}

