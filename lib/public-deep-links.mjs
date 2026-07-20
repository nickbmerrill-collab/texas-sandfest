export const SANDFEST_IOS_BUNDLE_ID = "com.portalcodex.texassandfest";
export const SANDFEST_ASSOCIATED_DOMAIN = "sandfest.heyelab.com";
export const SANDFEST_ASSOCIATED_DOMAIN_ENTITLEMENT = `applinks:${SANDFEST_ASSOCIATED_DOMAIN}`;

const APP_IDENTIFIER_PREFIX_PATTERN = /^[A-Z0-9]{10}$/;
const SCHEDULE_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const SANDFEST_UNIVERSAL_LINK_COMPONENTS = Object.freeze([
  Object.freeze({ "/": "/today", comment: "Opens the current Texas SandFest visitor guide." }),
  Object.freeze({ "/": "/tickets", comment: "Opens governed Texas SandFest ticket options." }),
  Object.freeze({ "/": "/schedule", comment: "Opens the current public festival schedule." }),
  Object.freeze({ "/": "/schedule/*", comment: "Opens one validated public schedule item." }),
  Object.freeze({ "/": "/island-conditions", comment: "Opens public Island Conditions." }),
  Object.freeze({ "/": "/sculptors", comment: "Opens the public sculptor experience." }),
  Object.freeze({ "/": "/sandy", comment: "Opens Ask Sandy without submitting a question." })
]);

function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function pathSegments(value) {
  const decoded = String(value || "")
    .split("/")
    .filter(Boolean)
    .map(decodePathComponent);
  return decoded.every(item => item !== null) ? decoded : null;
}

function boundedQuestion(searchParams) {
  const question = String(searchParams?.get?.("question") || "").trim();
  if (question.length < 2 || question.length > 280 || /[\u0000-\u001F\u007F]/.test(question)) return null;
  return question;
}

export function normalizeAppleApplicationIdentifierPrefix(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!APP_IDENTIFIER_PREFIX_PATTERN.test(normalized)) {
    throw new Error("SANDFEST_APPLE_APP_ID_PREFIX must be the 10-character Apple application identifier prefix.");
  }
  return normalized;
}

export function sandfestAppleApplicationIdentifier(prefix) {
  return `${normalizeAppleApplicationIdentifierPrefix(prefix)}.${SANDFEST_IOS_BUNDLE_ID}`;
}

export function sandfestAppleAppSiteAssociation(prefix) {
  return {
    applinks: {
      details: [{
        appIDs: [sandfestAppleApplicationIdentifier(prefix)],
        components: SANDFEST_UNIVERSAL_LINK_COMPONENTS.map(component => ({ ...component }))
      }]
    }
  };
}

export function sandfestAppleAppSiteAssociationSafety(value, expectedApplicationIdentifier) {
  const details = value?.applinks?.details;
  const expectedComponents = JSON.stringify(SANDFEST_UNIVERSAL_LINK_COMPONENTS);
  const entry = Array.isArray(details) && details.length === 1 ? details[0] : null;
  const appIDs = entry?.appIDs;
  const applicationIdentifier = Array.isArray(appIDs) && appIDs.length === 1 ? appIDs[0] : null;
  const errors = [];

  if (!entry) errors.push("AASA must contain exactly one applinks details entry.");
  if (applicationIdentifier !== expectedApplicationIdentifier) errors.push("AASA application identifier does not match the signed app.");
  if (JSON.stringify(entry?.components) !== expectedComponents) errors.push("AASA public route components do not match the approved route set.");
  if (Object.keys(value || {}).some(key => key !== "applinks")) errors.push("AASA contains an unapproved service.");
  if (Object.keys(value?.applinks || {}).some(key => key !== "details")) errors.push("AASA applinks contains an unapproved field.");
  if (entry && Object.keys(entry).some(key => !["appIDs", "components"].includes(key))) errors.push("AASA applinks details contain unapproved fields.");

  return { ready: errors.length === 0, errors };
}

export function canonicalPublicWebRoute(input, { basePath = "/" } = {}) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(String(input), "https://sandfest.invalid/");
  } catch {
    return null;
  }

  const routeSegments = pathSegments(url.pathname);
  const baseSegments = pathSegments(basePath);
  if (!routeSegments || !baseSegments) return null;
  if (baseSegments.some((segment, index) => routeSegments[index] !== segment)) return null;
  const components = routeSegments.slice(baseSegments.length);
  if (!components.length) return null;

  const destination = components[0].toLowerCase();
  switch (destination) {
  case "today":
    return components.length === 1 ? { hash: "#top", question: null, scheduleItemID: null } : null;
  case "tickets":
    return components.length === 1 ? { hash: "#tickets", question: null, scheduleItemID: null } : null;
  case "island-conditions":
    return components.length === 1 ? { hash: "#island-conditions", question: null, scheduleItemID: null } : null;
  case "sculptors":
    return components.length === 1 ? { hash: "#sculptors-showcase", question: null, scheduleItemID: null } : null;
  case "sandy":
    return components.length === 1
      ? { hash: "#concierge", question: boundedQuestion(url.searchParams), scheduleItemID: null }
      : null;
  case "schedule": {
    if (components.length === 1) return { hash: "#schedule", question: null, scheduleItemID: null };
    if (components.length !== 2 || !SCHEDULE_ITEM_ID_PATTERN.test(components[1])) return null;
    return {
      hash: `#schedule-${components[1]}`,
      question: null,
      scheduleItemID: components[1]
    };
  }
  default:
    return null;
  }
}
