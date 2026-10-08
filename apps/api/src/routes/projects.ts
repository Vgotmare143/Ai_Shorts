import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { getOwnedProject } from "../db.js";
import { AppError } from "../errors.js";
import { deleteProjectFiles } from "../storage.js";
import { supabaseAdmin } from "../supabase.js";
import { parseYouTubeUrl } from "../youtube.js";
import { notifyN8n } from "../n8n.js";

const createProjectSchema = z.object({
  sourceUrl: z.string().min(1),
  clipCount: z.union([z.literal(3), z.literal(4), z.literal(5)]).default(3),
  durationRange: z.enum(["15-30", "30-60", "60-90"]).default("30-60"),
  captionTemplate: z.string().min(1).max(40).default("Classic"),
  brandName: z.string().max(40).optional(),
});

export const idParamsSchema = z.object({ id: z.string().uuid() });

const LIST_COLUMNS = "id,source_url,title,status,settings,created_at,updated_at";
const ACTIVE_JOB_EXCLUDE = "(COMPLETED,FAILED,CANCELLED)";

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.post("/projects", async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const video = parseYouTubeUrl(body.sourceUrl);
    if (!video) {
      throw new AppError(400, "INVALID_URL", "Please enter a valid YouTube link (youtube.com or youtu.be).");
    }

    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: request.userId,
        source_url: video.url,
        settings: {
          videoId: video.videoId,
          clipCount: body.clipCount, 
          durationRange: body.durationRange,
          captionTemplate: body.captionTemplate,
          brandName: body.brandName ?? null,
        },
      })
      .select(LIST_COLUMNS)
      .single();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not create the project.");
    return reply.code(201).send({ project: data });
  });

  app.get("/projects", async (request) => {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select(LIST_COLUMNS)
      .eq("user_id", request.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load projects.");
    return { projects: data };
  });

  app.get("/projects/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const project = await getOwnedProject(id, request.userId);
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { project, latestJob: job };
  });

  app.delete("/projects/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    await getOwnedProject(id, request.userId);
    await deleteProjectFiles(request.userId, id);
    const { error } = await supabaseAdmin.from("projects").delete().eq("id", id).eq("user_id", request.userId);
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not delete the project.");
    return reply.code(204).send();
  });

  app.post("/projects/:id/generate", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    await getOwnedProject(id, request.userId);

    const { data: active } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("project_id", id)
      .not("status", "in", ACTIVE_JOB_EXCLUDE)
      .limit(1);
    if (active && active.length > 0) {
      throw new AppError(409, "JOB_ALREADY_RUNNING", "This project is already being processed.");
    }

    const { data: job, error } = await supabaseAdmin
      .from("jobs")
      .insert({ project_id: id, status: "QUEUED", current_step: "Queued" })
      .select("*")
      .single();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not start processing.");

    await supabaseAdmin.from("projects").update({ status: "queued" }).eq("id", id);
    void notifyN8n({ jobId: job.id, projectId: id }, request.log);
    return reply.code(201).send({ job });
  });
}