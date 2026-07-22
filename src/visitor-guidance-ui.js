import { escapeAttr, escapeHtml } from "../lib/html-escape.mjs";

function reviewedDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Source reviewed" : `Reviewed ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function answerMarkup(item) {
  return `<details class="visitor-guidance-answer" data-guidance-search="${escapeAttr(`${item.category} ${item.question} ${item.answer} ${(item.keywords || []).join(" ")}`.toLowerCase())}" data-guidance-category="${escapeAttr(item.category)}">
    <summary><span>${escapeHtml(item.question)}</span><b aria-hidden="true">+</b></summary>
    <div>
      <p>${escapeHtml(item.answer)}</p>
      <a href="${escapeAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.sourceLabel)}</a>
      <span>${escapeHtml(reviewedDate(item.sourceCheckedAt))}</span>
    </div>
  </details>`;
}

export function mountVisitorGuidance(root, guidance = []) {
  if (!root) return;
  const items = Array.isArray(guidance) ? guidance : [];
  const categories = [...new Set(items.map(item => item.category).filter(Boolean))];
  const list = root.querySelector("[data-visitor-guidance-list]");
  const filter = root.querySelector("[data-visitor-guidance-category]");
  const search = root.querySelector("[data-visitor-guidance-search]");
  const count = root.querySelector("[data-visitor-guidance-count]");
  if (!list || !filter || !search || !count) return;
  filter.innerHTML = `<option value="">All topics</option>${categories.map(category => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`).join("")}`;
  list.innerHTML = items.length
    ? items.map(answerMarkup).join("")
    : '<p class="visitor-guidance-empty">Current visitor guidance is being reviewed. Use the official SandFest guide for confirmed information.</p>';
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    const category = filter.value;
    let visible = 0;
    list.querySelectorAll(".visitor-guidance-answer").forEach(item => {
      const match = (!query || item.dataset.guidanceSearch.includes(query)) && (!category || item.dataset.guidanceCategory === category);
      item.hidden = !match;
      if (match) visible += 1;
    });
    count.textContent = items.length ? `${visible} answer${visible === 1 ? "" : "s"}` : "Guidance pending";
  };
  search.oninput = apply;
  filter.onchange = apply;
  apply();
  root.setAttribute("aria-busy", "false");
}
