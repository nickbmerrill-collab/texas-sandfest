import { escapeHtml } from "../lib/html-escape.mjs";

let boardCapabilityProofStylesMounted = false;

function ensureBoardCapabilityProofStyles() {
  if (boardCapabilityProofStylesMounted || document.querySelector("[data-board-capability-proof-styles]")) return;
  boardCapabilityProofStylesMounted = true;
  const style = document.createElement("style");
  style.dataset.boardCapabilityProofStyles = "true";
  style.textContent = `
    .admin-board-capability-proof {
      border-bottom: 1px solid var(--line);
      display: grid;
      gap: 16px;
      padding: 20px 0 22px;
    }
    .admin-board-capability-proof[hidden] {
      display: none;
    }
    .admin-board-stage-summary {
      border-bottom: 1px solid var(--line);
      border-top: 1px solid var(--line);
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-top: 18px;
    }
    .admin-board-stage-summary > div {
      align-content: start;
      display: grid;
      gap: 6px;
      min-width: 0;
      padding: 17px 18px;
    }
    .admin-board-stage-summary > div + div {
      border-left: 1px solid var(--line);
    }
    .admin-board-stage-summary span {
      color: var(--gulf);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .admin-board-stage-summary strong {
      color: var(--deep);
      font-size: 15px;
    }
    .admin-board-stage-summary p {
      color: var(--muted);
      line-height: 1.5;
      margin: 0;
    }
    .admin-board-capability-proof > div:first-child {
      align-items: end;
      display: flex;
      gap: 18px;
      justify-content: space-between;
    }
    .admin-board-capability-proof h2,
    .admin-board-capability-proof p {
      margin: 0;
    }
    .admin-board-capability-proof h2 {
      font-family: var(--display-font);
      font-size: 32px;
    }
    #admin-board-capability-proof-status {
      color: #14764a;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.45;
      max-width: 620px;
      text-align: right;
    }
    .admin-board-capability-proof[data-state="warning"] #admin-board-capability-proof-status {
      color: var(--sun-ink);
    }
    .admin-board-capability-proof-actions {
      align-items: end;
      display: grid;
      gap: 8px;
      justify-items: end;
    }
    .admin-board-capability-proof-actions .button {
      min-height: 36px;
      white-space: nowrap;
    }
    .admin-board-capability-proof-summary {
      background: color-mix(in srgb, #14764a 9%, var(--white));
      border: 1px solid color-mix(in srgb, #14764a 28%, var(--line));
      border-radius: 6px;
      color: var(--deep);
      font-size: 14px;
      font-weight: 800;
      line-height: 1.45;
      padding: 13px 14px;
    }
    .admin-board-capability-proof-summary[data-state="warning"] {
      background: color-mix(in srgb, var(--sun) 14%, var(--white));
      border-color: color-mix(in srgb, var(--sun) 45%, var(--line));
    }
    .admin-board-capability-proof-scope {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .admin-board-capability-proof-scope span {
      background: var(--mist);
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--deep);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.25;
      padding: 7px 10px;
    }
    .admin-board-capability-proof-kpis {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .admin-board-capability-proof-kpis article,
    .admin-board-capability-proof-journeys article {
      background: var(--white);
      border: 1px solid var(--line);
      border-radius: 6px;
      min-width: 0;
    }
    .admin-board-capability-proof-kpis article {
      display: grid;
      gap: 6px;
      min-height: 84px;
      padding: 14px;
    }
    .admin-board-capability-proof-kpis span,
    .admin-board-capability-proof-journeys span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .admin-board-capability-proof-kpis strong {
      color: var(--deep);
      font-size: 15px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .admin-board-capability-proof-journeys {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .admin-board-capability-proof-journeys article {
      border-left: 4px solid #14764a;
      display: grid;
      gap: 5px;
      min-height: 86px;
      padding: 13px 14px 13px 12px;
    }
    .admin-board-capability-proof-journeys article[data-state="warning"] {
      border-left-color: var(--sun);
    }
    .admin-board-capability-proof-journeys strong {
      color: var(--deep);
      font-size: 14px;
      line-height: 1.3;
    }
    @media (max-width: 760px) {
      .admin-board-stage-summary {
        grid-template-columns: 1fr;
      }
      .admin-board-stage-summary > div + div {
        border-left: 0;
        border-top: 1px solid var(--line);
      }
      .admin-board-capability-proof > div:first-child {
        align-items: start;
        display: grid;
      }
      .admin-board-capability-proof-actions {
        justify-items: start;
      }
      #admin-board-capability-proof-status {
        max-width: none;
        text-align: left;
      }
      .admin-board-capability-proof-kpis,
      .admin-board-capability-proof-journeys {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.append(style);
}

function ensureBoardStageSummary() {
  const existing = document.querySelector("#admin-board-stage-summary");
  if (existing) return existing;
  const anchor = document.querySelector("#admin-launch-readiness");
  if (!anchor) return null;
  const section = document.createElement("section");
  section.id = "admin-board-stage-summary";
  section.className = "admin-board-stage-summary";
  section.setAttribute("aria-label", "Board presentation activation boundary");
  section.innerHTML = `
    <div data-board-stage="presentation-ready">
      <span>Board-ready</span>
      <strong>Real workflows with synthetic providers</strong>
      <p>Intake, receivables, key dates, delegated work, sponsor branding, outreach, and Island Conditions use the real application contracts.</p>
    </div>
    <div data-board-stage="post-presentation">
      <span>Post-board</span>
      <strong>Live provider activation</strong>
      <p>Connect Stripe, QuickBooks, Brevo, Twilio, NWS, TxDOT, eight webcam edge agents, OIDC, Turnstile, DNS, and managed recovery.</p>
    </div>
  `;
  anchor.insertAdjacentElement("beforebegin", section);
  return section;
}

function ensureBoardCapabilityProofSection() {
  const existing = document.querySelector("#admin-board-capability-proof");
  if (existing) return existing;
  const anchor = ensureBoardStageSummary();
  if (!anchor) return null;
  const section = document.createElement("section");
  section.id = "admin-board-capability-proof";
  section.className = "admin-board-capability-proof";
  section.setAttribute("aria-labelledby", "admin-board-capability-proof-title");
  section.hidden = true;
  section.innerHTML = `
    <div>
      <p class="eyebrow">Certification evidence</p>
      <h2 id="admin-board-capability-proof-title">Board capability proof</h2>
      <div class="admin-board-capability-proof-actions">
        <p id="admin-board-capability-proof-status">Waiting for certification evidence.</p>
        <button id="admin-board-capability-proof-copy" class="button secondary" type="button">Copy proof summary</button>
      </div>
    </div>
    <p id="admin-board-capability-proof-summary" class="admin-board-capability-proof-summary">Certification summary will appear after deployment checks load.</p>
    <div id="admin-board-capability-proof-scope" class="admin-board-capability-proof-scope" role="list" aria-label="Certified board capability scope"></div>
    <div id="admin-board-capability-proof-kpis" class="admin-board-capability-proof-kpis" aria-live="polite"></div>
    <div id="admin-board-capability-proof-journeys" class="admin-board-capability-proof-journeys"></div>
  `;
  anchor.insertAdjacentElement("afterend", section);
  return section;
}

function proofSourceLabel(proof) {
  return proof?.source?.commit
    ? `${proof.source.branch || "source"}@${String(proof.source.commit).slice(0, 8)}`
    : "source unavailable";
}

function browserProofLabel(proof, conditionLabel) {
  return (proof?.browsers || [])
    .map(item => `${conditionLabel(item.engine)} ${item.passed}/${item.total}`)
    .join(", ") || "browser proof missing";
}

export function presenterSummary(proof, conditionLabel = value => String(value || "")) {
  if (proof?.ok !== true) {
    return (proof?.errors || ["Run board capability certification before presenting."]).join(" ");
  }
  const journeyCount = Number(proof?.journeyCount || 0);
  const requiredJourneyCount = Number(proof?.requiredJourneyCount || 0);
  const capabilityCount = Number(proof?.certifiedCapabilities?.length || 0);
  const deferredCount = Number(proof?.deferredProductionGates?.length || 0);
  return `Board proof is current for ${proofSourceLabel(proof)}: ${journeyCount}/${requiredJourneyCount} certified journeys, ${browserProofLabel(proof, conditionLabel)}, ${capabilityCount} certified capabilities, and ${deferredCount} live-provider gates held for post-board activation.`;
}

async function copyProofSummary(text, status) {
  try {
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = "Proof summary copied for the presenter.";
  } catch {
    if (status) status.textContent = text;
  }
}

export function renderBoardCapabilityProof(proof, { conditionLabel = value => String(value || "") } = {}) {
  const section = ensureBoardCapabilityProofSection();
  if (!section) return;
  ensureBoardCapabilityProofStyles();
  const status = document.querySelector("#admin-board-capability-proof-status");
  const summary = document.querySelector("#admin-board-capability-proof-summary");
  const scope = document.querySelector("#admin-board-capability-proof-scope");
  const copyButton = document.querySelector("#admin-board-capability-proof-copy");
  const kpis = document.querySelector("#admin-board-capability-proof-kpis");
  const journeys = document.querySelector("#admin-board-capability-proof-journeys");
  section.hidden = false;
  const certified = proof?.ok === true;
  section.dataset.state = certified ? "ok" : "warning";
  const age = Number.isFinite(proof?.ageMinutes) ? `${proof.ageMinutes} min old` : "age unavailable";
  const completed = proof?.completedAt ? new Date(proof.completedAt).toLocaleString() : "not certified";
  if (status) {
    status.textContent = certified
      ? `Certified ${completed} · ${age} · live-provider activation remains post-board.`
      : (proof?.errors || ["Run board capability certification before presenting."]).join(" ");
  }
  const summaryText = presenterSummary(proof, conditionLabel);
  if (summary) {
    summary.textContent = summaryText;
    summary.dataset.state = certified ? "ok" : "warning";
  }
  if (copyButton) {
    copyButton.disabled = !summaryText;
    copyButton.onclick = () => copyProofSummary(summaryText, status);
  }
  if (scope) {
    const capabilities = (proof?.certifiedCapabilities || []).slice(0, 12);
    scope.innerHTML = capabilities.map(item => `<span role="listitem">${escapeHtml(conditionLabel(item))}</span>`).join("");
  }
  const browserText = browserProofLabel(proof, conditionLabel).replaceAll(", ", " · ");
  const sourceText = proofSourceLabel(proof);
  if (kpis) {
    kpis.innerHTML = [
      ["Journeys", `${Number(proof?.journeyCount || 0)}/${Number(proof?.requiredJourneyCount || 0)}`],
      ["Browsers", browserText],
      ["Source", sourceText],
      ["Deferred", `${Number(proof?.deferredProductionGates?.length || 0)} post-board gates`]
    ].map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
  }
  if (journeys) {
    journeys.innerHTML = (proof?.journeys || []).map(item => `<article data-state="${item.ok ? "ok" : "warning"}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml((item.capabilities || []).map(conditionLabel).join(" · "))}</span>
    </article>`).join("") || '<article data-state="warning"><strong>No journey evidence loaded</strong><span>Run board certification before presenting.</span></article>';
  }
}
