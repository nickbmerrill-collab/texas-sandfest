const PRESETS = Object.freeze({
  sponsor: Object.freeze({
    organizationName: "Coastal Community Bank",
    contactName: "Morgan Reyes",
    contactPhone: "+13615550131",
    packageId: "tarpon",
    website: "https://coastal-community-bank.example/",
    description: "Community banking partner supporting scholarships, volunteer hospitality, and a family beach activation."
  }),
  vendor: Object.freeze({
    organizationName: "Port A Coastal Makers",
    contactName: "Casey Morgan",
    contactPhone: "+13615550132",
    category: "artisan",
    vendorOfferingId: "marketplace-booth",
    website: "https://port-a-coastal-makers.example/",
    city: "Port Aransas",
    state: "TX",
    description: "Original coastal artwork and locally made gifts for one standard marketplace booth."
  })
});

export function boardPartnerFormPreset(kind, runId) {
  const preset = PRESETS[kind];
  if (!preset || !/^[a-z0-9-]{4,40}$/i.test(String(runId || ""))) {
    throw new Error("A valid board partner preset is required.");
  }
  return {
    kind,
    fields: {
      ...preset,
      contactEmail: kind === "sponsor"
        ? `morgan.sponsor.${runId}@example.com`
        : `casey.vendor.${runId}@example.com`
    }
  };
}
