import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createAIProvider } from "../ai/index.js";
import type { AIProvider } from "../ai/types.js";
import { extractClipWords } from "../captions/ass.js";
import { selectClips } from "../clips/selection.js";
import { config, REPO_ROOT } from "../config.js";
import { uploadClipFiles } from "../storage/supabase.js";
import { transcribeAudio, transcriptSchema, type Transcript } from "../transcription/whisper.js";
import { buildAudioArgs, runFfmpeg } from "../video/ffmpeg.js";
import { renderShort } from "../video/render.js";
import {
  getJobStatus,
  getProject,
  log,
  replaceClips,
  setProject,
  updateClip,
  updateJob,
  type JobRow,
} from "./db.js";
import { downloadVideo } from "./download.js";
import { JobCancelledError, toUserError, UserFacingError } from "./errors.js";

const settingsSchema = z.object({
  clipCount: z.coerce.number().int().min(1).max(10).default(3),
  durationRange: z.enum(["15-30", "30-60", "60-90"]).default("30-60"),
  captionTemplate: z.string().default("Classic"),
  captionFontSize: z.number().optional(),
  captionPosition: z.enum(["bottom", "center", "top"]).optional(),
  brandName: z.string().nullable().optional(),
});

function tryCreateProvider(): AIProvider | null {
  try {
    return createAIProvider();
  } catch {
    return null;
  }
}

// Checks for cancellation, then records the real status the app will display.
async function step(job: JobRow, status: string, progress: number, label: string): Promise<void> {
  if ((await getJobStatus(job.id)) === "CANCELLED") throw new JobCancelledError();
  await updateJob(job.id, {
    status,
    progress,
    current_step: label,
    locked_at: new Date().toISOString(), // heartbeat
  });
  await log(job.id, status, label);
}

function logoPath(): string | null {
  if (!config.DEFAULT_LOGO_PATH) return null;
  const resolved = path.resolve(REPO_ROOT, config.DEFAULT_LOGO_PATH);
  return existsSync(resolved) ? resolved : null;
}

export async function runJob(job: JobRow): Promise<void> {
  const workDir = path.join(REPO_ROOT, "work", "jobs", job.id);

  try {
    const project = await getProject(job.project_id);
    const settings = settingsSchema.parse(project.settings ?? {});
    await setProject(project.id, { status: "processing" });
    await mkdir(workDir, { recursive: true });

    // 1. Download (skipped if a previous attempt already downloaded it)
    await step(job, "DOWNLOADING", 5, "Downloading video");
    const existingSource = path.join(workDir, "source.mp4");
    const sourcePath = existsSync(existingSource) ? existingSource : await downloadVideo(project.source_url, workDir);

    // 2. Transcribe (reuse the saved transcript on retry)
    let transcript: Transcript;
    const saved = project.transcript ? transcriptSchema.safeParse(project.transcript) : null;
    if (saved?.success) {
      transcript = saved.data;
      await log(job.id, "TRANSCRIBING", "Using the saved transcript");
    } else {
      await step(job, "TRANSCRIBING", 20, "Extracting audio and transcribing");
      const audioPath = path.join(workDir, "audio.wav");
      await runFfmpeg(buildAudioArgs(sourcePath, audioPath));
      transcript = await transcribeAudio(audioPath, path.join(workDir, "transcript.json"));
      await setProject(project.id, { transcript });
    }

    // 3. Find the best moments
    await step(job, "ANALYZING", 45, "Finding the best moments");
    const selection = await selectClips({
      transcript,
      clipCount: settings.clipCount,
      durationRange: settings.durationRange,
      provider: tryCreateProvider(),
      onLog: (message) => console.log(`  [${job.id.slice(0, 8)}] ${message}`),
    });
    if (selection.notice) await log(job.id, "ANALYZING", selection.notice);
    if (selection.clips.length === 0) {
      throw new UserFacingError("NO_CLIPS", "No suitable moments were found in this video.");
    }

    const rows = await replaceClips(project.id, selection.clips, {
      template: settings.captionTemplate,
      fontSize: settings.captionFontSize,
      position: settings.captionPosition,
      brandName: settings.brandName ?? null,
    });

    // 4. Render and upload each Short
    const logo = logoPath();
    let failures = 0;
    let lastError: unknown = null;

    for (const [index, row] of rows.entries()) {
      const number = index + 1;
      const renderProgress = 55 + Math.floor((35 * (index + 0.5)) / rows.length);
      const uploadProgress = 55 + Math.floor((35 * (index + 1)) / rows.length);

      try {
        await step(job, "RENDERING", renderProgress, `Creating Short ${number} of ${rows.length}`);
        await updateClip(row.id, { status: "rendering" });

        const start = Number(row.start_time);
        const end = Math.min(Number(row.end_time) + 0.3, transcript.duration); // small tail so the last word is not cut
        const videoPath = path.join(workDir, `short_${number}.mp4`);
        const thumbnailPath = path.join(workDir, `short_${number}.jpg`);

        await renderShort({
          sourcePath,
          outputPath: videoPath,
          thumbnailPath,
          workDir: path.join(workDir, `render_${number}`),
          startSeconds: start,
          endSeconds: end,
          words: extractClipWords(transcript, start, end),
          captionSettings: {
            template: settings.captionTemplate,
            fontSize: settings.captionFontSize,
            position: settings.captionPosition,
          },
          brandName: settings.brandName ?? null,
          logoPath: logo,
        });

        await step(job, "UPLOADING", uploadProgress, `Uploading Short ${number} of ${rows.length}`);
        const uploaded = await uploadClipFiles({
          userId: project.user_id,
          projectId: project.id,
          clipId: row.id,
          videoPath,
          thumbnailPath,
        });
        await updateClip(row.id, {
          output_url: uploaded.videoPath,
          thumbnail_url: uploaded.thumbnailPath,
          status: "completed",
        });
      } catch (error) {
        if (error instanceof JobCancelledError) throw error;
        failures += 1;
        lastError = error;
        const userError = toUserError(error);
        console.error(`Short ${number} failed [${userError.code}]:\n${userError.details}`);
        await log(job.id, "RENDERING", `Short ${number} failed: ${userError.message}`, "error");
        await updateClip(row.id, { status: "failed" });
      }
    }

    if (failures === rows.length) throw lastError;

    const created = rows.length - failures;
    await updateJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      current_step: failures > 0 ? `Done (${created} of ${rows.length} Shorts created)` : "Done",
    });
    await setProject(project.id, { status: "completed" });
    await log(job.id, "COMPLETED", `Created ${created} Short(s)`);
    await rm(workDir, { recursive: true, force: true });
  } catch (error) {
    if (error instanceof JobCancelledError) {
      console.log(`Job ${job.id} was cancelled.`);
      await rm(workDir, { recursive: true, force: true });
      return;
    }
    const userError = toUserError(error);
    console.error(`Job ${job.id} failed [${userError.code}]:\n${userError.details}`);
    await updateJob(job.id, {
      status: "FAILED",
      current_step: "Failed",
      error_code: userError.code,
      error_message: userError.message,
    });
    await setProject(job.project_id, { status: "failed" });
    await log(job.id, "FAILED", userError.message, "error");
    // The work folder is kept so "Retry" can reuse the downloaded video.
  }
}