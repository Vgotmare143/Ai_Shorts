import { config } from "./config.js";
import { claimNextJob, requeueStaleJobs } from "./jobs/db.js";
import { runJob } from "./jobs/pipeline.js";

const POLL_MS = 3000;
let stopping = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

process.on("SIGINT", () => {
  if (stopping) process.exit(0);
  stopping = true;
  console.log("\nStopping after the current job. Press Ctrl+C again to quit now.");
});

async function main(): Promise<void> {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
    process.exit(1);
  }

  try {
    const requeued = await requeueStaleJobs();
    if (requeued > 0) console.log(`Re-queued ${requeued} job(s) left unfinished by an earlier run.`);
  } catch (error) {
    console.error("Could not check for unfinished jobs (will keep going):", error instanceof Error ? error.message : error);
  }
  console.log("AI Shorts worker started. Waiting for jobs...");

  while (!stopping) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      console.log(`Job ${job.id} started (attempt ${job.attempts})`);
      await runJob(job);
      console.log(`Job ${job.id} finished`);
    } catch (error) {
      console.error("Worker loop error:", error instanceof Error ? error.message : error);
      await sleep(POLL_MS * 2);
    }
  }
}

await main();