import { config } from "../config.js";
import { OllamaProvider } from "./ollama.js";
import type { AIProvider } from "./types.js";

export * from "./types.js";

export function createAIProvider(): AIProvider {
  if (config.AI_PROVIDER === "ollama") {
    return new OllamaProvider({ baseUrl: config.OLLAMA_BASE_URL, model: config.AI_MODEL });
  }
  // OpenAI, Gemini and Anthropic providers can be added here later. They are optional and may cost money.
  throw new Error(`AI_PROVIDER "${config.AI_PROVIDER}" is not implemented yet. Use "ollama" (free).`);
}