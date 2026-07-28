export const BOARD_BRIEFING_SLIDE_COUNT = 12;
export const BOARD_BRIEFING_TITLE = "A Certified Festival Platform";

function xmlDecode(value = "") {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function presentationXmlText(xml = "") {
  return [...String(xml).matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map(match => xmlDecode(match[1]))
    .join("\n");
}

function numberedArchiveEntries(entries, expression) {
  return entries
    .filter(entry => expression.test(entry))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/(\d+)\.xml$/)?.[1] || 0);
      const rightNumber = Number(right.match(/(\d+)\.xml$/)?.[1] || 0);
      return leftNumber - rightNumber;
    });
}

export function assessBoardBriefingDeck({
  entries = [],
  slideXml = {},
  notesXml = {},
  size = 0
} = {}) {
  const errors = [];
  const slides = numberedArchiveEntries(entries, /^ppt\/slides\/slide\d+\.xml$/);
  const notes = numberedArchiveEntries(entries, /^ppt\/notesSlides\/notesSlide\d+\.xml$/);
  const titleText = presentationXmlText(slideXml[slides[0]] || "");
  const sourceNotes = notes.filter(entry => {
    const text = presentationXmlText(notesXml[entry] || "");
    return text.includes("[Sources]") && text.includes("Internal:");
  });
  if (size < 30_000) errors.push("The board briefing file is unexpectedly small.");
  if (slides.length !== BOARD_BRIEFING_SLIDE_COUNT) {
    errors.push(`The board briefing has ${slides.length}/${BOARD_BRIEFING_SLIDE_COUNT} slides.`);
  }
  if (notes.length !== BOARD_BRIEFING_SLIDE_COUNT) {
    errors.push(`The board briefing has ${notes.length}/${BOARD_BRIEFING_SLIDE_COUNT} presenter-note pages.`);
  }
  if (sourceNotes.length !== BOARD_BRIEFING_SLIDE_COUNT) {
    errors.push(`The board briefing has ${sourceNotes.length}/${BOARD_BRIEFING_SLIDE_COUNT} source-backed presenter notes.`);
  }
  if (!titleText.includes(BOARD_BRIEFING_TITLE)) {
    errors.push(`The board briefing title does not contain "${BOARD_BRIEFING_TITLE}".`);
  }
  return {
    ok: errors.length === 0,
    slideCount: slides.length,
    notesCount: notes.length,
    sourceNoteCount: sourceNotes.length,
    title: BOARD_BRIEFING_TITLE,
    size,
    errors
  };
}

function sourceMatches(source, expected) {
  return source?.branch === expected?.branch
    && source?.commit === expected?.commit
    && source?.originMainCommit === expected?.originMainCommit
    && source?.matchesOriginMain === true
    && source?.dirty === false;
}

export function assessBoardShowtimeBinding({
  git = {},
  session = null,
  certificate = null,
  capture = null,
  requireCapture = true
} = {}) {
  const errors = [];
  if (git.branch !== "main") errors.push("The presentation checkout is not on main.");
  if (git.dirty !== false) errors.push(`The presentation checkout has ${Number(git.changeCount || 0)} uncommitted change(s).`);
  if (!git.head || git.head !== git.originMain) errors.push("The presentation checkout does not match origin/main.");
  const expectedSource = {
    branch: git.branch,
    commit: git.head,
    originMainCommit: git.originMain
  };
  if (session?.status !== "ready" || !sourceMatches(session?.source, expectedSource)) {
    errors.push("The active board session is not bound to the current clean main revision.");
  }
  if (certificate?.ok !== true || !sourceMatches(certificate?.source, expectedSource)) {
    errors.push("The board certificate is not bound to the current clean main revision.");
  }
  if (certificate?.links?.visitor !== session?.links?.visitor
    || certificate?.links?.operations !== session?.links?.operations) {
    errors.push("The board certificate does not match the active presentation links.");
  }
  if (requireCapture) {
    if (capture?.certificate?.ok !== true
      || capture?.certificate?.source?.commit !== git.head
      || capture?.certificate?.source?.branch !== git.branch
      || capture?.certificate?.source?.originMainCommit !== git.originMain
      || capture?.certificate?.source?.dirty !== false
      || capture?.certificate?.source?.matchesOriginMain !== true) {
      errors.push("The fallback video is not bound to the current clean main revision.");
    }
    if (capture?.certificate?.completedAt !== certificate?.completedAt) {
      errors.push("The fallback video was not captured from the active board certificate.");
    }
    if (capture?.visitorUrl !== session?.links?.visitor
      || capture?.operationsUrl !== session?.links?.operations) {
      errors.push("The fallback video does not match the active presentation links.");
    }
    if (capture?.runtime?.mode !== "board_demo"
      || capture?.runtime?.eventId !== "texas-sandfest-2027"
      || capture?.runtime?.documentIngestionReady !== true
      || !capture?.runtime?.label?.includes("Synthetic 2027 data")
      || !capture?.runtime?.label?.includes("No external messages, charges, or live-provider calls")) {
      errors.push("The fallback video is not bound to the isolated 2027 no-live-provider runtime.");
    }
  }
  return {
    ok: errors.length === 0,
    source: git.head ? `${git.branch}@${git.head.slice(0, 8)}` : null,
    visitor: session?.links?.visitor || null,
    operations: session?.links?.operations || null,
    errors
  };
}
