export type AIStatus = "ready" | "not_running" | "model_missing";

export interface GenerateJsonRequest {
  system: string;
  prompt: string;
}

// Every provider (Ollama now, OpenAI/Gemini/Anthropic later) implements this.
export interface AIProvider {
  readonly name: string;
  checkStatus(): Promise<AIStatus>;
  // Returns the RAW text. Callers must validate it (Zod) and never trust it.
  generateJson(request: GenerateJsonRequest): Promise<string>;
}

export class AIUnavailableError extends Error {
  constructor(message = "Local AI is not running. Start Ollama and try again.") {
    super(message);
    this.name = "AIUnavailableError";
  }
}