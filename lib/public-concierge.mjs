const MAX_QUESTION_LENGTH = 280;
const RESPONSE_KEYS = new Set(["answer", "topic", "confidence", "escalated", "sources", "suggestions"]);
const SOURCE_KEYS = new Set(["id", "label", "href", "updatedAt"]);

const TOPICS = [
  ["emergency", ["call 911", "medical emergency", "lost child", "lost person", "missing child", "missing person", "someone is hurt", "someone is injured", "need security", "need medical", "emergency"]],
  ["ferry", ["ferry line", "ferry wait", "ferry", "boat wait", "boat line"]],
  ["weather", ["weather alert", "weather", "forecast", "temperature", "wind", "rain", "storm", "heat"]],
  ["crowd", ["crowd", "busy", "traffic", "gate line", "entrance line", "queue", "live beach"]],
  ["tickets", ["buy tickets", "ticket price", "tickets", "ticket", "admission", "entry price", "apple pay"]],
  ["schedule", ["event hours", "opening time", "closing time", "schedule", "hours", "what time", "when is", "dates"]],
  ["sponsor", ["sponsorship", "sponsor", "sponsor tier", "sponsor package", "brand benefit", "logo"]],
  ["vendor", ["vendor application", "vendor fee", "apply as a vendor", "vendors apply", "vendor apply", "food vendor", "vendors", "vendor", "booth", "sell at", "food truck"]],
  ["volunteer", ["volunteer", "shift", "help at sandfest"]],
  ["accessibility", ["accessibility", "accessible", "wheelchair", "mobility", "ada", "accommodation"]],
  ["parking", ["parking", "park", "shuttle", "driving", "directions", "arrival route"]],
  ["family", ["family", "families", "kids", "children", "child", "pet", "pets", "dog"]],
  ["contact", ["contact", "phone", "email", "call", "talk to staff", "help desk"]]
];

const DEFAULT_SUGGESTIONS = Object.freeze([
  "What ticket options are available?",
  "What is the current ferry wait?",
  "What sponsorship packages are open?"
]);

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizedQuestion(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function aliasScore(question, alias) {
  const padded = ` ${question} `;
  const candidate = ` ${alias} `;
  if (!padded.includes(candidate)) return 0;
  return alias.includes(" ") ? 4 + alias.split(" ").length : 2;
}

function topicForQuestion(question) {
  let selected = { topic: "unknown", score: 0 };
  for (const [topic, aliases] of TOPICS) {
    const score = Math.max(0, ...aliases.map(alias => aliasScore(question, alias)));
    if (score > selected.score) selected = { topic, score };
  }
  return selected.topic;
}

function safeHref(value, fallback) {
  const input = text(value, 500);
  if (/^#[a-z][a-z0-9_-]*$/i.test(input)) return input;
  try {
    const parsed = new URL(input);
    return parsed.protocol === "https:" ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function source(id, label, href, updatedAt = null) {
  return {
    id: text(id, 80),
    label: text(label, 120),
    href: safeHref(href, "#top"),
    updatedAt: text(updatedAt, 40) || null
  };
}

function compactSources(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item?.id || !item?.label || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 4);
}

function money(amount, currency = "usd") {
  if (!Number.isInteger(amount)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency, 3).toUpperCase() || "USD",
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2
  }).format(amount / 100);
}

function publicContact(guide) {
  const parts = [];
  if (guide?.email) parts.push(guide.email);
  if (guide?.phone) parts.push(guide.phone);
  return parts.length ? parts.join(" or ") : "the SandFest team";
}

function guideSource(guide) {
  return source("event-guide", "Official event guide", guide?.sourceUrl || "#top", guide?.sourceCheckedAt || guide?.lastUpdated);
}

function result(answer, topic, options = {}) {
  return {
    answer: text(answer, 2000),
    topic,
    confidence: options.confidence || "high",
    escalated: options.escalated === true,
    sources: compactSources(options.sources || []),
    suggestions: (options.suggestions || DEFAULT_SUGGESTIONS).map(item => text(item, 120)).filter(Boolean).slice(0, 4)
  };
}

function ticketAnswer(context) {
  const guide = context.bootstrap?.guide || {};
  const tickets = context.tickets || {};
  const products = Array.isArray(tickets.products) ? tickets.products : [];
  const listed = products.slice(0, 4).map(product => {
    const publicLabel = text(product.priceLabel, 80);
    const price = money(product.unitAmount, tickets.currency)
      || (/stripe|configure|replace|set in/i.test(publicLabel) ? null : publicLabel)
      || "price pending";
    return `${text(product.name, 100)} (${price})`;
  });
  if (!listed.length) {
    return result(`Ticket options are not published yet. Contact ${publicContact(guide)} before making plans.`, "tickets", {
      confidence: "low",
      escalated: true,
      sources: [guideSource(guide)],
      suggestions: ["When is SandFest?", "How do I contact SandFest?"]
    });
  }
  const checkoutReady = products.some(product => product.availableForCheckout === true);
  return result(
    `Current ticket options include ${listed.join("; ")}. ${checkoutReady ? "Secure checkout is available in the Tickets section." : `Online checkout is not open yet; contact ${publicContact(guide)} for current purchase guidance.`}`,
    "tickets",
    {
      confidence: checkoutReady ? "high" : "medium",
      escalated: !checkoutReady,
      sources: [source("tickets", "Current ticket options", "#tickets", tickets.lastUpdated), guideSource(guide)],
      suggestions: ["When is SandFest?", "What is the current ferry wait?", "Is parking information available?"]
    }
  );
}

function scheduleAnswer(context) {
  const guide = context.bootstrap?.guide || {};
  const schedule = Array.isArray(context.bootstrap?.schedule) ? context.bootstrap.schedule : [];
  const published = schedule.slice(0, 4).map(item => `${text(item.day, 30)} ${text(item.time, 30)}: ${text(item.title, 120)}`);
  const scheduleCopy = published.length ? ` Published highlights: ${published.join("; ")}.` : " Detailed public schedule items have not been published yet.";
  return result(`${guide.name || "Texas SandFest"} runs ${guide.dateRange || "on dates to be announced"}, ${guide.hours || "with hours to be announced"}, at ${guide.location || "the Port Aransas beach"}.${scheduleCopy}`, "schedule", {
    confidence: guide.startDate && guide.endDate ? "high" : "medium",
    escalated: !published.length,
    sources: [source("schedule", "Published event schedule", "#operations", guide.lastUpdated), guideSource(guide)],
    suggestions: ["What ticket options are available?", "What is the current weather?", "How do I contact SandFest?"]
  });
}

function sponsorAnswer(context) {
  const guide = context.bootstrap?.guide || {};
  const sponsorData = context.sponsors || {};
  const packages = Array.isArray(sponsorData.sponsorPackages) ? sponsorData.sponsorPackages : [];
  const labels = packages.slice(0, 5).map(item => `${text(item.name, 100)} (${money(item.amount, item.currency) || text(item.publicLabel, 80)})`);
  if (!labels.length) {
    return result(`Sponsorship packages are not currently published. Contact ${publicContact(guide)} for a reviewed opportunity.`, "sponsor", {
      confidence: "low",
      escalated: true,
      sources: [guideSource(guide)],
      suggestions: ["How do I contact SandFest?", "How do vendors apply?"]
    });
  }
  return result(`Open sponsorship packages include ${labels.join("; ")}. Package benefits and the sponsor inquiry form are in the Sponsors section.`, "sponsor", {
    sources: [source("sponsor-packages", "Current sponsorship packages", "#sponsors", sponsorData.lastUpdated), guideSource(guide)],
    suggestions: ["Where is the sponsor inquiry form?", "How do vendors apply?", "How do I contact SandFest?"]
  });
}

function vendorAnswer(context) {
  const guide = context.bootstrap?.guide || {};
  const vendorData = context.vendors || {};
  const offerings = Array.isArray(vendorData.vendorOfferings) ? vendorData.vendorOfferings : [];
  const labels = offerings.slice(0, 5).map(item => `${text(item.name, 100)} (${money(item.amount, item.currency) || text(item.publicLabel, 80)})`);
  if (!labels.length) {
    return result(`Vendor applications are not currently published. Contact ${publicContact(guide)} before submitting materials or payment.`, "vendor", {
      confidence: "low",
      escalated: true,
      sources: [guideSource(guide)],
      suggestions: ["How do I contact SandFest?", "What sponsorship packages are open?"]
    });
  }
  const interestCount = offerings.filter(item => item.intakeMode === "interest").length;
  const applicationCount = offerings.length - interestCount;
  const intakeCopy = interestCount === offerings.length
    ? "Vendors can join the interest list in the Sponsors and vendors section. SandFest will contact them when applications open or more information is available."
    : interestCount > 0 && applicationCount > 0
      ? "Some programs are accepting applications while others are collecting interest. Choose a vendor category in the Sponsors and vendors section to see the current path; every submission remains subject to review."
      : "Food and non-food applicants can use the vendor application in the Sponsors and vendors section; every application remains subject to review.";
  const suggestions = interestCount === offerings.length
    ? ["Where is the vendor interest form?", "What sponsorship packages are open?", "How do I contact SandFest?"]
    : ["Where is the vendor application?", "What sponsorship packages are open?", "How do I contact SandFest?"];
  return result(`Current vendor offerings include ${labels.join("; ")}. ${intakeCopy}`, "vendor", {
    sources: [source("vendor-offerings", "Current vendor offerings", "#sponsors", vendorData.lastUpdated), guideSource(guide)],
    suggestions
  });
}

function weatherAnswer(context) {
  const conditions = context.islandConditions || {};
  const weather = conditions.weather || {};
  const alertCopy = Array.isArray(weather.alerts) && weather.alerts.length
    ? ` Active alert: ${text(weather.alerts[0].headline || weather.alerts[0].event, 240)}.`
    : "";
  if (weather.status !== "live") {
    return result("The live weather feed is unavailable or stale right now. Check the Island Conditions panel again before traveling and follow official alerts.", "weather", {
      confidence: "low",
      escalated: true,
      sources: [source("island-conditions", "Island Conditions", "#island-conditions", conditions.lastUpdated)]
    });
  }
  const readings = [
    Number.isFinite(weather.temperatureF) ? `${Math.round(weather.temperatureF)}°F` : null,
    weather.shortForecast ? text(weather.shortForecast, 160) : null,
    weather.windSpeed ? `${text(weather.windDirection, 20)} wind ${text(weather.windSpeed, 40)}`.trim() : null,
    Number.isFinite(weather.precipitationChancePct) ? `${Math.round(weather.precipitationChancePct)}% chance of precipitation` : null
  ].filter(Boolean);
  return result(`Current Port Aransas conditions: ${readings.join(", ") || "live observations are available"}.${alertCopy}`, "weather", {
    sources: [
      source("weather", weather.source || "Official weather feed", weather.sourceUrl || "#island-conditions", weather.observedAt),
      source("island-conditions", "Island Conditions", "#island-conditions", conditions.lastUpdated)
    ],
    suggestions: ["What is the current ferry wait?", "How busy are the beach entrances?", "Is parking information available?"]
  });
}

function ferryAnswer(context) {
  const conditions = context.islandConditions || {};
  const ferry = conditions.ferry || {};
  if (ferry.status === "unavailable" || ferry.status === "stale") {
    return result("The ferry feed is unavailable or stale right now. Check Island Conditions again before departure and use the official ferry source for travel decisions.", "ferry", {
      confidence: "low",
      escalated: true,
      sources: [
        source("ferry", ferry.source || "Official ferry feed", ferry.sourceUrl || "#island-conditions", ferry.observedAt),
        source("island-conditions", "Island Conditions", "#island-conditions", conditions.lastUpdated)
      ]
    });
  }
  const directions = (Array.isArray(ferry.directions) ? ferry.directions : [])
    .filter(item => item.status !== "stale" && item.status !== "unavailable" && Number.isFinite(item.estimatedWaitMinutes))
    .map(item => `${text(item.label, 100)}: about ${Math.round(item.estimatedWaitMinutes)} minutes`);
  const wait = directions.length
    ? directions.join("; ")
    : Number.isFinite(ferry.estimatedWaitMinutes)
      ? `Estimated wait: about ${Math.round(ferry.estimatedWaitMinutes)} minutes`
      : "The ferry is reporting live, but no wait estimate is posted";
  return result(`${wait}.${Number.isFinite(ferry.operatingFerries) ? ` ${Math.round(ferry.operatingFerries)} ferries are reported in operation.` : ""}`, "ferry", {
    sources: [
      source("ferry", ferry.source || "Official ferry feed", ferry.sourceUrl || "#island-conditions", ferry.observedAt),
      source("island-conditions", "Island Conditions", "#island-conditions", conditions.lastUpdated)
    ],
    suggestions: ["What is the current weather?", "How busy are the beach entrances?", "When is SandFest?"]
  });
}

function crowdAnswer(context) {
  const conditions = context.islandConditions || {};
  const cameras = Array.isArray(conditions.cameras) ? conditions.cameras : [];
  const live = cameras.filter(camera => ["live", "degraded"].includes(camera.operationalStatus) && camera.observation);
  if (!live.length) {
    return result("Live crowd and line monitoring is not reporting current observations right now. Use the Island Conditions panel and posted staff directions on arrival.", "crowd", {
      confidence: "low",
      escalated: true,
      sources: [source("island-conditions", "Island Conditions", "#island-conditions", conditions.lastUpdated)]
    });
  }
  const pressure = live
    .filter(camera => ["high", "critical"].includes(camera.level))
    .map(camera => text(camera.zone || camera.name, 100));
  const longest = live
    .filter(camera => Number.isFinite(camera.observation?.estimatedWaitMinutes))
    .sort((a, b) => b.observation.estimatedWaitMinutes - a.observation.estimatedWaitMinutes)[0];
  const pressureCopy = pressure.length ? ` Higher pressure is showing at ${pressure.slice(0, 3).join(", ")}.` : " No monitored area is currently showing high or critical pressure.";
  const waitCopy = longest ? ` The longest current monitored wait is about ${Math.round(longest.observation.estimatedWaitMinutes)} minutes at ${text(longest.zone || longest.name, 100)}.` : "";
  return result(`${live.length} of ${cameras.length} monitored camera lanes are reporting current privacy-safe metrics.${pressureCopy}${waitCopy}`, "crowd", {
    sources: [source("island-conditions", "Live crowd and line conditions", "#island-conditions", conditions.lastUpdated)],
    suggestions: ["What is the current weather?", "What is the current ferry wait?", "Is parking information available?"]
  });
}

function publicZoneLocationCopy(item) {
  const marker = text(item?.marker, 80);
  const summary = text(item?.summary, 300).replace(/[.!?]+$/, "");
  return `${text(item?.name, 120)}${marker ? ` at marker ${marker}` : ""}${summary ? ` (${summary})` : ""}`;
}

function accessibilityAnswer(context) {
  const guide = context.bootstrap?.guide || {};
  const zones = Array.isArray(context.bootstrap?.zones) ? context.bootstrap.zones : [];
  const locations = zones.filter(item => /\b(?:accessib\w*|ada|wheelchair|mobility|guest relations)\b/i.test(`${item?.name || ""} ${item?.summary || ""}`));
  if (!locations.length) {
    return result(`Detailed accessibility and accommodation guidance is not available in the current public feed. Contact ${publicContact(guide)} for a confirmed answer.`, "accessibility", {
      confidence: "low",
      escalated: true,
      sources: [guideSource(guide)],
      suggestions: ["How do I contact SandFest?", "Is parking information available?", "When is SandFest?"]
    });
  }
  const locationCopy = locations.slice(0, 3).map(publicZoneLocationCopy);
  return result(`Published accessibility locations include ${locationCopy.join("; ")}. For beach-wheelchair availability, mobility accommodations, or details not shown on the public map, contact ${publicContact(guide)} before visiting.`, "accessibility", {
    sources: [
      source("accessibility-locations", "Published accessibility locations", "#operations", guide.sourceCheckedAt || guide.lastUpdated),
      guideSource(guide)
    ],
    suggestions: ["Is parking information available?", "When is SandFest?", "How do I contact SandFest?"]
  });
}

function parkingAnswer(context) {
  const guide = context.bootstrap?.guide || {};
  const zones = Array.isArray(context.bootstrap?.zones) ? context.bootstrap.zones : [];
  const locations = zones.filter(item => /\b(?:parking|shuttle|arrival|drop[ -]?off|park and ride)\b/i.test(`${item?.name || ""} ${item?.summary || ""}`));
  if (!locations.length) {
    return result(`A reviewed parking or shuttle plan is not available in the current public feed. Contact ${publicContact(guide)} for confirmed arrival guidance.`, "parking", {
      confidence: "low",
      escalated: true,
      sources: [guideSource(guide)],
      suggestions: ["What is the current ferry wait?", "What accessibility guidance is available?", "How do I contact SandFest?"]
    });
  }
  const locationCopy = locations.slice(0, 4).map(publicZoneLocationCopy);
  return result(`Published arrival locations include ${locationCopy.join("; ")}. Parking permits, remote lots, operating hours, and route changes are not included in this feed; review the official event guide or contact ${publicContact(guide)} before traveling.`, "parking", {
    confidence: "medium",
    escalated: true,
    sources: [
      source("parking-locations", "Published parking and shuttle locations", "#operations", guide.sourceCheckedAt || guide.lastUpdated),
      guideSource(guide)
    ],
    suggestions: ["What is the current ferry wait?", "What accessibility guidance is available?", "What is the current weather?"]
  });
}

function escalationAnswer(topic, context) {
  const guide = context.bootstrap?.guide || {};
  if (topic === "emergency") {
    return result("Ask Sandy cannot dispatch emergency help. Call 911 for immediate danger or a medical emergency. On site, alert the nearest uniformed SandFest staff member or security team now.", topic, {
      confidence: "high",
      escalated: true,
      sources: [guideSource(guide), source("island-conditions", "Current public safety notices", "#island-conditions")],
      suggestions: ["How do I contact SandFest?", "What is the current weather?"]
    });
  }
  const label = {
    volunteer: "Current volunteer openings and shift registration are not available in the public feed.",
    family: "A reviewed answer for that family or pet question is not available in the current public feed.",
    contact: "The current public contact is listed below.",
    unknown: "I do not have a confirmed public answer for that yet."
  }[topic] || "I do not have a confirmed public answer for that yet.";
  return result(`${label} Contact ${publicContact(guide)} for a confirmed answer.`, topic, {
    confidence: topic === "contact" ? "high" : "low",
    escalated: topic !== "contact",
    sources: [guideSource(guide), source("island-conditions", "Island Conditions", "#island-conditions")],
    suggestions: ["What ticket options are available?", "When is SandFest?", "What is the current ferry wait?"]
  });
}

export function parsePublicConciergeQuestion(input) {
  if (typeof input !== "string") return { ok: false, error: "Enter a question for Ask Sandy." };
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 2) return { ok: false, error: "Enter a question for Ask Sandy." };
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, error: `Questions must be ${MAX_QUESTION_LENGTH} characters or fewer.` };
  const normalized = normalizedQuestion(question);
  if (!normalized) return { ok: false, error: "Enter a question using letters or numbers." };
  return { ok: true, question, normalized, topic: topicForQuestion(normalized) };
}

export function publicConciergeNeedsConditions(topic) {
  return ["weather", "ferry", "crowd", "parking"].includes(topic);
}

export function answerPublicConcierge(questionInput, context = {}) {
  const parsed = parsePublicConciergeQuestion(questionInput);
  if (!parsed.ok) return parsed;
  const answer = {
    tickets: ticketAnswer,
    schedule: scheduleAnswer,
    sponsor: sponsorAnswer,
    vendor: vendorAnswer,
    weather: weatherAnswer,
    ferry: ferryAnswer,
    crowd: crowdAnswer,
    accessibility: accessibilityAnswer,
    parking: parkingAnswer
  }[parsed.topic]?.(context) || escalationAnswer(parsed.topic, context);
  return { ok: true, ...answer };
}

function unknownKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => !allowed.has(key));
}

export function publicConciergeResponseSafety(input = {}) {
  const errors = [];
  const unknown = unknownKeys(input, RESPONSE_KEYS);
  if (unknown.length) errors.push(`Unexpected concierge response keys: ${unknown.join(", ")}.`);
  if (!text(input.answer, 2000)) errors.push("Concierge answer is required.");
  if (!["high", "medium", "low"].includes(input.confidence)) errors.push("Concierge confidence is invalid.");
  if (typeof input.escalated !== "boolean") errors.push("Concierge escalation state is required.");
  if (!Array.isArray(input.sources) || !input.sources.length) errors.push("Concierge answers require at least one public source.");
  for (const [index, item] of (Array.isArray(input.sources) ? input.sources : []).entries()) {
    const sourceUnknown = unknownKeys(item, SOURCE_KEYS);
    if (sourceUnknown.length) errors.push(`Unexpected concierge source keys at ${index}: ${sourceUnknown.join(", ")}.`);
    if (!item?.id || !item?.label || !(/^#[a-z][a-z0-9_-]*$/i.test(item.href) || /^https:\/\//i.test(item.href))) {
      errors.push(`Concierge source ${index} is invalid.`);
    }
  }
  const serialized = JSON.stringify(input);
  if (/\/(?:Users|home|private|var\/folders)\/|storageRoot|publishedBy|invoiceStatus|quickBooksItemId|stripePriceId/i.test(serialized)) {
    errors.push("Concierge response contains private or implementation data.");
  }
  return { ready: errors.length === 0, errors };
}

export const publicConciergePolicy = Object.freeze({ maxQuestionLength: MAX_QUESTION_LENGTH });
