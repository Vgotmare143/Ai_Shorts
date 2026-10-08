import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const VALIDATE_CODE = `const request = $input.first().json;
const secret = request.headers ? request.headers['x-webhook-secret'] : '';
const body = request.body || {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const expected = $env.N8N_WEBHOOK_SECRET;

if (!expected || secret !== expected) {
  return [{ json: { valid: false, statusCode: 401, error: 'Unauthorized' } }];
}
if (!uuid.test(body.jobId || '') || !uuid.test(body.projectId || '')) {
  return [{ json: { valid: false, statusCode: 400, error: 'jobId and projectId must be UUIDs' } }];
}
return [{ json: { valid: true, jobId: body.jobId, projectId: body.projectId, startedAt: Date.now() } }];`;

const CHECK_CODE = `const FINISHED = ['COMPLETED', 'FAILED', 'CANCELLED'];
const MINUTE = 60 * 1000;
const startedAt = $('Validate request').first().json.startedAt;
const now = Date.now();
const job = $json.job;

if (!job) {
  // The API could not be reached. Keep trying, but not forever.
  return [{ json: { done: false, timeout: now - startedAt > 6 * 60 * MINUTE, reason: 'running_too_long', status: 'UNKNOWN' } }];
}
if (FINISHED.includes(job.status)) {
  return [{ json: { done: true, timeout: false, status: job.status } }];
}
const sinceUpdate = now - new Date(job.updated_at).getTime();
if (job.status === 'QUEUED' && sinceUpdate > 10 * MINUTE) {
  return [{ json: { done: false, timeout: true, reason: 'queued_too_long', status: job.status } }];
}
if (job.status !== 'QUEUED' && sinceUpdate > 60 * MINUTE) {
  return [{ json: { done: false, timeout: true, reason: 'stalled', status: job.status } }];
}
if (now - startedAt > 6 * 60 * MINUTE) {
  return [{ json: { done: false, timeout: true, reason: 'running_too_long', status: job.status } }];
}
return [{ json: { done: false, timeout: false, status: job.status, progress: job.progress } }];`;

const jobUrl = (suffix = "") =>
  `={{ $env.AISHORTS_API_URL + '/internal/jobs/' + $('Validate request').first().json.jobId + '${suffix}' }}`;

const secretHeader = {
  parameters: [{ name: "x-internal-secret", value: "={{ $env.N8N_WEBHOOK_SECRET }}" }],
};

const nodes = [
  {
    id: "n1", name: "Webhook", type: "n8n-nodes-base.webhook", typeVersion: 2,
    position: [0, 300], webhookId: randomUUID(),
    parameters: { httpMethod: "POST", path: "ai-shorts-generate", responseMode: "responseNode", options: {} },
  },
  {
    id: "n2", name: "Validate request", type: "n8n-nodes-base.code", typeVersion: 2,
    position: [220, 300], parameters: { jsCode: VALIDATE_CODE },
  },
  {
    id: "n3", name: "Valid request?", type: "n8n-nodes-base.if", typeVersion: 1,
    position: [440, 300],
    parameters: { conditions: { boolean: [{ value1: "={{ $json.valid }}", value2: true }] } },
  },
  {
    id: "n4", name: "Respond accepted", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1,
    position: [660, 200],
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ accepted: true, jobId: $json.jobId }) }}",
      options: { responseCode: 202 },
    },
  },
  {
    id: "n5", name: "Respond rejected", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1,
    position: [660, 420],
    parameters: {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ accepted: false, error: $json.error }) }}",
      options: { responseCode: "={{ $json.statusCode }}" },
    },
  },
  {
    id: "n6", name: "Wait 15s", type: "n8n-nodes-base.wait", typeVersion: 1.1,
    position: [880, 200], parameters: { amount: 15, unit: "seconds" },
  },
  {
    id: "n7", name: "Get job", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
    position: [1100, 200], onError: "continueRegularOutput",
    parameters: {
      method: "GET", url: jobUrl(), sendHeaders: true, headerParameters: secretHeader,
      options: { timeout: 15000 },
    },
  },
  {
    id: "n8", name: "Check job", type: "n8n-nodes-base.code", typeVersion: 2,
    position: [1320, 200], parameters: { jsCode: CHECK_CODE },
  },
  {
    id: "n9", name: "Finished?", type: "n8n-nodes-base.if", typeVersion: 1,
    position: [1540, 200],
    parameters: { conditions: { boolean: [{ value1: "={{ $json.done }}", value2: true }] } },
  },
  {
    id: "n10", name: "Timed out?", type: "n8n-nodes-base.if", typeVersion: 1,
    position: [1760, 380],
    parameters: { conditions: { boolean: [{ value1: "={{ $json.timeout }}", value2: true }] } },
  },
  {
    id: "n11", name: "Mark timed out", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
    position: [1980, 300], onError: "continueRegularOutput",
    parameters: {
      method: "POST", url: jobUrl("/timeout"), sendHeaders: true, headerParameters: secretHeader,
      sendBody: true, contentType: "json", specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ reason: $json.reason }) }}",
      options: { timeout: 15000 },
    },
  },
  {
    id: "n12", name: "Finalize job", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
    position: [2200, 120],
    parameters: {
      method: "POST", url: jobUrl("/finalize"), sendHeaders: true, headerParameters: secretHeader,
      options: { timeout: 15000 },
    },
  },
];

const connect = (node) => ({ node, type: "main", index: 0 });
const link = (node) => ({ main: [[connect(node)]] });

const connections = {
  Webhook: link("Validate request"),
  "Validate request": link("Valid request?"),
  "Valid request?": { main: [[connect("Respond accepted")], [connect("Respond rejected")]] },
  "Respond accepted": link("Wait 15s"),
  "Wait 15s": link("Get job"),
  "Get job": link("Check job"),
  "Check job": link("Finished?"),
  "Finished?": { main: [[connect("Finalize job")], [connect("Timed out?")]] },
  "Timed out?": { main: [[connect("Mark timed out")], [connect("Wait 15s")]] },
  "Mark timed out": link("Finalize job"),
};

const workflow = {
  name: "AI Shorts - Generate",
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  active: false,
};

mkdirSync("n8n/workflows", { recursive: true });
writeFileSync("n8n/workflows/ai-shorts-generate.json", JSON.stringify(workflow, null, 2));
console.log("Wrote n8n/workflows/ai-shorts-generate.json");
