import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";
import { normalizeEventGuide } from "../lib/event-guide.mjs";

function safeHttpsHref(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function statusCopy(program) {
  if (program.note) return program.note;
  return {
    open: "Volunteer registration is open. Choose an available role and shift through the official scheduling provider.",
    paused: "Volunteer registration is temporarily paused. Review the official information page for updates.",
    closed: "Volunteer registration is closed for this event.",
    upcoming: "Current-event volunteer registration has not opened yet."
  }[program.registrationStatus] || "Current volunteer registration details are not available yet.";
}

export function renderVolunteerProgram(section, input = {}) {
  const program = normalizeEventGuide({ volunteer: input }).volunteer;
  const informationUrl = safeHttpsHref(program.informationUrl);
  const registrationUrl = program.registrationStatus === "open"
    ? safeHttpsHref(program.registrationUrl)
    : null;
  const state = informationUrl ? program.registrationStatus : "unavailable";
  const message = informationUrl
    ? statusCopy(program)
    : "Current volunteer information is temporarily unavailable. Contact SandFest before making plans.";
  section.dataset.registrationStatus = state;
  section.setAttribute("aria-busy", "false");
  section.innerHTML = `
    <div class="volunteer-section">
      <div class="volunteer-intro">
        <p class="eyebrow">Join the crew</p>
        <h2>Help make the weekend happen.</h2>
        <p>Review the official volunteer guidance here, then move into the current scheduling provider only after SandFest publishes this event's registration.</p>
        <div class="volunteer-actions">
          ${informationUrl ? `<a id="volunteer-information-link" class="button ${registrationUrl ? "secondary" : "primary"}" href="${escapeAttr(informationUrl)}" target="_blank" rel="noopener noreferrer">Review volunteer information</a>` : ""}
          ${registrationUrl ? `<a id="volunteer-registration-link" class="button primary" href="${escapeAttr(registrationUrl)}" target="_blank" rel="noopener noreferrer">Choose a shift</a>` : '<a id="volunteer-registration-link" class="button primary" href="#volunteer" hidden>Choose a shift</a>'}
        </div>
        <p id="volunteer-program-status" class="volunteer-program-status" data-state="${escapeAttr(state)}">${escapeHtml(message)}</p>
      </div>
      <ol class="volunteer-flow" aria-label="Volunteer path">
        <li><span>1</span><div><strong>Review</strong><p>Check current expectations, eligibility, and event guidance.</p></div></li>
        <li><span>2</span><div><strong>Select</strong><p>Choose an available role and shift in the official scheduling provider.</p></div></li>
        <li><span>3</span><div><strong>Serve</strong><p>Use the confirmed assignment for check-in, updates, and hour tracking.</p></div></li>
      </ol>
    </div>`;
}
