import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { getOwnedProject } from "../db.js";
import { AppError } from "../errors.js";
import { signPath } from "../storage.js";
import { supabaseAdmin } from "../supabase.js";
import { idParamsSchema } from "./projects.js";

async function withSignedUrls<T extends { output_url: string | null; thumbnail_url: string | null }>(clip: T) {
  const [videoUrl, thumbnailUrl] = await Promise.all([signPath(clip.output_url), signPath(clip.thumbnail_url)]);
  return { ...clip, video_signed_url: videoUrl, thumbnail_signed_url: thumbnailUrl };
}

export async function clipRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/projects/:id/clips", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    await getOwnedProject(id, request.userId);
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select("*")
      .eq("project_id", id)
      .order("score", { ascending: false });
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load clips.");
    return { clips: await Promise.all((data ?? []).map(withSignedUrls)) };
  });

  app.get("/clips/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { data, error } = await supabaseAdmin
      .from("clips")
      .select("*, projects!inner(user_id)")
      .eq("id", id)
      .eq("projects.user_id", request.userId)
      .maybeSingle();
    if (error) throw new AppError(500, "DATABASE_ERROR", "Could not load the clip.");
    if (!data) throw new AppError(404, "NOT_FOUND", "Clip not found.");
    const { projects: _owner, ...clip } = data;
    return { clip: await withSignedUrls(clip) };
  });
}