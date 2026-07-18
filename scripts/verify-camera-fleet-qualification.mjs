#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { verifyCameraFleetQualification } from "../lib/camera-fleet-qualification.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.resolve(root, process.env.SANDFEST_CAMERA_FLEET_REPORT || ".sandfest-runtime/camera-fleet-qualification.json");
const configPath = path.resolve(root, process.env.SANDFEST_CAMERA_CONFIG || "camera_agent/config.example.json");

try {
  const [reportBytes, configBytes] = await Promise.all([
    readFile(reportPath),
    readFile(configPath)
  ]);
  const report = JSON.parse(reportBytes.toString("utf8"));
  const config = JSON.parse(configBytes.toString("utf8"));
  const result = verifyCameraFleetQualification(report, {
    maxAgeHours: Number(process.env.SANDFEST_CAMERA_FLEET_MAX_AGE_HOURS || 24),
    expectedConfigSha256: createHash("sha256").update(configBytes).digest("hex"),
    expectedModelSha256: String(config?.model?.sha256 || "").toLowerCase()
  });
  console.log(JSON.stringify({
    ...result,
    report: path.relative(root, reportPath),
    config: path.relative(root, configPath)
  }, null, 2));
  if (!result.ready) process.exitCode = 1;
} catch (error) {
  console.error(`camera fleet qualification verification failed: ${error.message}`);
  process.exitCode = 1;
}
