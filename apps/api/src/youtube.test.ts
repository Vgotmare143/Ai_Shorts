import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYouTubeUrl } from "./youtube.js";

test("accepts a normal watch URL", () => {
  const result = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s");
  assert.equal(result?.videoId, "dQw4w9WgXcQ");
  assert.equal(result?.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("accepts youtu.be and shorts URLs", () => {
  assert.equal(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")?.videoId, "dQw4w9WgXcQ");
  assert.equal(parseYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.videoId, "dQw4w9WgXcQ");
});

test("rejects other sites, http, and garbage", () => {
  assert.equal(parseYouTubeUrl("https://evil.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYouTubeUrl("http://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYouTubeUrl("not a url"), null);
  assert.equal(parseYouTubeUrl("https://www.youtube.com/watch?v=short"), null);
});
