import https from "node:https";
import { verifyPublicReviewBridge } from "../lib/public-review-bridge-verifier.mjs";

const target = new URL(process.argv[2] || "");
const forcedAddress = String(process.env.SANDFEST_PUBLIC_API_VERIFY_ADDRESS || "").trim();
if (target.protocol !== "https:" || target.username || target.password) {
  throw new Error("Pass the HTTPS Cloudflare Worker base URL as the first argument.");
}
if (forcedAddress && !/^(?:\d{1,3}\.){3}\d{1,3}$|^[a-f0-9:]+$/i.test(forcedAddress)) {
  throw new Error("SANDFEST_PUBLIC_API_VERIFY_ADDRESS must be an IPv4 or IPv6 address.");
}

function fetchTarget(url, init = {}) {
  if (!forcedAddress) return fetch(url, { redirect: "error", ...init });
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: init.method || "GET",
      headers: init.headers,
      lookup: (_hostname, options, callback) => {
        const address = { address: forcedAddress, family: forcedAddress.includes(":") ? 6 : 4 };
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      }
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: new Headers(response.headers),
        text: async () => Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.on("error", reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

const result = await verifyPublicReviewBridge({
  baseUrl: target.href,
  expectedBaseUrl: target.href,
  fetchImpl: fetchTarget
});
if (!result.ok) {
  for (const check of result.checks.filter(item => !item.ok)) {
    console.error(`${check.id}: ${check.detail}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Cloudflare public API live verification: ${result.summary.passed}/${result.summary.total} checks passed at ${target.origin}.`);
}
