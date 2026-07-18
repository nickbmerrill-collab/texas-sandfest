import { normalizeIslandConditions } from "./island-conditions.mjs";

export function boardDemoSyntheticConditions(docInput, now = new Date().toISOString()) {
  const doc = normalizeIslandConditions(docInput);
  const observedAt = new Date(now);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("Board condition time is invalid.");
  const observedAtIso = observedAt.toISOString();
  const validFrom = new Date(observedAt.getTime() - 5 * 60_000).toISOString();
  const validUntil = new Date(observedAt.getTime() + 90 * 60_000).toISOString();
  return {
    ...doc,
    lastUpdated: observedAtIso,
    weather: {
      status: "live",
      observedAt: observedAtIso,
      source: "Board weather simulation",
      sourceUrl: null,
      temperatureF: 84,
      windSpeed: "9 mph",
      windDirection: "SE",
      shortForecast: "Synthetic coastal conditions",
      precipitationChancePct: 10,
      validFrom,
      validUntil,
      alerts: [],
      refreshAttemptedAt: observedAtIso,
      refreshError: null
    },
    ferry: {
      status: "live",
      route: "Port Aransas - Aransas Pass",
      source: "Board ferry simulation",
      sourceUrl: null,
      observedAt: observedAtIso,
      checkedAt: observedAtIso,
      estimatedWaitMinutes: 15,
      operatingFerries: 4,
      directions: [
        { id: "to-port-aransas", label: "To Port Aransas", status: "live", observedAt: observedAtIso, estimatedWaitMinutes: 15, notice: null },
        { id: "to-aransas-pass", label: "To Aransas Pass", status: "live", observedAt: observedAtIso, estimatedWaitMinutes: 10, notice: null }
      ],
      manualOverrideUntil: null,
      refreshAttemptedAt: observedAtIso,
      refreshError: null
    }
  };
}
