export function publicPartnerIntakeReadiness({ production = false, turnstileSiteKey = "", readOnlyLaunch = false } = {}) {
  const protectedByTurnstile = Boolean(String(turnstileSiteKey || "").trim());
  const ready = !readOnlyLaunch && (!production || protectedByTurnstile);
  return {
    ready,
    protectedByTurnstile,
    message: ready
      ? ""
      : readOnlyLaunch
        ? "Online partner requests are not open yet. Use the official Texas SandFest contact information."
        : "Protected partner requests are unavailable in this preview."
  };
}
