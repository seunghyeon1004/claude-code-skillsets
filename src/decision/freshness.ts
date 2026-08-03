/** A decision catalog is usable only for its fixed observed time window. */
export function isDecisionCatalogCurrent(
  observedThrough: string,
  catalogExpiresAt: string,
  asOf: string
): boolean {
  const observed = Date.parse(observedThrough);
  const expires = Date.parse(catalogExpiresAt);
  const requested = Date.parse(asOf);
  return Number.isFinite(observed) && Number.isFinite(expires) && Number.isFinite(requested)
    && observed <= requested && requested < expires;
}

export function decisionCatalogHoldReason(
  observedThrough: string,
  catalogExpiresAt: string,
  asOf: string
): "catalog-not-current" | "catalog-expired" {
  const observed = Date.parse(observedThrough);
  const requested = Date.parse(asOf);
  if (Number.isFinite(observed) && Number.isFinite(requested) && requested < observed) {
    return "catalog-not-current";
  }
  return "catalog-expired";
}
