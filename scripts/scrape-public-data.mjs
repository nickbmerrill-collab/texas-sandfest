import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data");
const RAW_HTML = path.join(OUT, "raw", "html");
const RAW_TEXT = path.join(OUT, "raw", "text");
const PROCESSED = path.join(OUT, "processed");

const sitemapUrls = [
  "https://www.texassandfest.org/sitemap.xml",
  "https://www.texassandfest.org/pages-sitemap.xml",
  "https://www.texassandfest.org/store-products-sitemap.xml",
  "https://www.texassandfest.org/store-categories-sitemap.xml"
];

const seedUrls = [
  "https://www.texassandfest.org/",
  "https://www.eventeny.com/events/texas-sandfest-2026-21603/",
  "https://www.eventeny.com/events/ticket/?id=21603"
];

const categories = {
  tickets: [/ticket/i, /admission/i, /wristband/i, /vip/i, /raffle/i],
  visitor: [/parking/i, /shuttle/i, /ferry/i, /faq/i, /accessibility/i, /pet/i, /map/i, /getting/i],
  program: [/schedule/i, /music/i, /kids/i, /things-to-do/i, /at-sandfest/i],
  competition: [/sculptor/i, /competition/i, /amateur/i, /winners/i],
  partner: [/sponsor/i, /vendor/i, /volunteer/i, /get-involved/i],
  organization: [/about/i, /board/i, /mission/i, /history/i, /sustain/i, /contact/i, /press/i],
  commerce: [/product-page/i, /category/i, /store/i]
};

await mkdir(RAW_HTML, { recursive: true });
await mkdir(RAW_TEXT, { recursive: true });
await mkdir(PROCESSED, { recursive: true });

const fetchedAt = new Date().toISOString();
const sitemapXml = [];
for (const url of sitemapUrls) {
  const body = await fetchText(url);
  sitemapXml.push({ url, body });
}

const sitemapPages = unique(
  sitemapXml.flatMap(item => [...item.body.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => decodeXml(match[1])))
);

const crawlUrls = unique(
  [...seedUrls, ...sitemapPages].filter(url => /^https?:\/\//.test(url) && !new URL(url).pathname.endsWith(".xml"))
);

const pages = [];
const allLinks = [];
const allImages = [];

for (const url of crawlUrls) {
  try {
    const html = await fetchText(url);
    const slug = slugify(url);
    const text = htmlToText(html);
    const record = {
      url,
      slug,
      fetchedAt,
      title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description: firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
      category: classify(url, text),
      headings: extractHeadings(html),
      emails: unique([...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(match => match[0])),
      phones: unique([...text.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g)].map(match => match[0])),
      dates: unique([...text.matchAll(/\b(?:Jan|Feb|Mar|Apr|April|May|Jun|June|Jul|July|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:\s*-\s*\d{1,2})?(?:,\s*\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi)].map(match => normalizeSpace(match[0]))),
      times: unique([...text.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/gi)].map(match => normalizeSpace(match[0]))),
      prices: unique([...text.matchAll(/\$\s?\d[\d,]*(?:\.\d{2})?/g)].map(match => normalizeSpace(match[0]))),
      outboundLinks: extractLinks(html, url).filter(link => !link.href.includes("texassandfest.org")),
      internalLinks: extractLinks(html, url).filter(link => link.href.includes("texassandfest.org")),
      images: extractImages(html, url),
      textPreview: text.slice(0, 1800),
      wordCount: text.split(/\s+/).filter(Boolean).length
    };
    pages.push(record);
    allLinks.push(...record.outboundLinks.map(link => ({ ...link, source: url })));
    allLinks.push(...record.internalLinks.map(link => ({ ...link, source: url })));
    allImages.push(...record.images.map(image => ({ ...image, source: url })));
    await writeFile(path.join(RAW_HTML, `${slug}.html`), html);
    await writeFile(path.join(RAW_TEXT, `${slug}.txt`), text);
    console.log(`scraped ${url}`);
  } catch (error) {
    pages.push({ url, fetchedAt, error: error.message });
    console.warn(`failed ${url}: ${error.message}`);
  }
}

const byCategory = Object.fromEntries(
  Object.keys(categories).map(category => [category, pages.filter(page => page.category === category).map(page => page.url)])
);

const eventenyLinks = unique(allLinks.map(link => link.href).filter(href => href.includes("eventeny.com")));
const sandfestEventenyLinks = unique(eventenyLinks.filter(href => /sandfest|21603|7959|custom=|action=(sponsor|vendor)|to=280170|to=1599110/i.test(href)));
const socialDomains = new Set(["facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "youtube.com", "www.youtube.com", "linkedin.com", "www.linkedin.com", "tiktok.com", "www.tiktok.com", "twitter.com", "www.twitter.com", "x.com", "www.x.com"]);
const socialLinks = unique(allLinks.map(link => link.href).filter(href => {
  try {
    return socialDomains.has(new URL(href).hostname.toLowerCase());
  } catch {
    return false;
  }
}));
const documents = unique(allLinks.map(link => link.href).filter(href => /\.(pdf|docx?|xlsx?|csv)(?:\?|$)/i.test(href)));

const knowledgeBase = buildKnowledgeBase(pages, sandfestEventenyLinks, socialLinks, documents);
const processMap = buildProcessMap(pages, sandfestEventenyLinks);
const recommendations = buildRecommendations(processMap);

await writeJson(path.join(PROCESSED, "pages.json"), pages);
await writeJson(path.join(PROCESSED, "links.json"), uniqueObjects(allLinks, link => `${link.source}|${link.href}|${link.text}`));
await writeJson(path.join(PROCESSED, "images.json"), uniqueObjects(allImages, image => `${image.source}|${image.src}`));
await writeJson(path.join(PROCESSED, "knowledge-base.json"), knowledgeBase);
await writeJson(path.join(PROCESSED, "process-map.json"), processMap);
await writeFile(path.join(PROCESSED, "process-improvement-notes.md"), recommendations);
await writeJson(path.join(PROCESSED, "crawl-summary.json"), {
  fetchedAt,
  pageCount: pages.length,
  successfulPages: pages.filter(page => !page.error).length,
  failedPages: pages.filter(page => page.error).length,
  byCategory,
  eventenyLinks,
  sandfestEventenyLinks,
  socialLinks,
  documents,
  sourceSitemaps: sitemapUrls
});

console.log(`\nWrote ${pages.length} page records to ${PROCESSED}`);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Texas SandFest process audit crawler"
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function extractHeadings(html) {
  return unique(
    [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)]
      .map(match => normalizeSpace(stripTags(match[2])))
      .filter(Boolean)
  ).slice(0, 80);
}

function extractLinks(html, baseUrl) {
  return uniqueObjects(
    [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(match => {
        const href = absolutize(match[1], baseUrl);
        const text = normalizeSpace(stripTags(match[2]));
        return href ? { href, text } : null;
      })
      .filter(Boolean)
      .filter(link => !link.href.startsWith("javascript:") && !link.href.startsWith("mailto:") && !link.href.startsWith("tel:")),
    link => `${link.href}|${link.text}`
  );
}

function extractImages(html, baseUrl) {
  const fromImg = [...html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi)]
    .map(match => ({ src: absolutize(match[1], baseUrl), alt: normalizeSpace(match[2] || "") }));
  const fromWix = [...html.matchAll(/https:\/\/static\.wixstatic\.com\/[^"'\s\\]+/g)]
    .map(match => ({ src: decodeURIComponent(match[0]).replace(/\\u002F/g, "/"), alt: "" }));
  return uniqueObjects([...fromImg, ...fromWix].filter(image => image.src), image => image.src);
}

function classify(url, text) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (/product-page|category\/all-products|store/.test(pathname)) return "commerce";
  if (/ticket|admission|wristband|raffle/.test(pathname)) return "tickets";
  if (/parking|shuttle|ferry|faq|accessibility|petpolicy|maps|getting-to-sandfest/.test(pathname)) return "visitor";
  if (/schedule|music|kids|things-to-do|at-sandfest/.test(pathname)) return "program";
  if (/sculptor|competition|amateur|winners/.test(pathname)) return "competition";
  if (/sponsor|vendor|volunteer|get-involved/.test(pathname)) return "partner";
  if (/about|board|mission|history|sustain|contact|press|magazine|survey/.test(pathname)) return "organization";
  if (/eventeny\.com/.test(url)) return "tickets";
  const haystack = `${url} ${text.slice(0, 1200)}`;
  for (const [category, patterns] of Object.entries(categories)) {
    if (patterns.some(pattern => pattern.test(haystack))) return category;
  }
  return "uncategorized";
}

function buildKnowledgeBase(pages, eventenyLinks, socialLinks, documents) {
  const facts = [];
  const contacts = uniqueObjects(
    pages.flatMap(page => [
      ...page.emails.map(value => ({ type: "email", value, source: page.url })),
      ...page.phones.map(value => ({ type: "phone", value, source: page.url }))
    ]),
    item => `${item.type}|${item.value}|${item.source}`
  );
  for (const page of pages.filter(page => !page.error)) {
    facts.push({
      topic: page.category,
      source: page.url,
      title: page.title,
      headings: page.headings,
      dates: page.dates,
      times: page.times,
      prices: page.prices,
      summaryText: page.textPreview
    });
  }
  return {
    fetchedAt,
    event: {
      name: "Texas SandFest",
      knownDates: unique(pages.flatMap(page => page.dates || []).filter(value => /2026|April|Apr/i.test(value))),
      knownTimes: unique(pages.flatMap(page => page.times || [])),
      knownPrices: unique(pages.flatMap(page => page.prices || []))
    },
    contacts,
    eventenyLinks,
    socialLinks,
    documents,
    facts
  };
}

function buildProcessMap(pages, eventenyLinks) {
  const findPages = term => pages
    .filter(page => !page.error && (page.url.toLowerCase().includes(term) || page.textPreview.toLowerCase().includes(term)))
    .map(page => page.url);

  return {
    fetchedAt,
    visitor: {
      tickets: findPages("ticket"),
      parkingAndTransit: unique([...findPages("parking"), ...findPages("shuttle"), ...findPages("ferry")]),
      accessibility: findPages("accessibility"),
      policies: unique([...findPages("faq"), ...findPages("pet")]),
      map: findPages("map")
    },
    programming: {
      dailySchedule: findPages("schedule"),
      liveMusic: unique([...findPages("music"), ...findPages("livemusic")]),
      kids: findPages("kids"),
      thingsToDo: findPages("things")
    },
    competition: {
      masterSolo: findPages("master-solo"),
      masterDuo: findPages("master-duo"),
      semiPro: findPages("semi-pro"),
      amateur: findPages("amateur"),
      winners: findPages("winners")
    },
    partnerOperations: {
      vendors: findPages("vendor"),
      volunteers: findPages("volunteer"),
      sponsors: findPages("sponsor"),
      getInvolved: findPages("get-involved"),
      externalSystems: eventenyLinks
    },
    organization: {
      mission: findPages("mission"),
      history: findPages("history"),
      board: findPages("board"),
      press: findPages("press"),
      contact: findPages("contact")
    },
    processRisks: [
      "Current public journey is split between Wix pages and Eventeny forms/ticketing.",
      "Multiple near-duplicate live music and copied pages appear in the sitemap.",
      "Core operating data is page-based instead of object-based, making AI answers, staff routing, and updates hard to audit.",
      "Sponsorship, vendor, volunteer, visitor, and competition flows are presented as pages rather than lifecycle pipelines.",
      "No obvious single source of truth for maps, schedules, incident updates, policy changes, sponsor benefits, or volunteer coverage."
    ]
  };
}

function buildRecommendations(processMap) {
  return `# Public Data Ingestion Notes

Scrape time: ${fetchedAt}

## What was ingested

- Official Wix sitemaps and all listed public pages.
- Public product/category sitemap entries.
- Public Eventeny event and ticketing URLs discoverable from search and site links.
- Page titles, headings, visible text preview, contact details, dates, times, prices, links, images, and document URLs.

## Current process shape

- Visitor information is spread across tickets, FAQ, parking/shuttles, ferry, accessibility, maps, kids, live music, daily schedule, and policy pages.
- Partner operations split into sponsor, vendor, volunteer, and get-involved pages, then jump out to Eventeny for application/payment workflows.
- Competition content is split across sculptor category pages, amateur competition, winners, and archive-style copied pages.
- Organization trust content sits separately across mission, history, board, press, sustainability, and contact pages.

## Early process-improvement suggestions

1. Create a canonical content model before adding more AI.
   Store event facts, policy answers, map zones, schedule items, ticket types, sponsor tiers, vendor requirements, volunteer roles, and contacts as structured records with owners and last-reviewed dates.

2. Separate public pages from operational workflows.
   Keep the marketing site simple, but run volunteer, vendor, sponsor, competition, and incident workflows in a shared operations console with status, assignments, attachments, and audit history.

3. Build an AI concierge only on approved sources.
   The assistant should answer from the canonical knowledge base, cite the source record, show confidence, and escalate low-confidence or high-risk questions to staff.

4. Normalize Eventeny handoffs.
   Treat Eventeny as a transaction/application system, not the source of truth. Mirror relevant status into SandFest ops: ticket type, applicant type, sponsor tier, vendor category, payment state, and missing documents.

5. Collapse duplicate pages and copied archive routes.
   The sitemap includes copied or alternate routes such as duplicate live music and copied SandFest pages. These create conflicting answers for visitors and AI retrieval.

6. Add live event operations primitives.
   Model beach zones, gates, ADA support, shade/medical points, volunteers, radio channels, incidents, weather alerts, lost party reports, and sanitation/vendor issues.

7. Give every workflow a lifecycle.
   Sponsors: lead -> pledged -> invoiced -> assets received -> benefits assigned -> on-site delivered -> impact report sent.
   Vendors: applied -> documents requested -> approved -> booth assigned -> load-in scheduled -> inspection passed -> closeout.
   Volunteers: registered -> role matched -> shift confirmed -> checked in -> reassigned/no-show -> thanked.

8. Build post-event analytics from day one.
   Capture question themes, wait times, crowd signals, volunteer gaps, vendor issues, sponsor deliverables, and policy confusion so the 2027 planning cycle starts from evidence.

## Files generated

- \`data/processed/crawl-summary.json\`
- \`data/processed/pages.json\`
- \`data/processed/links.json\`
- \`data/processed/images.json\`
- \`data/processed/knowledge-base.json\`
- \`data/processed/process-map.json\`
- Raw trace files under \`data/raw/html\` and \`data/raw/text\`
`;
}

function htmlToText(html) {
  return normalizeSpace(
    decodeHtml(
      stripTags(
        html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
      )
    )
  );
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeXml(value) {
  return decodeHtml(value);
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return match ? normalizeSpace(decodeHtml(stripTags(match[1]))) : "";
}

function absolutize(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return "";
  }
}

function slugify(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/^\/$/, "home").replace(/^\/|\/$/g, "");
  const query = parsed.search ? `-${parsed.search.replace(/[?=&]/g, "-")}` : "";
  return `${parsed.hostname}-${pathname || "home"}${query}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueObjects(values, keyFn) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
