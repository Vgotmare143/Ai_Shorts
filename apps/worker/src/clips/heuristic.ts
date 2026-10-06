import type { Transcript } from "../transcription/whisper.js";
import type { ClipCandidate, DurationRange } from "./types.js";

type Segment = Transcript["segments"][number];

const HOOK_START =
  /^(here'?s|this is|the (biggest|best|worst|most|one|real|truth|first|secret)|most people|nobody|no one|everyone|stop|never|always|why|how|what if|imagine|listen|let me|you (need|should|have to|must|can)|don'?t|if you|did you|have you)\b/i;

const CONTINUATION_START = /^(and|but|so|because|which|that|or|then|also|well|like)\b/i;
const TERMINAL = /[.?!]["')\]]*$/;

const ATTENTION_WORDS = new Set([
  "important", "mistake", "mistakes", "secret", "never", "always", "best", "worst", "biggest",
  "amazing", "crazy", "incredible", "shocking", "learn", "lesson", "problem", "solution", "truth",
  "free", "money", "million", "tip", "rule", "wrong", "easy", "hard", "fail", "success", "key",
  "simple", "powerful", "danger", "warning", "result", "proof", "why", "how",
]);

const EMOTION_WORDS = new Set([
  "love", "hate", "fear", "afraid", "angry", "excited", "wow", "scared", "happy", "sad",
  "proud", "worried", "frustrated", "surprised", "terrible", "awesome", "unbelievable",
]);

function cleanWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

function firstSentence(text: string, maxLength: number): string {
  const sentence = text.trim().split(/(?<=[.?!])\s/)[0] ?? text.trim();
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1).trimEnd()}…` : sentence;
}

export function scoreSegments(segments: Segment[]): { score: number; reasons: string[] } {
  const text = segments.map((segment) => segment.text.trim()).join(" ");
  const words = text.split(/\s+/).filter(Boolean);
  const duration = Math.max(0.1, segments[segments.length - 1].end - segments[0].start);
  const first = segments[0].text.trim();
  const reasons: string[] = [];
  let score = 35;

  // Strong opening
  if (HOOK_START.test(first)) {
    score += 20;
    reasons.push("strong opening phrase");
  } else if (first.includes("?")) {
    score += 12;
    reasons.push("opens with a question");
  }

  // Sentence/information density (words per second)
  const wordsPerSecond = words.length / duration;
  if (wordsPerSecond >= 2 && wordsPerSecond <= 3.5) {
    score += 10;
    reasons.push("good information density");
  } else if ((wordsPerSecond >= 1.5 && wordsPerSecond < 2) || (wordsPerSecond > 3.5 && wordsPerSecond <= 4.5)) {
    score += 5;
  }

  // Keyword density
  const keywordCount = words.filter((word) => ATTENTION_WORDS.has(cleanWord(word))).length;
  const keywordScore = Math.min(14, (keywordCount / Math.max(words.length, 1)) * 100 * 3);
  if (keywordScore >= 3) reasons.push("attention keywords");
  score += keywordScore;

  // Question followed by an answer
  const questionIndex = segments.findIndex((segment) => segment.text.includes("?"));
  if (questionIndex !== -1 && questionIndex < segments.length - 1) {
    score += 8;
    reasons.push("question and answer");
  }

  // Emotional / attention language
  const emotionCount =
    words.filter((word) => EMOTION_WORDS.has(cleanWord(word))).length + (text.match(/!/g)?.length ?? 0);
  const emotionScore = Math.min(8, emotionCount * 2);
  if (emotionScore >= 2) reasons.push("emotional language");
  score += emotionScore;

  // Standalone context and completeness
  const startsClean = /^[A-Z"']/.test(first) && !CONTINUATION_START.test(first);
  const endsClean = TERMINAL.test(segments[segments.length - 1].text.trim());
  score += startsClean ? 6 : -8;
  score += endsClean ? 6 : -6;
  if (startsClean && endsClean) reasons.push("complete standalone thought");

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

// Creates one candidate window per sentence start, then scores and ranks them.
export function rankHeuristic(transcript: Transcript, range: DurationRange): ClipCandidate[] {
  const segments = transcript.segments.filter((segment) => segment.text.trim().length > 0);
  const candidates: ClipCandidate[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    const start = segments[i].start;
    let bestEnd = -1;
    let bestSentenceEnd = -1;

    for (let j = i; j < segments.length; j += 1) {
      const duration = segments[j].end - start;
      if (duration > range.max) break;
      if (duration >= range.min) {
        bestEnd = j;
        if (TERMINAL.test(segments[j].text.trim())) bestSentenceEnd = j;
      }
    }

    const endIndex = bestSentenceEnd !== -1 ? bestSentenceEnd : bestEnd;
    if (endIndex === -1) continue;

    const windowSegments = segments.slice(i, endIndex + 1);
    const { score, reasons } = scoreSegments(windowSegments);
    candidates.push({
      start,
      end: segments[endIndex].end,
      title: firstSentence(segments[i].text, 60),
      hook: firstSentence(segments[i].text, 100),
      score,
      reason: reasons.length > 0 ? `Automatic pick: ${reasons.join(", ")}` : "Automatic pick: balanced segment",
      method: "heuristic",
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
