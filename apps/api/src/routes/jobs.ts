import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { getOwnedJob } from "../db.js";
import { AppError } from "../errors.js";
import { supabaseAdmin } from "../supabase.js";
import { idParamsSchema } from "./projects.js";
import { notifyN8n } from "../n8n.js";

const FINISHED = ["COMPLETED", "FAILED", "CANCELLED"];

export async function jobRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/jobs/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return { job: await getOwnedJob(id, request.userId) };
  });

  app.post("/jobs/:id/retry", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const job = await getOwnedJob(id, request.userId);
    if (job.status !== "FAILED" && job.status !== "CANCELLED") {
      throw new AppError(409, "NOT_RETRYABLE", "Only failed or cancelled jobs can be retried.");
    }
    const { data, error } = await supabaseAdmin
      .from("jobs")
      .update({
        status: "QUEUED",
        progress: 0,
        current_step: "Queued",
        error_code: null,
        error_message: null,
        locked_at: null,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not retry the job.");
    await supabaseAdmin.from("projects").update({ status: "queued" }).eq("id", job.project_id);
    void notifyN8n({ jobId: id, projectId: job.project_id }, request.log);
    return { job: data };
  });

  app.post("/jobs/:id/cancel", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const job = await getOwnedJob(id, request.userId);
    if (FINISHED.includes(job.status)) {
      throw new AppError(409, "ALREADY_FINISHED", "This job has already finished.");
    }
    const { data, error } = await supabaseAdmin
      .from("jobs")
      .update({ status: "CANCELLED", current_step: "Cancelled" })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not cancel the job.");
    await supabaseAdmin.from("projects").update({ status: "cancelled" }).eq("id", job.project_id);
    return { job: data };
  });
}