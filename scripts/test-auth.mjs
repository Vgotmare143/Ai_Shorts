import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

// Admin client: service role, bypasses RLS. Used only to set up and clean up.
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Anon client: behaves like the mobile app.
function newAnonClient() {
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

let failures = 0;
function check(name, passed, detail = "") {
  const label = passed ? "PASS" : "FAIL";
  console.log(`${label}  ${name}${detail ? " - " + detail : ""}`);
  if (!passed) failures += 1;
}

const stamp = Date.now();
const password = `Test-Pass-${stamp}!`;
const emailA = `usera${stamp}@example.com`;
const emailB = `userb${stamp}@example.com`;
const createdUserIds = [];

try {
  // 1. Create two users
  const resultA = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  const resultB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  check("Create user A", !resultA.error, resultA.error?.message);
  check("Create user B", !resultB.error, resultB.error?.message);
  if (resultA.error || resultB.error) throw new Error("Could not create test users");

  const userA = resultA.data.user;
  const userB = resultB.data.user;
  createdUserIds.push(userA.id, userB.id);

  // 2. The database trigger should have created a profile row
  const profile = await admin.from("profiles").select("id").eq("id", userA.id);
  check("Profile row created automatically", !profile.error && profile.data.length === 1, profile.error?.message);

  // 3. Create one project for each user (admin bypasses RLS)
  const projectA = await admin
    .from("projects")
    .insert({ user_id: userA.id, source_url: "https://www.youtube.com/watch?v=testA" })
    .select()
    .single();
  const projectB = await admin
    .from("projects")
    .insert({ user_id: userB.id, source_url: "https://www.youtube.com/watch?v=testB" })
    .select()
    .single();
  check("Create test projects", !projectA.error && !projectB.error, projectA.error?.message || projectB.error?.message);
  if (projectA.error || projectB.error) throw new Error("Could not create test projects");

  // 4. Log in as user A, like the mobile app would
  const clientA = newAnonClient();
  const login = await clientA.auth.signInWithPassword({ email: emailA, password });
  check("User A can log in", !login.error, login.error?.message);

  // 5. User A sees only their own project
  const ownProjects = await clientA.from("projects").select("id");
  check(
    "User A sees only their own project",
    !ownProjects.error && ownProjects.data.length === 1 && ownProjects.data[0].id === projectA.data.id,
    ownProjects.error?.message
  );

  // 6. User A cannot read user B's project directly
  const otherProject = await clientA.from("projects").select("id").eq("id", projectB.data.id);
  check("User A cannot read user B's project", !otherProject.error && otherProject.data.length === 0);

  // 7. User A cannot write directly (writes must go through the API)
  const directInsert = await clientA
    .from("projects")
    .insert({ user_id: userA.id, source_url: "https://www.youtube.com/watch?v=blocked" });
  check("Direct insert from the app is blocked", directInsert.error !== null);

  // 8. Templates are readable by logged-in users
  const templates = await clientA.from("templates").select("name");
  check("Templates readable (3 expected)", !templates.error && templates.data.length === 3, templates.error?.message);

  // 9. A logged-out client sees nothing
  const anonymous = newAnonClient();
  const anonProjects = await anonymous.from("projects").select("id");
  check("Logged-out client sees no projects", anonProjects.error !== null || anonProjects.data.length === 0);
} catch (error) {
  console.error("Test stopped early:", error.message);
  failures += 1;
} finally {
  // Clean up: deleting the user also deletes their profile and projects (cascade)
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}