import { AIUnavailableError, type AIProvider, type AIStatus, type GenerateJsonRequest } from "./types.js";

export interface OllamaOptions {
  baseUrl: string;
  model: string;
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  constructor(private readonly options: OllamaOptions) {}

  async checkStatus(): Promise<AIStatus> {
    try {
      const response = await fetch(`${this.options.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return "not_running";
      const body = (await response.json()) as { models?: { name: string }[] };
      const installed = (body.models ?? []).map((model) => model.name);
      const wanted = this.options.model;
      const found = installed.some((name) => name === wanted || name === `${wanted}:latest`);
      return found ? "ready" : "model_missing";
    } catch {
      return "not_running";
    }
  }

  async generateJson(request: GenerateJsonRequest): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          format: "json", // forces valid JSON syntax; we still validate the shape ourselves
          options: { temperature: 0.2, num_ctx: 8192 }, // default context is small and would cut long transcripts
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
        }),
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      throw new AIUnavailableError();
    }
    if (!response.ok) {
      throw new AIUnavailableError(`Local AI returned an error (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content;
    if (!content) throw new AIUnavailableError("Local AI returned an empty answer.");
    return content;
  }
}