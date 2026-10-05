import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { supabaseAdmin } from "../supabase.js";

function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function checkOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkDatabase(): Promise<boolean> {
  const { error } = await supabaseAdmin.from("templates").select("id").limit(1);
  return !error;
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const [database, ollama, ffmpeg] = await Promise.all([checkDatabase(), checkOllama(), checkFfmpeg()]);
    return {
      status: database ? "ok" : "degraded",
      services: { database, ollama, ffmpeg },
      notes: ollama ? [] : ["Local AI is not running. Start Ollama and try again."],
    };
  });
}