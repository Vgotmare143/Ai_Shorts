import assert from "node:assert/strict";
import { test } from "node:test";
import { OllamaProvider } from "./ollama.js";

test("reports not_running when Ollama is unreachable", async () => {
  const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:1", model: "anything" });
  assert.equal(await provider.checkStatus(), "not_running");
});
