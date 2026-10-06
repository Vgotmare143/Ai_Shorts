import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { getAdminClient, removeFiles } from "../storage/supabase.js";

const [url, ...flags] = process.argv.slice(2);
if (!url || !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(url)) {
  console.error('Usage: tsx test-pipeline.ts "https://www.youtube.com/watch?v=XXXXXXXXXXX" [--count 2] [--range 30-60] [--template Highlight]');
  process.exit(1);
}

function flag(name: string): string | undefined {
  const index = flags.indexOf(`--${name}`);
  return index !== -1 ? flags[index + 1] : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const admin = getAdminClient();
const stamp = Date.now();
const email = `pipeline${stamp}@example.com`;
const password = `Test-Pass-${stamp}!`;
let userId: string | null = null;
const storagePaths: string[] = [];
let failures = 0;

function check(name: string, passed: boolean, detail = "") {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${passed || !detail ? "" : " - " + detail}`);
  if (!passed) failures += 1;
}

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Could not create the test user");
  userId = created.data.user.id;

  const videoId = url.slice(-11);
  const project = await admin
    .from("projects")
    .insert({
      user_id: userId,
      source_url: url,
      settings: {
        videoId,
        clipCount: Number(flag("count") ?? 2),
        durationRange: flag("range") ?? "30-60",
        captionTemplate: flag("template") ?? "Highlight",
      },
    })
    .select("id")
    .single();
  if (project.error) throw new Error(`Project insert failed: ${project.error.message}`);
  const projectId = project.data.id as string;

  const job = await admin
    .from("jobs")
    .insert({ project_id: projectId, status: "QUEUED", current_step: "Queued" })
    .select("id")
    .single();
  if (job.error) throw new Error(`Job insert failed: ${job.error.message}`);
  const jobId = job.data.id as string;

  console.log("Job queued. Make sure the worker is running (npm run dev:worker).\n");

  // Watch the REAL status from the database
  const startedAt = Date.now();
  let lastLine = "";
  let finalStatus = "";
  while (Date.now() - startedAt < 45 * 60_000) {
    const { data } = await admin
      .from("jobs")
      .select("status,progress,current_step,error_message")
      .eq("id", jobId)
      .single();
    if (data) {
      const line = `${String(data.progress).padStart(3)}%  ${data.status}  ${data.current_step ?? ""}`;
      if (line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(data.status)) {
        finalStatus = data.status;
        if (data.error_message) console.log(`Error shown to the user: ${data.error_message}`);
        break;
      }
    }
    await sleep(3000);
  }
  console.log("");

  check("Job completed", finalStatus === "COMPLETED", `final status: ${finalStatus || "timed out"}`);

  const clips = await admin
    .from("clips")
    .select("id,title,score,selection_method,start_time,end_time,status,output_url,thumbnail_url")
    .eq("project_id", projectId);
  const rows = clips.data ?? [];
  check("Clips were created", rows.length > 0, `${rows.length} clip(s)`);

  const outDir = path.resolve("work/pipeline_test");
  await mkdir(outDir, { recursive: true });

  for (const [index, clip] of rows.entries()) {
    if (clip.output_url) storagePaths.push(clip.output_url as string);
    if (clip.thumbnail_url) storagePaths.push(clip.thumbnail_url as string);
    console.log(`  Short ${index + 1}: "${clip.title}" score ${clip.score} (${clip.selection_method}) ${clip.start_time}s-${clip.end_time}s`);

    if (!clip.output_url) {
      check(`Short ${index + 1} uploaded`, false, `clip status: ${clip.status}`);
      continue;
    }
    const signed = await admin.storage.from(config.STORAGE_BUCKET).createSignedUrl(clip.output_url as string, 300);
    const response = signed.data ? await fetch(signed.data.signedUrl) : null;
    const bytes = response?.ok ? Buffer.from(await response.arrayBuffer()) : null;
    check(`Short ${index + 1} uploaded and downloadable`, Boolean(bytes && bytes.length > 10_000));
    if (bytes) await writeFile(path.join(outDir, `short_${index + 1}.mp4`), bytes);
  }

  const logs = await admin
    .from("processing_logs")
    .select("level,step,message")
    .eq("job_id", jobId)
    .order("created_at");
  console.log("\nProcessing log:");
  for (const entry of logs.data ?? []) console.log(`  [${entry.level}] ${entry.step}: ${entry.message}`);

  console.log(`\nDownloaded Shorts are in: ${outDir}`);
} catch (error) {
  console.error("Test stopped early:", error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  await removeFiles(storagePaths);
  if (userId) await admin.auth.admin.deleteUser(userId); // deletes the project, job and clips too
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}