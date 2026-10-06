import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { clipPaths, MAX_UPLOAD_BYTES } from "./paths.js";

test("builds private storage paths", () => {
  const ids = { userId: randomUUID(), projectId: randomUUID(), clipId: randomUUID() };
  const paths = clipPaths(ids);
  assert.equal(paths.video, `users/${ids.userId}/projects/${ids.projectId}/clips/${ids.clipId}.mp4`);
  assert.equal(paths.thumbnail, `users/${ids.userId}/projects/${ids.projectId}/thumbnails/${ids.clipId}.jpg`);
});

test("rejects ids that could escape the user's folder", () => {
  assert.throws(() => clipPaths({ userId: "../other", projectId: randomUUID(), clipId: randomUUID() }));
});

test("upload limit is 50 MB", () => {
  assert.equal(MAX_UPLOAD_BYTES, 52428800);
});
