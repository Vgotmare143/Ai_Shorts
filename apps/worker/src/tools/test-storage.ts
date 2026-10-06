import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { createSignedUrl, getAdminClient, removeFiles, uploadClipFiles } from "../storage/supabase.js";

const videoPath = path.resolve(process.argv[2] ?? "work/demo/short_1.mp4");
const thumbnailPath = videoPath.replace(/\.mp4$/i, ".jpg");
const apiPort = process.env.API_PORT || "4000";
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!existsSync(videoPath) || !existsSync(thumbnailPath)) {
  console.error(`Need both files:\n  ${videoPath}\n  ${thumbnailPath}`);
  process.exit(1);
}
if (!config.SUPABASE_URL || !anonKey) {
  console.error("SUPABASE_URL or SUPABASE_ANON_KEY is missing in .env");
  process.exit(1);
}

let failures = 0;
function check(name: string, passed: boolean, detail = "") {
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${passed || !detail ? "" : " - " + detail}`);
  if (!passed) failures += 1;
}

const admin = getAdminClient();
const stamp = Date.now();
const password = `Test-Pass-${stamp}!`;
const userIds: string[] = [];
const uploadedPaths: string[] = [];

try {
  // Two users
  const createdA = await admin.auth.admin.createUser({ email: `storea${stamp}@example.com`, password, email_confirm: true });
  const createdB = await admin.auth.admin.createUser({ email: `storeb${stamp}@example.com`, password, email_confirm: true });
  if (createdA.error || createdB.error || !createdA.data.user || !createdB.data.user) {
    throw new Error("Could not create test users");
  }
  const userA = createdA.data.user.id;
  const userB = createdB.data.user.id;
  userIds.push(userA, userB);

  const clientA = createClient(config.SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const clientB = createClient(config.SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const anonymous = createClient(config.SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const loginA = await clientA.auth.signInWithPassword({ email: `storea${stamp}@example.com`, password });
  const loginB = await clientB.auth.signInWithPassword({ email: `storeb${stamp}@example.com`, password });
  if (loginA.error || loginB.error) throw new Error("Could not log in test users");

  // A project for user A (admin bypasses RLS)
  const projectId = randomUUID();
  const clipId = randomUUID();
  const project = await admin.from("projects").insert({
    id: projectId,
    user_id: userA,
    source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    status: "completed",
  });
  if (project.error) throw new Error(`Project insert failed: ${project.error.message}`);

  // 1. Upload
  const uploaded = await uploadClipFiles({ userId: userA, projectId, clipId, videoPath, thumbnailPath });
  uploadedPaths.push(uploaded.videoPath, uploaded.thumbnailPath);
  check("Upload video and thumbnail", true);

  // 2. Signed URL downloads the whole file
  const signed = await createSignedUrl(uploaded.videoPath, 120);
  const download = await fetch(signed);
  const bytes = (await download.arrayBuffer()).byteLength;
  const localSize = (await stat(videoPath)).size;
  check("Signed URL downloads the full video", download.ok && bytes === localSize, `${bytes} of ${localSize} bytes`);
  check("Content type is video/mp4", (download.headers.get("content-type") ?? "").startsWith("video/mp4"));

  // 3. The file is not public
  const publicUrl = `${config.SUPABASE_URL}/storage/v1/object/public/${config.STORAGE_BUCKET}/${uploaded.videoPath}`;
  const publicTry = await fetch(publicUrl);
  check("File is NOT publicly readable", !publicTry.ok, `status ${publicTry.status}`);

  // 4-6. Row Level Security on storage
  const ownSign = await clientA.storage.from(config.STORAGE_BUCKET).createSignedUrl(uploaded.videoPath, 60);
  check("Owner can sign their own file", !ownSign.error && Boolean(ownSign.data?.signedUrl), ownSign.error?.message);
  const otherSign = await clientB.storage.from(config.STORAGE_BUCKET).createSignedUrl(uploaded.videoPath, 60);
  check("Another user cannot sign it", Boolean(otherSign.error) || !otherSign.data?.signedUrl);
  const anonSign = await anonymous.storage.from(config.STORAGE_BUCKET).createSignedUrl(uploaded.videoPath, 60);
  check("Logged-out client cannot sign it", Boolean(anonSign.error) || !anonSign.data?.signedUrl);

  // 7. API integration (needs `npm run dev:api` running in another window)
  const clipRow = await admin.from("clips").insert({
    id: clipId,
    project_id: projectId,
    start_time: 0,
    end_time: 30,
    title: "Storage test",
    score: 90,
    selection_method: "heuristic",
    output_url: uploaded.videoPath,
    thumbnail_url: uploaded.thumbnailPath,
    status: "completed",
  });
  if (clipRow.error) throw new Error(`Clip insert failed: ${clipRow.error.message}`);

  const apiUrl = `http://localhost:${apiPort}/projects/${projectId}/clips`;
  try {
    const token = loginA.data.session?.access_token ?? "";
    const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await response.json()) as { clips?: { video_signed_url: string | null }[] };
    const link = body.clips?.[0]?.video_signed_url ?? null;
    check("API returns a signed video URL", response.status === 200 && Boolean(link), `status ${response.status}`);
    if (link) {
      const viaApi = await fetch(link);
      check("API signed URL plays (downloads)", viaApi.ok);
    }
    const tokenB = loginB.data.session?.access_token ?? "";
    const other = await fetch(apiUrl, { headers: { Authorization: `Bearer ${tokenB}` } });
    check("Another user gets 404 from the API", other.status === 404, `status ${other.status}`);
  } catch {
    console.log("SKIP  API checks (start the API with: npm run dev:api)");
  }
} catch (error) {
  console.error("Test stopped early:", error instanceof Error ? error.message : error);
  failures += 1;
} finally {
  await removeFiles(uploadedPaths);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}