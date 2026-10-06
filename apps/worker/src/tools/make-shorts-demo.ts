import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAIProvider } from "../ai/index.js";
import type { AIProvider } from "../ai/types.js";
import { CAPTION_TEMPLATES, extractClipWords, type CaptionPosition } from "../captions/ass.js";
import { selectClips } from "../clips/selection.js";
import { DURATION_RANGES, type DurationRangeKey } from "../clips/types.js";
import { transcribeAudio, TranscriptionError, parseTranscript, type Transcript } from "../transcription/whisper.js";
import { buildAudioArgs, FfmpegError, runFfmpeg } from "../video/ffmpeg.js";
import { renderShort } from "../video/render.js";

const [sourceArg, ...flags] = process.argv.slice(2);
if (!sourceArg) {
  console.error(
    'Usage: tsx make-shorts-demo.ts <video.mp4> [--count 3] [--range 30-60] [--template Highlight] [--brand "My Brand"] [--logo logo.png] [--size 72] [--position bottom] [--no-ai]',
  );
  process.exit(1);
}

function flag(name: string): string | undefined {
  const index = flags.indexOf(`--${name}`);
  return index !== -1 ? flags[index + 1] : undefined;
}

const sourcePath = path.resolve(sourceArg);
const sourceDir = path.dirname(sourcePath);
const outDir = path.resolve(flag("out") ?? "work/demo");
const count = Number(flag("count") ?? 3);
const range = (flag("range") ?? "30-60") as DurationRangeKey;
const template = flag("template") ?? "Highlight";
const brand = flag("brand") ?? null;
const logo = flag("logo") ?? null;
const fontSize = flag("size") ? Number(flag("size")) : undefined;
const position = flag("position") as CaptionPosition | undefined;

if (!(range in DURATION_RANGES)) {
  console.error(`--range must be one of: ${Object.keys(DURATION_RANGES).join(", ")}`);
  process.exit(1);
}
if (!(template in CAPTION_TEMPLATES)) {
  console.error(`--template must be one of: ${Object.keys(CAPTION_TEMPLATES).join(", ")}`);
  process.exit(1);
}
if (!existsSync(sourcePath)) {
  console.error(`Video not found: ${sourcePath}`);
  process.exit(1);
}

try {
  await mkdir(outDir, { recursive: true });

  // 1. Transcript (reuse if it already exists next to the video)
  const transcriptPath = path.resolve(flag("transcript") ?? path.join(sourceDir, "transcript.json"));
  let transcript: Transcript;
  if (existsSync(transcriptPath)) {
    console.log(`Reusing transcript: ${transcriptPath}`);
    transcript = parseTranscript(JSON.parse(await readFile(transcriptPath, "utf8")));
  } else {
    console.log("Extracting audio and transcribing (this can take a few minutes)...");
    const audioPath = path.join(sourceDir, "audio.wav");
    await runFfmpeg(buildAudioArgs(sourcePath, audioPath));
    transcript = await transcribeAudio(audioPath, transcriptPath);
  }
  console.log(`Transcript: ${transcript.segments.length} segments, ${transcript.duration}s`);

  // 2. Clip selection
  let provider: AIProvider | null = null;
  if (!flags.includes("--no-ai")) {
    try {
      provider = createAIProvider();
    } catch {
      provider = null;
    }
  }
  const selection = await selectClips({
    transcript,
    clipCount: count,
    durationRange: range,
    provider,
    onLog: (message) => console.log(`  ${message}`),
  });
  if (selection.notice) console.log(`\n${selection.notice}`);
  console.log(`Selected ${selection.clips.length} clip(s) using: ${selection.method}\n`);

  // 3. Render every clip
  const summary = [];
  for (const [index, clip] of selection.clips.entries()) {
    const number = index + 1;
    const start = clip.start;
    const end = Math.min(clip.end + 0.3, transcript.duration); // small tail so the last word is not cut
    console.log(`Rendering Short ${number}: ${start}s - ${end.toFixed(1)}s  "${clip.title}"`);

    await renderShort({
      sourcePath,
      outputPath: path.join(outDir, `short_${number}.mp4`),
      thumbnailPath: path.join(outDir, `short_${number}.jpg`),
      workDir: path.join(outDir, `work_${number}`),
      startSeconds: start,
      endSeconds: end,
      words: extractClipWords(transcript, start, end),
      captionSettings: { template, fontSize, position },
      brandName: brand,
      logoPath: logo,
    });
    summary.push({ number, ...clip, file: `short_${number}.mp4`, thumbnail: `short_${number}.jpg` });
  }

  await writeFile(path.join(outDir, "clips.json"), JSON.stringify({ selection: selection.method, clips: summary }, null, 2));
  console.log(`\nDone. Open the folder: ${outDir}`);
} catch (error) {
  if (error instanceof FfmpegError) {
    console.error(`\n${error.message}`);
    console.error("Technical details (last lines):\n" + error.details.split("\n").slice(-8).join("\n"));
  } else if (error instanceof TranscriptionError) {
    console.error(`\n${error.message}`);
    console.error("Technical details (last lines):\n" + error.details.split("\n").slice(-8).join("\n"));
  } else {
    console.error("\nSomething went wrong:", error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
