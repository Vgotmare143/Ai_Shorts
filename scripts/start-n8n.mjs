import { spawn } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file
}

const secret = process.env.N8N_WEBHOOK_SECRET;
if (!secret) {
  console.error("N8N_WEBHOOK_SECRET is missing in .env");
  process.exit(1);
}
const apiPort = process.env.API_PORT || "4000";

const args = [
  "run", "--rm",
  "--name", "ai-shorts-n8n",
  "-p", "5678:5678",
  "-e", `N8N_WEBHOOK_SECRET=${secret}`,
  "-e", `AISHORTS_API_URL=http://host.docker.internal:${apiPort}`,
  "-e", "N8N_BLOCK_ENV_ACCESS_IN_NODE=false",
  "-v", "n8n_data:/home/node/.n8n",
  "docker.n8n.io/n8nio/n8n",
];

console.log("Starting n8n at http://localhost:5678 (Ctrl+C to stop)...");
const child = spawn("docker", args, { stdio: "inherit" });
child.on("error", () => {
  console.error("Docker is not available. Start Docker Desktop and try again.");
  process.exit(1);
});
child.on("exit", (code) => {
  if (code && code !== 130) {
    console.error("n8n stopped. If the name is already in use, run: docker stop ai-shorts-n8n");
  }
  process.exit(code ?? 0);
});