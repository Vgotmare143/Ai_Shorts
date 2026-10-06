import { readFile } from "node:fs/promises";
import { parseTranscript } from "../transcription/whisper.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: tsx check-transcript.ts <transcript.json>");
  process.exit(1);
}

const transcript = parseTranscript(JSON.parse(await readFile(filePath, "utf8")));
console.log(`Valid transcript: ${transcript.segments.length} segments, ${transcript.duration}s, language ${transcript.language}`);
console.log("First segment:", transcript.segments[0]);
