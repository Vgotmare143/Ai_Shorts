import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { supabaseAdmin } from "../supabase.js";
import { idParamsSchema } from "./projects.js";

const FINISHED = ["COMPLETED", "FAILED", "CANCELLED"];
const JOB_COLUMNS =
  "id,project_id,status,progress,current_step,error_code,error_message,attempts,created_at,updated_at";

const timeoutBodySchema = z.object({
  reason: z.enum(["queued_too_long", "stalled", "running_too_long"]),
});

const TIMEOUT_MESSAGES = {
  queued_too_long: "Processing did not start. Make sure the worker is running, then retry.",
  stalled: "Processing stopped responding. Please retry.",
  running_too_long: "Processing took too long. Please retry.",
} as const;

function secretMatches(provided: string): boolean {
  const expected = config.N8N_WEBHOOK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function requireInternalSecret(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers["x-internal-secret"];
  const value = typeof header === "string" ? header : "";
  if (!secretMatches(value)) {
    return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Invalid internal secret." } });
  }
}

async function loadJob(id: string) {
  const { data, error } = await supabaseAdmin.from("jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the job.");
  if (!data) throw new AppError(404, "NOT_FOUND", "Job not found.");
  return data;
}

export async function internalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireInternalSecret);

  app.get("/internal/jobs/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return { job: await loadJob(id) };
  });

  // Watchdog: fail a job that never started or stopped updating.
  app.post("/internal/jobs/:id/timeout", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { reason } = timeoutBodySchema.parse(request.body);

    const { data, error } = await supabaseAdmin
      .from("jobs")
      .update({
        status: "FAILED",
        current_step: "Failed",
        error_code: "TIMEOUT",
        error_message: TIMEOUT_MESSAGES[reason],
      })
      .eq("id", id)
      .not("status", "in", "(COMPLETED,FAILED,CANCELLED)")
      .select("id,project_id");
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not update the job.");

    const changed = data?.[0];
    if (changed) {
      await supabaseAdmin.from("projects").update({ status: "failed" }).eq("id", changed.project_id);
      await supabaseAdmin.from("processing_logs").insert({
        job_id: id,
        level: "error",
        step: "WORKFLOW",
        message: TIMEOUT_MESSAGES[reason],
      });
    }
    return { updated: Boolean(changed) };
  });

  // Final database update once a job has ended.
  app.post("/internal/jobs/:id/finalize", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const job = await loadJob(id);
    if (!FINISHED.includes(job.status)) {
      throw new AppError(409, "NOT_FINISHED", "The job is still running.");
    }

    const projectStatus =
      job.status === "COMPLETED" ? "completed" : job.status === "FAILED" ? "failed" : "cancelled";
    await supabaseAdmin.from("projects").update({ status: projectStatus }).eq("id", job.project_id);

    const { count } = await supabaseAdmin
      .from("clips")
      .select("id", { count: "exact", head: true })
      .eq("project_id", job.project_id)
      .eq("status", "completed");

    await supabaseAdmin.from("processing_logs").insert({
      job_id: id,
      level: "info",
      step: "WORKFLOW",
      message: `Workflow finished: ${job.status}`,
    });
    return { status: job.status, projectStatus, clipsCompleted: count ?? 0 };
  });
}