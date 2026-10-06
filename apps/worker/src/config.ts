import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

try {
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));
} catch {
  // no .env file found
}

const text = (fallback: string) =>
  z.string().optional().transform((value) => (value && value.length > 0 ? value : fallback));

export const config = z
  .object({
    AI_PROVIDER: text("ollama"),
    AI_MODEL: text(""),
    OLLAMA_BASE_URL: text("http://localhost:11434"),
    WHISPER_MODEL: text("small"),
    WHISPER_PYTHON: text(".venv/Scripts/python.exe"),
    SUPABASE_URL: text(""),
    SUPABASE_SERVICE_ROLE_KEY: text(""),
    STORAGE_BUCKET: text("shorts"),
  })
  .parse(process.env);