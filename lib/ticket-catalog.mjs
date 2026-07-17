function publicProduct(product, { checkoutEnabled }) {
  return {
    id: String(product?.id || ""),
    name: String(product?.name || ""),
    category: String(product?.category || "ticket"),
    priceLabel: String(product?.priceLabel || ""),
    unitAmount: Number.isInteger(product?.unitAmount) ? product.unitAmount : null,
    quantity: {
      min: Number.isInteger(product?.quantity?.min) ? product.quantity.min : 1,
      max: Number.isInteger(product?.quantity?.max) ? product.quantity.max : 12
    },
    checkoutMode: String(product?.checkoutMode || "payment"),
    requiresReview: product?.requiresReview === true,
    fulfillment: String(product?.fulfillment || "manual_review"),
    description: String(product?.description || ""),
    terms: Array.isArray(product?.terms) ? product.terms.map(item => String(item)).filter(Boolean).slice(0, 20) : [],
    availableForCheckout: checkoutEnabled === true
      && product?.active !== false
      && product?.requiresReview !== true
      && /^price_[A-Za-z0-9_]+$/.test(product?.stripePriceId || "")
      && !String(product?.stripePriceId || "").startsWith("price_replace")
      && Number.isInteger(product?.unitAmount)
      && product.unitAmount > 0
  };
}

export function publicTicketCatalog(catalogInput, options = {}) {
  const catalog = catalogInput && typeof catalogInput === "object" ? catalogInput : {};
  return {
    lastUpdated: catalog.lastUpdated || null,
    currency: String(catalog.currency || "usd").toLowerCase(),
    provider: "stripe",
    checkoutEndpoint: "/api/stripe/create-checkout-session",
    applePay: catalog.applePay && typeof catalog.applePay === "object"
      ? {
          status: String(catalog.applePay.status || "not_configured"),
          webDomain: String(catalog.applePay.webDomain || "")
        }
      : { status: "not_configured", webDomain: "" },
    products: (Array.isArray(catalog.products) ? catalog.products : [])
      .filter(product => product?.active !== false)
      .map(product => publicProduct(product, options))
      .filter(product => product.id && product.name)
  };
}
