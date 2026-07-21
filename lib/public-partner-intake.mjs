export function publicPartnerIntakeReadiness({ production = false, turnstileSiteKey = "" } = {}) {
  const protectedByTurnstile = Boolean(String(turnstileSiteKey || "").trim());
  const ready = !production || protectedByTurnstile;
  return {
    ready,
    protectedByTurnstile,
    message: ready
      ? ""
      : "Protected partner requests are unavailable in this preview."
  };
}
