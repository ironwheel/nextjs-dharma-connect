/**
 * Sentinel offering-config oid for subEvents.<key>.offeringMode when registration
 * should skip the offering step. No row is loaded from offering-config.
 */
export const NO_OFFERING_MODE_OID = 'none';

export function isNoOfferingMode(oid: string | undefined | null): boolean {
  return typeof oid === 'string' && oid.trim().toLowerCase() === NO_OFFERING_MODE_OID;
}

export function subEventRequiresOffering(se: { offeringMode?: string } | undefined | null): boolean {
  const oid = se?.offeringMode;
  return typeof oid === 'string' && oid.trim() !== '' && !isNoOfferingMode(oid);
}

export function eventRequiresOffering(
  event: { subEvents?: Record<string, { offeringMode?: string }> } | null | undefined,
): boolean {
  const subEvents = event?.subEvents;
  if (!subEvents || typeof subEvents !== 'object') return false;
  return Object.values(subEvents).some(subEventRequiresOffering);
}

/** Subevent keys that participate in registration offering (excludes no-offering sentinel). */
export function offeringSubEventNames(
  event: { subEvents?: Record<string, { offeringMode?: string }> } | null | undefined,
): string[] {
  const subEvents = event?.subEvents;
  if (!subEvents) return [];
  return Object.entries(subEvents)
    .filter(([, se]) => subEventRequiresOffering(se))
    .map(([name]) => name);
}

export function subEventHasOfferingsConfig(
  se: { offeringMode?: string } | undefined,
  configs: Record<string, unknown>,
): boolean {
  const oid = se?.offeringMode;
  if (!subEventRequiresOffering(se)) return false;
  return !!oid && !!configs[oid];
}
