import { createAIProvider } from "../ai/index.js";

const provider = createAIProvider();
const status = await provider.checkStatus();
console.log("Status:", status);

if (status === "not_running") {
  console.log("Local AI is not running. Start Ollama and try again.");
  process.exit(1);
}
if (status === "model_missing") {
  console.log("Model not installed. Run: ollama pull <your AI_MODEL>");
  process.exit(1);
}

const answer = await provider.generateJson({
  system: "You return ONLY valid JSON and nothing else.",
  prompt: 'Return exactly this JSON: {"ok": true, "word": "hello"}',
});
console.log("Raw answer:", answer);
console.log("Parsed:", JSON.parse(answer));