export function applyVendorApplicationPrefill(form, render) {
  const params = new URLSearchParams(location.search);
  const category = params.get("vendorCategory");
  if ([...form.elements.category.options].some(item => item.value === category)) {
    form.elements.category.value = category;
    render();
  }
  const offering = params.get("vendorOffering");
  if ([...form.elements.vendorOfferingId.options].some(item => item.value === offering)) {
    form.elements.vendorOfferingId.value = offering;
    render();
  }
  if (location.hash === `#${form.id}`) form.scrollIntoView();
}
