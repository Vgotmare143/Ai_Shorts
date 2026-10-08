import { fileURLToPath } from "node:url";

import { z } from "zod";

// Load the repo-root .env file. If it is missing, real environment variables are used.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch {
  // no .env file found
}

const text = (fallback: string) =>
  z.string().optional().transform((value) => (value && value.length > 0 ? value : fallback));

const envSchema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STORAGE_BUCKET: text("shorts"),
  OLLAMA_BASE_URL: text("http://localhost:11434"),
  API_PORT: text("4000").transform(Number),
  N8N_BASE_URL: text(""),
  N8N_WEBHOOK_SECRET: text(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Missing or invalid values in .env:", parsed.error.issues.map((i) => i.path.join(".")).join(", "));
  process.exit(1);
}

export const config = parsed.data;