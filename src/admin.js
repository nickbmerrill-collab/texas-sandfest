// Production ops console entry — separate bundle from the public visitor site.
// Load at /admin.html so visitor JS does not ship admin token UI or mutation panels.

import { escapeHtml, escapeAttr } from "../lib/html-escape.mjs";

const app = document.querySelector("#admin-app");

const defaultBase = () => {
  if (typeof location !== "undefined" && /localhost|127\.0\.0\.1/.test(location.hostname)) {
    return "http://127.0.0.1:8788";
  }
  return "https://api.heyelab.com/sandfest";
};

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/"><span class="brand-mark">TSF</span><span>Ops Console</span></a>
    <nav>
      <a href="#panels">Dashboards</a>
      <a href="/">Visitor site</a>
    </nav>
  </header>
  <main class="section admin-config-section" id="panels" style="padding:28px">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Enterprise admin</p>
        <h2>SandFest operations console</h2>
        <p class="section-copy">Isolated from the public visitor bundle. Use a strong admin token or JWT in production.</p>
      </div>
    </div>
    <div class="admin-api-bar">
      <label><span>API base</span><input id="admin-api-base" value="${escapeAttr(defaultBase())}" autocomplete="off" /></label>
      <label><span>Admin token</span><input id="admin-api-token" type="password" value="" placeholder="Bearer token" autocomplete="off" /></label>
      <button id="admin-load-all" class="button primary" type="button">Load all</button>
    </div>
    <p id="admin-status" class="checkout-status">Ready.</p>
    <div class="admin-revenue-kpis" id="admin-kpis">
      <article class="empty-state"><span>Load to populate KPIs.</span></article>
    </div>
    <div class="admin-fleet-breakdown" style="margin-top:20px">
      <div>
        <strong>Modules</strong>
        <div id="admin-module-list" class="admin-fleet-rows"></div>
      </div>
      <div>
        <strong>Jobs queue</strong>
        <div id="admin-jobs-list" class="admin-fleet-rows"></div>
      </div>
    </div>
  </main>
`;

function apiBase() {
  return document.querySelector("#admin-api-base").value.replace(/\/+$/, "");
}
function token() {
  return document.querySelector("#admin-api-token").value.trim();
}
function setStatus(msg, ok = true) {
  const el = document.querySelector("#admin-status");
  el.textContent = msg;
  el.dataset.state = ok ? "ok" : "error";
}

async function adminFetch(path) {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token()}`
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function kpi(label, value, sub = "") {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>${sub ? `<b>${escapeHtml(sub)}</b>` : ""}</article>`;
}

async function loadAll() {
  const btn = document.querySelector("#admin-load-all");
  btn.disabled = true;
  setStatus("Loading…");
  try {
    const [session, revenue, fleet, volunteers, consent, passport, voting, booths, jobs] = await Promise.all([
      adminFetch("/api/admin/session"),
      adminFetch("/api/admin/revenue").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/fleet").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/volunteers").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/consent").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/passport").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/voting").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/booths").catch(e => ({ error: e.message })),
      adminFetch("/api/admin/jobs?limit=12").catch(() => ({ jobs: [] }))
    ]);

    document.querySelector("#admin-kpis").innerHTML = [
      kpi("Role", session.session?.role || "—", session.session?.auth || ""),
      kpi("Revenue net", revenue.summary ? `$${(revenue.summary.totals.netCents / 100).toFixed(0)}` : "—", revenue.error || ""),
      kpi("Fleet out", fleet.summary?.totals?.openCheckouts ?? "—", fleet.error || `${fleet.summary?.totals?.assets ?? ""} assets`),
      kpi("Vol gaps", volunteers.summary?.totals?.openGaps ?? "—", volunteers.error || ""),
      kpi("Passport stamps", passport.summary?.totals?.stamps ?? "—", passport.error || ""),
      kpi("Votes", voting.summary?.totals?.totalVotes ?? "—", voting.error || ""),
      kpi("Booth pins", booths.summary?.totals?.publicPins ?? "—", booths.error || ""),
      kpi("SMS safety list", consent.safetyRecipientCount ?? consent.summary?.totals?.smsSafety ?? "—", consent.error || "")
    ].join("");

    const modules = [
      ["Revenue", !revenue.error],
      ["Fleet", !fleet.error],
      ["Volunteers", !volunteers.error],
      ["Consent", !consent.error],
      ["Passport", !passport.error],
      ["Voting", !voting.error],
      ["Booths", !booths.error]
    ];
    document.querySelector("#admin-module-list").innerHTML = modules.map(([name, ok]) => `
      <article>
        <div><strong>${escapeHtml(name)}</strong><span>${ok ? "loaded" : "error"}</span></div>
        <b>${ok ? "OK" : "ERR"}</b>
      </article>
    `).join("");

    const jobRows = (jobs.jobs || []).slice(0, 12);
    document.querySelector("#admin-jobs-list").innerHTML = jobRows.length
      ? jobRows.map(j => `
        <article>
          <div><strong>${escapeHtml(j.type)}</strong><span>${escapeHtml(j.id)}</span></div>
          <b>${escapeHtml(j.status)}</b>
          <em>try ${j.attempts}/${j.maxAttempts}</em>
        </article>
      `).join("")
      : '<article class="empty-state"><span>No jobs (or jobs endpoint unavailable).</span></article>';

    setStatus(`Loaded as ${session.session?.role}. Modules OK: ${modules.filter(m => m[1]).length}/${modules.length}.`);
  } catch (error) {
    setStatus(error.message, false);
  } finally {
    btn.disabled = false;
  }
}

document.querySelector("#admin-load-all").addEventListener("click", loadAll);
