import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const API = `http://localhost:${process.env.API_PORT || 4000}`;
const N8N = process.env.N8N_BASE_URL || "http://localhost:5678";
const SECRET = process.env.N8N_WEBHOOK_SECRET;
const WEBHOOK = `${N8N}/webhook/ai-shorts-generate`;

if (!SECRET) {
  console.error("N8N_WEBHOOK_SECRET is missing in .env");
  process.exit(1);
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
function check(name, passed, detail = "") {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${passed || !detail ? "" : " - " + detail}`);
  if (!passed) failures += 1;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, url, { token, headers = {}, body } = {}) {
  const allHeaders = { ...headers };
  if (token) allHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined) allHeaders["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers: allHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
}

const internal = (method, path, body) =>
  call(method, `${API}${path}`, { headers: { "x-internal-secret": SECRET }, body });

async function waitForLog(jobId, text, seconds = 150) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const { data } = await admin
      .from("processing_logs")
      .select("message")
      .eq("job_id", jobId)
      .ilike("message", `%${text}%`);
    if (data && data.length > 0) return true;
    await sleep(4000);
  }
  return false;
}

const stamp = Date.now();
const email = `n8ntest${stamp}@example.com`;
const password = `Test-Pass-${stamp}!`;
let userId = null;

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;
  const login = await anon.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(login.error.message);
  const token = login.data.session.access_token;

  // Security checks
  const wrongInternal = await call("GET", `${API}/internal/jobs/${randomUUID()}`, {
    headers: { "x-internal-secret": "wrong" },
  });
  check("Internal API rejects a wrong secret (401)", wrongInternal.status === 401);

  const wrongHook = await call("POST", WEBHOOK, {
    headers: { "x-webhook-secret": "wrong" },
    body: { jobId: randomUUID(), projectId: randomUUID() },
  });
  check(
    "n8n rejects a wrong secret (401)",
    wrongHook.status === 401,
    `status ${wrongHook.status}${wrongHook.status === 404 ? " (workflow is not active)" : ""}`,
  );

  const badHook = await call("POST", WEBHOOK, {
    headers: { "x-webhook-secret": SECRET },
    body: { jobId: "not-a-uuid", projectId: "x" },
  });
  check("n8n rejects invalid ids (400)", badHook.status === 400, `status ${badHook.status}`);

  // Test A: n8n watches a job and finalizes it after a cancel
  const project = await call("POST", `${API}/projects`, {
    token,
    body: { sourceUrl: "https://youtu.be/dQw4w9WgXcQ" },
  });
  const projectId = project.json.project.id;
  const gen = await call("POST", `${API}/projects/${projectId}/generate`, { token });
  const jobId = gen.json.job.id;
  check("Job created (QUEUED)", gen.status === 201 && gen.json.job.status === "QUEUED");

  await sleep(4000);
  const seen = await internal("GET", `/internal/jobs/${jobId}`);
  check("Internal API returns the job", seen.status === 200 && seen.json.job.id === jobId);
  check("Worker is stopped (job still QUEUED)", seen.json?.job?.status === "QUEUED", "stop the worker for this test");

  const early = await internal("POST", `/internal/jobs/${jobId}/finalize`);
  check("Finalize is refused while the job is active (409)", early.status === 409);

  console.log("Cancelling the job. n8n should notice within about 30 seconds...");
  await call("POST", `${API}/jobs/${jobId}/cancel`, { token });
  const finalized = await waitForLog(jobId, "Workflow finished: CANCELLED");
  check(
    "n8n watched the job and finalized it",
    finalized,
    "no workflow log within 150s. Check the n8n Executions tab",
  );
  const projectRow = await admin.from("projects").select("status").eq("id", projectId).single();
  check("Project status is cancelled", projectRow.data?.status === "cancelled");

  // Test B: watchdog timeout produces a readable failure
  const gen2 = await call("POST", `${API}/projects/${projectId}/generate`, { token });
  const job2 = gen2.json.job.id;
  check("Second job created", gen2.status === 201);

  const timeout = await internal("POST", `/internal/jobs/${job2}/timeout`, { reason: "queued_too_long" });
  check("Timeout endpoint marks the job failed", timeout.status === 200 && timeout.json.updated === true);
  const failed = await admin.from("jobs").select("status,error_code,error_message").eq("id", job2).single();
  check(
    "Job is FAILED with a readable message",
    failed.data?.status === "FAILED" &&
      failed.data?.error_code === "TIMEOUT" &&
      String(failed.data?.error_message).startsWith("Processing did not start"),
  );
  const finalized2 = await waitForLog(job2, "Workflow finished: FAILED");
  check("n8n finalized the failed job", finalized2, "no workflow log within 150s");
  const project2 = await admin.from("projects").select("status").eq("id", projectId).single();
  check("Project status is failed", project2.data?.status === "failed");
} catch (error) {
  console.error("Test stopped early:", error.message);
  failures += 1;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}