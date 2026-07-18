import { publicEventGuide } from "./event-guide.mjs";

const PUBLIC_SCHEDULE_CATEGORIES = new Set([
  "activity",
  "competition",
  "entertainment",
  "family",
  "music",
  "program",
  "public",
  "visitor"
]);
const ROOT_KEYS = new Set(["guide", "schedule", "zones", "alert", "runtime"]);
const GUIDE_KEYS = new Set(Object.keys(publicEventGuide({})));
const SCHEDULE_KEYS = new Set(["id", "day", "time", "title", "zone", "category"]);
const ZONE_KEYS = new Set(["id", "name", "marker", "summary"]);
const ALERT_KEYS = new Set(["id", "active", "severity", "title", "message", "audience", "updatedAt", "expiresAt"]);
const RUNTIME_KEYS = new Set(["mode", "label"]);

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function optionalText(value, max) {
  const normalized = text(value, max);
  return normalized || null;
}

function publicSchedule(input) {
  return (Array.isArray(input) ? input : [])
    .filter(item => PUBLIC_SCHEDULE_CATEGORIES.has(text(item?.category, 40).toLowerCase()))
    .map(item => ({
      id: text(item.id, 100),
      day: text(item.day, 40),
      time: text(item.time, 40),
      title: text(item.title, 180),
      zone: text(item.zone, 120),
      category: text(item.category, 40)
    }))
    .filter(item => item.id && item.title);
}

function publicZones(input) {
  return (Array.isArray(input) ? input : [])
    .map(item => ({
      id: text(item?.id, 100),
      name: text(item?.name, 120),
      marker: optionalText(item?.marker, 80),
      summary: optionalText(item?.summary, 500)
    }))
    .filter(item => item.id && item.name);
}

function publicAlert(input = {}) {
  const audience = (Array.isArray(input.audience) ? input.audience : [])
    .map(item => text(item, 40).toLowerCase())
    .filter(item => item === "public");
  return {
    id: text(input.id, 120),
    active: input.active === true,
    severity: text(input.severity, 20) || "info",
    title: text(input.title, 160),
    message: text(input.message, 2000),
    audience: audience.length ? ["public"] : [],
    updatedAt: optionalText(input.updatedAt, 40),
    expiresAt: optionalText(input.expiresAt, 40)
  };
}

export function publicAppBootstrap(input = {}, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const output = {
    guide: publicEventGuide(source.guide),
    schedule: publicSchedule(source.schedule),
    zones: publicZones(source.zones),
    alert: publicAlert(source.alert)
  };
  if (options.includeBoardRuntime === true && source.runtime?.mode === "board_demo") {
    output.runtime = {
      mode: "board_demo",
      label: text(source.runtime.label, 180) || "Board demonstration | Synthetic data"
    };
  }
  return output;
}

function unknownKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => !allowed.has(key));
}

export function publicAppBootstrapSafety(input = {}, options = {}) {
  const errors = [];
  const rootUnknown = unknownKeys(input, ROOT_KEYS);
  if (rootUnknown.length) errors.push(`Unexpected public bootstrap keys: ${rootUnknown.join(", ")}.`);
  const guideUnknown = unknownKeys(input.guide, GUIDE_KEYS);
  if (guideUnknown.length) errors.push(`Unexpected public guide keys: ${guideUnknown.join(", ")}.`);
  for (const [index, item] of (Array.isArray(input.schedule) ? input.schedule : []).entries()) {
    const unknown = unknownKeys(item, SCHEDULE_KEYS);
    if (unknown.length) errors.push(`Unexpected public schedule keys at ${index}: ${unknown.join(", ")}.`);
    if (!PUBLIC_SCHEDULE_CATEGORIES.has(text(item?.category, 40).toLowerCase())) {
      errors.push(`Schedule entry ${index} is not in an approved public category.`);
    }
  }
  for (const [index, item] of (Array.isArray(input.zones) ? input.zones : []).entries()) {
    const unknown = unknownKeys(item, ZONE_KEYS);
    if (unknown.length) errors.push(`Unexpected public zone keys at ${index}: ${unknown.join(", ")}.`);
  }
  const alertUnknown = unknownKeys(input.alert, ALERT_KEYS);
  if (alertUnknown.length) errors.push(`Unexpected public alert keys: ${alertUnknown.join(", ")}.`);
  if (input.runtime) {
    const runtimeUnknown = unknownKeys(input.runtime, RUNTIME_KEYS);
    if (runtimeUnknown.length) errors.push(`Unexpected public runtime keys: ${runtimeUnknown.join(", ")}.`);
    if (options.allowBoardRuntime !== true || input.runtime.mode !== "board_demo") {
      errors.push("Public runtime metadata is allowed only for an explicit board demonstration.");
    }
  }
  return {
    ready: errors.length === 0,
    errors
  };
}

export const publicAppBootstrapPolicy = Object.freeze({
  rootKeys: [...ROOT_KEYS],
  scheduleCategories: [...PUBLIC_SCHEDULE_CATEGORIES]
});
