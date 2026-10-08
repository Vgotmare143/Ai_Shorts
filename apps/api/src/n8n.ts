import type { FastifyBaseLogger } from "fastify";
import { config } from "./config.js";

// Tells n8n a job was queued. It never throws: jobs run fine even if n8n is down.
export async function notifyN8n(
  payload: { jobId: string; projectId: string },
  log: FastifyBaseLogger,
): Promise<void> {
  if (!config.N8N_BASE_URL || !config.N8N_WEBHOOK_SECRET) return;
  try {
    const response = await fetch(`${config.N8N_BASE_URL}/webhook/ai-shorts-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": config.N8N_WEBHOOK_SECRET },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) log.warn(`n8n webhook answered ${response.status}`);
  } catch {
    log.warn("n8n is not reachable; the worker will still process the job");
  }
}