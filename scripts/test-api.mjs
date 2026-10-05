import { createClient } from "@supabase/supabase-js";

const API = `http://localhost:${process.env.API_PORT || 4000}`;
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

async function call(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const stamp = Date.now();
const email = `apitest${stamp}@example.com`;
const password = `Test-Pass-${stamp}!`;
let userId = null;

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;
  const login = await anon.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error(login.error.message);
  const token = login.data.session.access_token;

  const health = await call("GET", "/health");
  check("GET /health works without login", health.status === 200 && health.json.services.database === true);
  console.log("      services:", JSON.stringify(health.json.services));

  check("GET /projects without token is 401", (await call("GET", "/projects")).status === 401);

  const bad = await call("POST", "/projects", token, { sourceUrl: "https://evil.com/x" });
  check("Bad URL is rejected (400)", bad.status === 400, bad.json?.error?.message);

  const created1 = await call("POST", "/projects", token, {
    sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
    clipCount: 3,
    durationRange: "30-60",
  });
  check("POST /projects creates a project (201)", created1.status === 201, JSON.stringify(created1.json));
  const projectId = created1.json.project.id;

  const list = await call("GET", "/projects", token);
  check("GET /projects lists it", list.status === 200 && list.json.projects.some((p) => p.id === projectId));

  const detail = await call("GET", `/projects/${projectId}`, token);
  check("GET /projects/:id works", detail.status === 200 && detail.json.project.id === projectId);

  const gen = await call("POST", `/projects/${projectId}/generate`, token);
  check("POST generate creates a QUEUED job (201)", gen.status === 201 && gen.json.job.status === "QUEUED");
  const jobId = gen.json.job.id;

  const gen2 = await call("POST", `/projects/${projectId}/generate`, token);
  check("Second generate is blocked (409)", gen2.status === 409);

  const job = await call("GET", `/jobs/${jobId}`, token);
  check("GET /jobs/:id works", job.status === 200 && job.json.job.status === "QUEUED");

  const cancel = await call("POST", `/jobs/${jobId}/cancel`, token);
  check("Cancel works", cancel.status === 200 && cancel.json.job.status === "CANCELLED");

  const retry = await call("POST", `/jobs/${jobId}/retry`, token);
  check("Retry works", retry.status === 200 && retry.json.job.status === "QUEUED");

  const clips = await call("GET", `/projects/${projectId}/clips`, token);
  check("GET clips returns an empty list", clips.status === 200 && clips.json.clips.length === 0);

  const del = await call("DELETE", `/projects/${projectId}`, token);
  check("DELETE project works (204)", del.status === 204);
} catch (error) {
  console.error("Test stopped early:", error.message);
  failures += 1;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}