import type { ClipCandidate } from "../clips/types.js";
import { getAdminClient, removeFiles } from "../storage/supabase.js";

export interface JobRow {
  id: string;
  project_id: string;
  status: string;
  progress: number;
  current_step: string | null;
  attempts: number;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  source_url: string;
  status: string;
  settings: unknown;
  transcript: unknown;
}

export interface ClipRow {
  id: string;
  start_time: number;
  end_time: number;
  title: string | null;
}

const IN_PROGRESS = ["DOWNLOADING", "TRANSCRIBING", "ANALYZING", "CLIPPING", "CAPTIONS", "RENDERING", "UPLOADING"];
const STALE_MINUTES = 20;

export async function claimNextJob(): Promise<JobRow | null> {
  const { data, error } = await getAdminClient().rpc("claim_next_job");
  if (error) throw new Error(`claim_next_job failed: ${error.message}`);
  const rows = (data ?? []) as JobRow[];
  return rows[0] ?? null;
}

// Jobs left half-done by a crashed worker go back to the queue.
export async function requeueStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  const { data, error } = await getAdminClient()
    .from("jobs")
    .update({ status: "QUEUED", current_step: "Queued", progress: 0 })
    .in("status", IN_PROGRESS)
    .lt("locked_at", cutoff)
    .select("id");
  if (error) throw new Error(`requeue failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function getJobStatus(jobId: string): Promise<string> {
  const { data, error } = await getAdminClient().from("jobs").select("status").eq("id", jobId).single();
  if (error || !data) throw new Error(`Could not read job ${jobId}`);
  return data.status as string;
}

// Never overwrites CANCELLED, so a cancel from the app always wins.
export async function updateJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getAdminClient().from("jobs").update(patch).eq("id", jobId).neq("status", "CANCELLED");
  if (error) throw new Error(`Could not update job: ${error.message}`);
}

export async function getProject(projectId: string): Promise<ProjectRow> {
  const { data, error } = await getAdminClient().from("projects").select("*").eq("id", projectId).single();
  if (error || !data) throw new Error(`Could not read project ${projectId}`);
  return data as ProjectRow;
}

export async function setProject(projectId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getAdminClient().from("projects").update(patch).eq("id", projectId);
  if (error) throw new Error(`Could not update project: ${error.message}`);
}

// Only friendly messages go here. Users can read these rows.
export async function log(jobId: string, step: string, message: string, level = "info"): Promise<void> {
  try {
    await getAdminClient().from("processing_logs").insert({ job_id: jobId, step, message, level });
  } catch {
    // logging must never break a job
  }
}

export async function replaceClips(
  projectId: string,
  clips: ClipCandidate[],
  captionSettings: Record<string, unknown>,
): Promise<ClipRow[]> {
  const client = getAdminClient();

  // Regenerating: remove old clips and their files first.
  const old = await client.from("clips").select("output_url,thumbnail_url").eq("project_id", projectId);
  const oldPaths = ((old.data ?? []) as { output_url: string | null; thumbnail_url: string | null }[])
    .flatMap((row) => [row.output_url, row.thumbnail_url])
    .filter((value): value is string => Boolean(value));
  await removeFiles(oldPaths);
  await client.from("clips").delete().eq("project_id", projectId);

  const inserted = await client
    .from("clips")
    .insert(
      clips.map((clip) => ({
        project_id: projectId,
        start_time: clip.start,
        end_time: clip.end,
        title: clip.title,
        hook: clip.hook,
        score: clip.score,
        reason: clip.reason,
        selection_method: clip.method,
        caption_settings: captionSettings,
        status: "pending",
      })),
    )
    .select("id,start_time,end_time,title");
  if (inserted.error) throw new Error(`Could not save clips: ${inserted.error.message}`);
  return (inserted.data ?? []) as ClipRow[];
}

export async function updateClip(clipId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await getAdminClient().from("clips").update(patch).eq("id", clipId);
  if (error) throw new Error(`Could not update clip: ${error.message}`);
}
