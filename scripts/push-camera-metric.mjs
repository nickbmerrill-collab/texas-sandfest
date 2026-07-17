#!/usr/bin/env node
// Signs and posts one metrics-only observation produced by a local camera worker.

import { readFile } from "node:fs/promises";
import { signCameraPayload } from "../lib/camera-ingest.mjs";

const apiBase = String(process.env.SANDFEST_API_BASE || "http://127.0.0.1:8806").replace(/\/$/, "");
const cameraId = String(process.env.CAMERA_ID || "").trim();
const sourceId = String(process.env.CAMERA_SOURCE_ID || "").trim();
const keyId = String(process.env.CAMERA_INGEST_KEY_ID || "").trim();
const secret = String(process.env.CAMERA_INGEST_SECRET || "");
const args = process.argv.slice(2);
const pushKind = args.includes("--heartbeat") || process.env.CAMERA_PUSH_KIND === "heartbeat" ? "heartbeat" : "observation";
const inputPath = args.find(arg => !arg.startsWith("--")) || "-";

if (!cameraId) throw new Error("CAMERA_ID is required");
if (!sourceId) throw new Error("CAMERA_SOURCE_ID is required");
if (secret.length < 32) throw new Error("CAMERA_INGEST_SECRET must be at least 32 characters");

async function readInput() {
  if (inputPath !== "-") return readFile(inputPath, "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const input = JSON.parse(await readInput());
if (pushKind === "observation" && !input.eventId) throw new Error("Observation JSON must include a stable eventId for retry safety");
if (pushKind === "heartbeat" && !input.heartbeatId) throw new Error("Heartbeat JSON must include a stable heartbeatId for retry safety");
const payload = {
  ...input,
  sourceId,
  observedAt: input.observedAt || new Date().toISOString()
};
const rawBody = JSON.stringify(payload);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = signCameraPayload(rawBody, timestamp, secret, { keyId });
const endpoint = pushKind === "heartbeat" ? "heartbeat" : "observations";
const response = await fetch(`${apiBase}/api/ingest/cameras/${encodeURIComponent(cameraId)}/${endpoint}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-sandfest-timestamp": timestamp,
    "x-sandfest-signature": `sha256=${signature}`,
    ...(keyId ? { "x-sandfest-camera-key-id": keyId } : {})
  },
  body: rawBody
});
const body = await response.text();
if (!response.ok) throw new Error(`Camera ${pushKind} ingest failed: ${response.status} ${body}`);
process.stdout.write(`${body}\n`);
