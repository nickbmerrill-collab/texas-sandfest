const NOTICES = Object.freeze({
  sponsor_application: Object.freeze({
    version: "sponsor-contact-v1-2026-07-18",
    disclosure: "Texas SandFest uses these details to review this sponsorship inquiry, respond to the contact provided, and operate the private partner status portal. Do not submit payment card, bank, tax ID, or health information here.",
    checkboxLabel: "I agree that Texas SandFest may store these details and contact me about this sponsorship inquiry."
  }),
  vendor_interest: Object.freeze({
    version: "vendor-interest-contact-v1-2026-07-18",
    disclosure: "Texas SandFest uses these details to review vendor interest, notify the contact provided when applications open, and operate the private partner status portal. Do not submit payment card, bank, tax ID, or health information here.",
    checkboxLabel: "I agree that Texas SandFest may store these details and contact me about vendor opportunities."
  }),
  vendor_application: Object.freeze({
    version: "vendor-application-contact-v1-2026-07-18",
    disclosure: "Texas SandFest uses these details to review this vendor application, coordinate onboarding, and operate the private partner status portal. Do not submit payment card, bank, tax ID, or health information here.",
    checkboxLabel: "I agree that Texas SandFest may store these details and contact me about this vendor application."
  })
});

export function partnerContactNotice(type, intakeMode = "application") {
  const key = type === "sponsor"
    ? "sponsor_application"
    : intakeMode === "interest" ? "vendor_interest" : "vendor_application";
  return NOTICES[key];
}
