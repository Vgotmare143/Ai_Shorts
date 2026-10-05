import { AppError } from "./errors.js";
import { supabaseAdmin } from "./supabase.js";

const PROJECT_COLUMNS = "id,user_id,source_url,title,status,settings,created_at,updated_at";

export async function getOwnedProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the project.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Project not found.");
  return data;
}

export async function getOwnedJob(jobId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("jobs")
    .select("*, projects!inner(user_id)")
    .eq("id", jobId)
    .eq("projects.user_id", userId)
    .maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the job.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Job not found.");
  const { projects: _owner, ...job } = data;
  return job;
}
