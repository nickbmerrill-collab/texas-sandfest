const TEMPLATE = "event_id,sculptor_id,sculptor_name,division,hometown,returning,bio,instagram,entry_id,entry_title,statement,status,beach_marker,map_x,map_y\n";
const find = selector => document.querySelector(selector);

let controls;
let previewHash;
let state;
let bound = false;

function render(data) {
  state = data;
  const readiness = data.readiness || {};
  const summary = data.summary || {};
  const roster = data.roster || {};
  const status = find("#admin-sculptor-roster-status");
  const kpis = find("#admin-sculptor-roster-kpis");
  if (status) status.textContent = `${readiness.reason || "Roster publication is pending."}${roster.meta?.holdReason ? ` Hold: ${roster.meta.holdReason}` : ""}`;
  if (kpis) {
    const cards = [
      ["Sculptors", Number(summary.sculptors || 0), readiness.ready ? "published" : "held"],
      ["Entries", Number(summary.entries || 0), `${Number(summary.imports || 0)} publications`],
      ["Passport", summary.passportActive ? "Active" : "Closed", "visitor stamps"],
      ["People's Choice", summary.votingOpen ? "Open" : "Closed", "public ballot"]
    ];
    kpis.innerHTML = cards.map(([label, value, detail]) => `<article><span>${label}</span><strong>${value}</strong><b>${detail}</b></article>`).join("");
  }
  const importForm = find("#admin-import-sculptors");
  if (importForm && !importForm.dataset.edited) {
    importForm.elements.sourceUrl.value = roster.meta?.sourceUrl || "https://www.texassandfest.org/sculptors";
    importForm.elements.sourceCheckedAt.value = controls.isoToLocalDateTime(roster.meta?.sourceCheckedAt || new Date().toISOString());
  }
  const engagement = find("#admin-sculptor-engagement");
  if (engagement) {
    engagement.elements.passportActive.checked = summary.passportActive === true;
    engagement.elements.votingOpen.checked = summary.votingOpen === true;
    engagement.querySelector("button").disabled = !readiness.ready || !controls.adminCan("content:write");
  }
}

export async function load({ quiet = false } = {}) {
  const button = find("#admin-load-sculptors");
  if (button) button.disabled = true;
  try {
    const data = await controls.adminFetch("/api/admin/sculptors");
    render(data);
    if (!quiet) controls.setAdminStatus(data.readiness?.reason || "Sculptor roster loaded.", data.readiness?.ready ? "ok" : "warning");
    return data;
  } catch (error) {
    if (!quiet) controls.setAdminStatus(error.message, "error");
    throw error;
  } finally {
    if (button) button.disabled = !controls.adminCan("admin:read");
  }
}

async function importPayload(form) {
  const file = form.elements.rosterFile.files?.[0];
  if (!file) throw new Error("Choose a sculptor roster CSV.");
  if (file.size > 5_000_000) throw new Error("The sculptor roster is larger than the 5 MB import limit.");
  return {
    csv: await file.text(),
    fileName: file.name,
    sourceUrl: form.elements.sourceUrl.value,
    sourceCheckedAt: controls.localDateTimeToIso(form.elements.sourceCheckedAt.value),
    currentEventConfirmed: form.elements.currentEventConfirmed.checked
  };
}

function showImport(result, committed = false) {
  const output = find("#admin-sculptor-import-result");
  const summary = result.summary || {};
  const invalid = Number(summary.invalid || 0);
  output.dataset.state = invalid ? "warning" : "ok";
  const issues = (result.errors || []).slice(0, 10).map(item => `Row ${item.row || "?"}: ${item.error || "Invalid row"}`).join(" ");
  output.textContent = committed
    ? `${Number(summary.valid || 0)} valid sculptors published to the public map, passport, and People's Choice ballot.`
    : `${Number(summary.valid || 0)} valid, ${invalid} requiring review. Preview only.${issues ? ` ${issues}` : ""}`;
}

function clearPreview(keepResult = false) {
  previewHash = null;
  const commit = find("#admin-commit-sculptor-import");
  commit.hidden = true;
  commit.disabled = true;
  commit.textContent = "Publish roster";
  if (!keepResult) find("#admin-sculptor-import-result").replaceChildren();
}

async function refreshEngagement() {
  await Promise.all([
    controls.adminCan("passport:read") && controls.loadAdminPassport({ quiet: true }),
    controls.adminCan("voting:read") && controls.loadAdminVoting({ quiet: true })
  ]);
}

async function perform(button, work, restore = () => { button.disabled = !controls.adminCan("content:write"); }) {
  button.disabled = true;
  try {
    return await work();
  } catch (error) {
    controls.setAdminStatus(error.message, "error");
    return null;
  } finally {
    restore();
  }
}

export function bind(options) {
  controls = options;
  if (bound) return;
  bound = true;
  find("#admin-load-sculptors")?.addEventListener("click", () => load());
  find("#admin-download-sculptor-template")?.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "sandfest-sculptor-roster-template.csv" });
    link.click();
    URL.revokeObjectURL(url);
  });

  const importForm = find("#admin-import-sculptors");
  importForm?.addEventListener("input", () => {
    importForm.dataset.edited = "true";
    clearPreview();
  });
  importForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter;
    const result = await perform(button, async () => controls.adminFetch("/api/admin/sculptors/import", {
      method: "POST",
      body: JSON.stringify({ ...await importPayload(importForm), mode: "preview" })
    }));
    if (!result) return clearPreview();
    previewHash = result.previewHash;
    showImport(result);
    const commit = find("#admin-commit-sculptor-import");
    const valid = Number(result.summary?.valid || 0);
    const invalid = Number(result.summary?.invalid || 0);
    commit.hidden = false;
    commit.disabled = valid < 1 || invalid > 0;
    commit.textContent = `Publish ${valid} sculptor${valid === 1 ? "" : "s"}`;
    controls.setAdminStatus(`Previewed ${valid} sculptor${valid === 1 ? "" : "s"}${invalid ? ` with ${invalid} issues` : ""}.`, invalid ? "warning" : "ok");
  });

  find("#admin-commit-sculptor-import")?.addEventListener("click", async event => {
    if (!previewHash) return;
    const button = event.currentTarget;
    const result = await perform(button, async () => controls.adminFetch("/api/admin/sculptors/import", {
      method: "POST",
      body: JSON.stringify({ ...await importPayload(importForm), mode: "commit", previewHash })
    }), () => { if (!button.hidden) button.disabled = !controls.adminCan("content:write"); });
    if (!result) return;
    showImport({ ...result, summary: result.importSummary }, true);
    clearPreview(true);
    importForm.reset();
    delete importForm.dataset.edited;
    render(result);
    await refreshEngagement();
    controls.setAdminStatus(`Published ${result.importSummary?.valid || 0} sculptors to every visitor experience.`, "ok");
  });

  const engagement = find("#admin-sculptor-engagement");
  engagement?.addEventListener("submit", async event => {
    event.preventDefault();
    const result = await perform(event.submitter, () => controls.adminFetch("/api/admin/sculptors/engagement", {
      method: "PATCH",
      body: JSON.stringify({
        passportActive: engagement.elements.passportActive.checked,
        votingOpen: engagement.elements.votingOpen.checked
      })
    }), () => { event.submitter.disabled = !state?.readiness?.ready || !controls.adminCan("content:write"); });
    if (!result) return;
    render(result);
    await refreshEngagement();
    controls.setAdminStatus("Visitor engagement controls saved.", "ok");
  });

  const hold = find("#admin-hold-sculptors");
  hold?.addEventListener("submit", async event => {
    event.preventDefault();
    const result = await perform(event.submitter, () => controls.adminFetch("/api/admin/sculptors/hold", {
      method: "POST",
      body: JSON.stringify({ reason: hold.elements.reason.value })
    }));
    if (!result) return;
    hold.reset();
    render(result);
    await refreshEngagement();
    controls.setAdminStatus("The public roster, passport, and ballot are now held.", "warning");
  });
}
