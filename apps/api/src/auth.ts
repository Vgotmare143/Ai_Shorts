import type { FastifyReply, FastifyRequest } from "fastify";
import { supabaseAdmin } from "./supabase.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Please log in." } });
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return unauthenticated(reply);

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return unauthenticated(reply);

  request.userId = data.user.id;
}