#!/usr/bin/env node

import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { importPKCS8, SignJWT } from "jose";

const API = "https://api.appstoreconnect.apple.com/v1";
const bundleId = "com.portalcodex.texassandfest";
const versionString = "1.0.0";
const locale = "en-US";
const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
const keyPath = process.env.APP_STORE_CONNECT_KEY_PATH;
const confirmed = process.env.SANDFEST_CONFIRM_SCREENSHOT_UPLOAD === "YES";

if (!keyId || !issuerId || !keyPath) {
  console.error("Set APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID, and APP_STORE_CONNECT_KEY_PATH.");
  process.exit(2);
}

const privateKey = await importPKCS8(readFileSync(keyPath, "utf8"), "ES256");
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
  .setIssuer(issuerId)
  .setAudience("appstoreconnect-v1")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(privateKey);

async function request(resource, options = {}) {
  const response = await fetch(resource.startsWith("http") ? resource : `${API}${resource}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${options.method || "GET"} ${resource} failed (${response.status}): ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function only(resource, description) {
  const response = await request(resource);
  if (response.data.length !== 1) throw new Error(`Expected one ${description}; found ${response.data.length}.`);
  return response.data[0];
}

const app = await only(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`, "app");
const versionsResponse = await request(`/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=50`);
const version = versionsResponse.data.find((item) =>
  item.attributes.versionString === versionString || item.attributes.versionString === "1.0"
);
if (!version) {
  const found = versionsResponse.data.map((item) => item.attributes.versionString).join(", ") || "none";
  throw new Error(`Expected iOS version ${versionString} (or 1.0); found ${found}.`);
}
const localization = await only(
  `/appStoreVersions/${version.id}/appStoreVersionLocalizations?filter[locale]=${encodeURIComponent(locale)}`,
  `${locale} localization`
);
const setsResponse = await request(`/appStoreVersionLocalizations/${localization.id}/appScreenshotSets?limit=50`);

const groups = [
  { displayType: "APP_IPHONE_65", directory: "ios/AppStore/screenshots/iphone-6.5" },
  { displayType: "APP_IPAD_PRO_3GEN_129", directory: "ios/AppStore/screenshots/ipad-13" }
];

async function ensureSet(displayType) {
  const existing = setsResponse.data.find((item) => item.attributes.screenshotDisplayType === displayType);
  if (existing) return existing;
  return (await request("/appScreenshotSets", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localization.id } }
        }
      }
    })
  })).data;
}

async function uploadFile(screenshotSet, filePath) {
  const size = statSync(filePath).size;
  const reservation = (await request("/appScreenshots", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appScreenshots",
        attributes: { fileName: path.basename(filePath), fileSize: size },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: screenshotSet.id } } }
      }
    })
  })).data;

  const file = readFileSync(filePath);
  for (const operation of reservation.attributes.uploadOperations) {
    const headers = Object.fromEntries(operation.requestHeaders.map(({ name, value }) => [name, value]));
    const chunk = file.subarray(operation.offset, operation.offset + operation.length);
    const response = await fetch(operation.url, { method: operation.method, headers, body: chunk });
    if (!response.ok) throw new Error(`Asset upload failed for ${filePath} (${response.status}).`);
  }

  await request(`/appScreenshots/${reservation.id}`, {
    method: "PATCH",
    body: JSON.stringify({ data: { type: "appScreenshots", id: reservation.id, attributes: { uploaded: true } } })
  });
}

console.log(`Resolved ${app.attributes.name}: iOS ${version.attributes.versionString}, ${locale}.`);
for (const group of groups) {
  const files = (await import("node:fs/promises")).readdir(group.directory).then((names) =>
    names.filter((name) => /\.png$/i.test(name)).sort().map((name) => path.join(group.directory, name))
  );
  const paths = await files;
  console.log(`${group.displayType}: ${paths.length} prepared screenshot(s).`);
  if (!confirmed) {
    const existing = setsResponse.data.find((item) => item.attributes.screenshotDisplayType === group.displayType);
    if (existing) {
      const current = await request(`/appScreenshotSets/${existing.id}/appScreenshots?limit=50`);
      console.log(`${group.displayType}: ${current.data.length} screenshot(s) currently in App Store Connect.`);
    }
    continue;
  }
  const set = await ensureSet(group.displayType);
  const current = await request(`/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
  if (current.data.length) throw new Error(`${group.displayType} already contains ${current.data.length} screenshot(s); refusing to duplicate them.`);
  for (const filePath of paths) {
    await uploadFile(set, filePath);
    console.log(`Uploaded ${filePath}.`);
  }
  const verified = await request(`/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
  if (verified.data.length !== paths.length) {
    throw new Error(`${group.displayType} verification found ${verified.data.length} screenshot(s), expected ${paths.length}.`);
  }
  console.log(`Verified ${group.displayType}: ${verified.data.length} screenshot(s).`);
}

if (!confirmed) {
  console.log("Dry run only. Set SANDFEST_CONFIRM_SCREENSHOT_UPLOAD=YES to upload.");
}
