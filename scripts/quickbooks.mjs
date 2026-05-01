#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { loadDotEnv } from "../lib/load-env.mjs";
import { buildAuthorizationUrl, getCompanyInfo, quickBooksQuery, quickBooksReadiness, refreshAccessToken } from "../lib/quickbooks/client.mjs";

await loadDotEnv();

const command = process.argv[2] || "status";

try {
  if (command === "status") {
    console.log(JSON.stringify(quickBooksReadiness(), null, 2));
  } else if (command === "auth-url") {
    const state = process.argv[3] || cryptoRandomState();
    console.log(buildAuthorizationUrl({ state }));
  } else if (command === "company-info") {
    const token = await refreshAccessToken();
    console.log(JSON.stringify(await getCompanyInfo({ accessToken: token.access_token }), null, 2));
  } else if (command === "open-invoices") {
    const token = await refreshAccessToken();
    const query = "SELECT * FROM Invoice WHERE Balance > '0' ORDER BY TxnDate DESC STARTPOSITION 1 MAXRESULTS 100";
    console.log(JSON.stringify(await quickBooksQuery(query, { accessToken: token.access_token }), null, 2));
  } else {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function cryptoRandomState() {
  return randomBytes(16).toString("hex");
}
