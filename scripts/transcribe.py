import argparse
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper")
    parser.add_argument("audio_path")
    parser.add_argument("output_path")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()

    # CPU + int8 is the most compatible setting on Windows.
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(
        args.audio_path,
        language=args.language,
        word_timestamps=True,
        vad_filter=True,
    )

    segments = []
    for segment in segments_iter:
        words = [
            {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word}
            for w in (segment.words or [])
        ]
        segments.append(
            {
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
                "words": words,
            }
        )
        print(f"transcribed up to {segment.end:.1f}s", file=sys.stderr)

    result = {
        "text": " ".join(s["text"] for s in segments),
        "language": info.language,
        "duration": round(info.duration, 3),
        "segments": segments,
    }
    with open(args.output_path, "w", encoding="utf-8") as output_file:
        json.dump(result, output_file, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
    