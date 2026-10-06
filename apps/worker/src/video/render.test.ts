import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRenderArgs } from "./render.js";

test("render args crop to 9:16, burn captions and map audio", () => {
  const args = buildRenderArgs({
    sourcePath: "in.mp4",
    outputPath: "out.mp4",
    startSeconds: 5,
    endSeconds: 35,
    logoPath: null,
  });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.ok(graph.includes("ass=captions.ass"));
  assert.ok(graph.includes("scale=1080:1920"));
  assert.ok(!graph.includes("overlay"));
  assert.equal(args[args.indexOf("-t") + 1], "30.000");
  assert.ok(args.includes("0:a?"));
  assert.ok(args.includes("libx264"));
});

test("render args add a logo overlay when a logo is given", () => {
  const args = buildRenderArgs({
    sourcePath: "in.mp4",
    outputPath: "out.mp4",
    startSeconds: 0,
    endSeconds: 20,
    logoPath: "logo.png",
  });
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.ok(graph.includes("overlay"));
  assert.equal(args.filter((arg) => arg === "-i").length, 2);
});

test("rejects a clip that ends before it starts", () => {
  assert.throws(() =>
    buildRenderArgs({ sourcePath: "a", outputPath: "b", startSeconds: 10, endSeconds: 5 }),
  );
});