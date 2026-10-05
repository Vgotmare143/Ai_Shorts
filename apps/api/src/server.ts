import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors.js";
import { clipRoutes } from "./routes/clips.js";
import { healthRoutes } from "./routes/health.js";
import { jobRoutes } from "./routes/jobs.js";
import { projectRoutes } from "./routes/projects.js";

export async function buildServer() {
  const app = Fastify({
    logger: { level: "info", redact: ["req.headers.authorization"] },
    bodyLimit: 100_000,
  });

  await app.register(cors, { origin: true }); // tighten before production (Phase 17)
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  // Users only ever see readable messages, never stack traces.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => issue.message).join("; ");
      return reply.code(400).send({ error: { code: "INVALID_INPUT", message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Slow down." } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "BAD_REQUEST", message: "Bad request." } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
  });

  await app.register(healthRoutes);
  await app.register(projectRoutes);
  await app.register(jobRoutes);
  await app.register(clipRoutes);
  return app;
}