import type { Transcript } from "../transcription/whisper.js";

export interface CaptionWord {
  start: number; // seconds, relative to the clip start
  end: number;
  text: string;
}

export type CaptionPosition = "bottom" | "center" | "top";

export interface CaptionTemplate {
  name: string;
  fontName: string;
  fontSize: number;
  bold: boolean;
  uppercase: boolean;
  position: CaptionPosition;
  animation: "none" | "pop";
  highlight: boolean;
  textColor: string; // #RRGGBB
  highlightColor: string;
  outlineColor: string;
  outlineWidth: number;
}

export const CAPTION_TEMPLATES: Record<string, CaptionTemplate> = {
  Classic: {
    name: "Classic",
    fontName: "Arial",
    fontSize: 64,
    bold: false,
    uppercase: false,
    position: "bottom",
    animation: "none",
    highlight: false,
    textColor: "#FFFFFF",
    highlightColor: "#FFD400",
    outlineColor: "#000000",
    outlineWidth: 4,
  },
  Bold: {
    name: "Bold",
    fontName: "Arial",
    fontSize: 78,
    bold: true,
    uppercase: true,
    position: "center",
    animation: "pop",
    highlight: false,
    textColor: "#FFFFFF",
    highlightColor: "#FFD400",
    outlineColor: "#000000",
    outlineWidth: 6,
  },
  Highlight: {
    name: "Highlight",
    fontName: "Arial",
    fontSize: 72,
    bold: true,
    uppercase: true,
    position: "bottom",
    animation: "pop",
    highlight: true,
    textColor: "#FFFFFF",
    highlightColor: "#FFD400",
    outlineColor: "#000000",
    outlineWidth: 6,
  },
};

export interface CaptionSettings {
  template?: string;
  fontSize?: number;
  position?: CaptionPosition;
}

export function resolveTemplate(settings: CaptionSettings = {}): CaptionTemplate {
  const base = CAPTION_TEMPLATES[settings.template ?? "Classic"] ?? CAPTION_TEMPLATES.Classic;
  const fontSize = Math.min(140, Math.max(32, settings.fontSize ?? base.fontSize));
  return { ...base, fontSize, position: settings.position ?? base.position };
}

// "#RRGGBB" -> "BBGGRR" (the order ASS subtitles use)
function bgr(hex: string): string {
  const clean = hex.replace("#", "");
  return clean.slice(4, 6) + clean.slice(2, 4) + clean.slice(0, 2);
}

export function escapeAss(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ").trim();
}

export function formatAssTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centiseconds / 360000);
  const m = Math.floor((centiseconds % 360000) / 6000);
  const s = Math.floor((centiseconds % 6000) / 100);
  const c = centiseconds % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// Words from the transcript that fall inside the clip, with times relative to the clip start.
export function extractClipWords(transcript: Transcript, startSeconds: number, endSeconds: number): CaptionWord[] {
  const result: CaptionWord[] = [];

  for (const segment of transcript.segments) {
    if (segment.end <= startSeconds || segment.start >= endSeconds) continue;

    let words = segment.words.map((word) => ({ start: word.start, end: word.end, text: word.word.trim() }));
    if (words.length === 0) {
      // No word timestamps: spread the segment's words evenly across its time.
      const parts = segment.text.split(/\s+/).filter(Boolean);
      const step = (segment.end - segment.start) / Math.max(parts.length, 1);
      words = parts.map((text, index) => ({
        start: segment.start + index * step,
        end: segment.start + (index + 1) * step,
        text,
      }));
    }

    for (const word of words) {
      if (!word.text || word.end <= startSeconds || word.start >= endSeconds) continue;
      const start = Math.max(word.start, startSeconds) - startSeconds;
      const end = Math.min(word.end, endSeconds) - startSeconds;
      result.push({ start, end: Math.max(end, start + 0.05), text: word.text });
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

// Groups words into short on-screen chunks (about 4 words, split at sentence ends and pauses).
export function groupIntoChunks(words: CaptionWord[], maxWords = 4, maxDuration = 2.2): CaptionWord[][] {
  const chunks: CaptionWord[][] = [];
  let current: CaptionWord[] = [];

  for (const word of words) {
    const last = current[current.length - 1];
    const tooMany = current.length >= maxWords;
    const tooLong = last !== undefined && word.end - current[0].start > maxDuration;
    const longPause = last !== undefined && word.start - last.end > 0.8;
    if (current.length > 0 && (tooMany || tooLong || longPause)) {
      chunks.push(current);
      current = [];
    }
    current.push(word);

    const endsSentence = /[.?!]$/.test(word.text);
    const endsClause = /[,;:]$/.test(word.text) && current.length >= 3;
    if (endsSentence || endsClause) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const POP_ANIMATION = "{\\fscx80\\fscy80\\t(0,120,\\fscx100\\fscy100)}";

const POSITIONS: Record<CaptionPosition, { alignment: number; marginV: number }> = {
  bottom: { alignment: 2, marginV: 380 }, // stays above the phone's Shorts buttons
  center: { alignment: 5, marginV: 0 },
  top: { alignment: 8, marginV: 260 },
};

export interface BuildAssOptions {
  words: CaptionWord[];
  template: CaptionTemplate;
  durationSeconds: number;
  brandName?: string | null;
}

export function buildAss(options: BuildAssOptions): string {
  const { words, template, durationSeconds, brandName } = options;
  const textColor = bgr(template.textColor);
  const highlightColor = bgr(template.highlightColor);
  const outlineColor = bgr(template.outlineColor);
  const { alignment, marginV } = POSITIONS[template.position];
  const showText = (word: CaptionWord) => escapeAss(template.uppercase ? word.text.toUpperCase() : word.text);

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${template.fontName},${template.fontSize},&H00${textColor},&H00${textColor},&H00${outlineColor},&H64000000,${template.bold ? -1 : 0},0,0,0,100,100,0,0,1,${template.outlineWidth},0,${alignment},70,70,${marginV},1`,
    `Style: Brand,${template.fontName},44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,2,0,1,3,0,8,60,60,70,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const clipEnd = formatAssTime(durationSeconds);

  // Basic motion graphic: a progress bar that grows across the bottom of the video.
  const barMs = Math.round(durationSeconds * 1000);
  lines.push(
    `Dialogue: 0,${formatAssTime(0)},${clipEnd},Brand,,0,0,0,,{\\an7\\pos(0,1898)\\1c&H${highlightColor}&\\bord0\\shad0\\p1\\fscx1\\t(0,${barMs},\\fscx100)}m 0 0 l 1080 0 l 1080 12 l 0 12{\\p0}`,
  );

  // Branding
  if (brandName && brandName.trim().length > 0) {
    lines.push(`Dialogue: 2,${formatAssTime(0)},${clipEnd},Brand,,0,0,0,,${escapeAss(brandName)}`);
  }

  // Captions
  const chunks = groupIntoChunks(words);
  chunks.forEach((chunk, index) => {
    const chunkStart = chunk[0].start;
    const nextStart = chunks[index + 1]?.[0].start ?? durationSeconds;
    const chunkEnd = Math.min(chunk[chunk.length - 1].end + 0.25, nextStart, durationSeconds);
    if (chunkEnd <= chunkStart + 0.05) return;

    if (!template.highlight) {
      const text = chunk.map(showText).join(" ");
      const prefix = template.animation === "pop" ? POP_ANIMATION : "";
      lines.push(
        `Dialogue: 1,${formatAssTime(chunkStart)},${formatAssTime(chunkEnd)},Caption,,0,0,0,,${prefix}${text}`,
      );
      return;
    }

    // Highlight mode: one line per spoken word, with that word in the highlight color.
    chunk.forEach((word, wordIndex) => {
      const lineStart = wordIndex === 0 ? chunkStart : word.start;
      const lineEnd = wordIndex < chunk.length - 1 ? chunk[wordIndex + 1].start : chunkEnd;
      if (lineEnd <= lineStart) return;
      const text = chunk
        .map((other, otherIndex) =>
          otherIndex === wordIndex
            ? `{\\1c&H${highlightColor}&}${showText(other)}{\\1c&H${textColor}&}`
            : showText(other),
        )
        .join(" ");
      const prefix = wordIndex === 0 && template.animation === "pop" ? POP_ANIMATION : "";
      lines.push(
        `Dialogue: 1,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Caption,,0,0,0,,${prefix}${text}`,
      );
    });
  });

  return `${lines.join("\n")}\n`;
}