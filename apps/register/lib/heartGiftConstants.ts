import { isNoOfferingMode } from './offeringModeConstants';

/** Synthetic cart person id for anonymous heart gifts (no student offeringHistory write). */
export const ANONYMOUS_HEART_GIFT_CART_ID = '__anonymous__';

/** Default shortcut amounts when offering-config.amounts is empty. */
export const HEART_GIFT_SHORTCUT_AMOUNTS = [27, 54, 108, 162] as const;

export type HeartGiftServiceCredentials = { pid: string; hash: string };

export type SubEventHeartGiftFields = {
  offeringMode?: string;
  /** Dedicated offering-config oid for anonymous / Zoom heart gift (variable mode). */
  heartGiftOfferingMode?: string;
};

export function getHeartGiftServiceCredentials(): HeartGiftServiceCredentials | null {
  const pid = process.env.NEXT_PUBLIC_HEART_GIFT_PID?.trim();
  const hash = process.env.NEXT_PUBLIC_HEART_GIFT_HASH?.trim();
  if (!pid || !hash) return null;
  return { pid, hash };
}

export function isHeartGiftMode(mode: string | string[] | undefined): boolean {
  const m = Array.isArray(mode) ? mode[0] : mode;
  return m === 'heartGift';
}

export type OfferingConfigLike = {
  oid?: string;
  amounts?: number[];
  fees?: number[];
  prompts?: string[];
  config?: Record<string, unknown>;
};

export function isHeartGiftConfig(oc: OfferingConfigLike | null | undefined): boolean {
  return oc?.config?.mode === 'variable';
}

/** Offering-config oid used for heart gift on this subevent (heartGiftOfferingMode preferred). */
export function getHeartGiftOfferingOid(
  se: SubEventHeartGiftFields | undefined,
  configs: Record<string, OfferingConfigLike>,
): string | null {
  if (!se) return null;
  const hgOid = typeof se.heartGiftOfferingMode === 'string' ? se.heartGiftOfferingMode.trim() : '';
  if (hgOid) return hgOid;
  const mainOid = se.offeringMode;
  if (mainOid && isHeartGiftConfig(configs[mainOid])) return mainOid;
  return null;
}

/** Collect all offering-config oids needed to evaluate heart gift on an event. */
export function collectHeartGiftOfferingOids(
  subEvents: Record<string, SubEventHeartGiftFields> | undefined,
): string[] {
  const oids = new Set<string>();
  if (!subEvents) return [];
  Object.values(subEvents).forEach((se) => {
    if (se?.offeringMode && !isNoOfferingMode(se.offeringMode)) oids.add(se.offeringMode);
    const hg = typeof se?.heartGiftOfferingMode === 'string' ? se.heartGiftOfferingMode.trim() : '';
    if (hg) oids.add(hg);
  });
  return [...oids];
}

/** Dollar amounts for shortcut buttons (from config.amounts, else defaults). */
export function heartGiftShortcutAmountsFromConfig(oc: OfferingConfigLike | null | undefined): number[] {
  const amounts = oc?.amounts;
  if (!Array.isArray(amounts)) return [...HEART_GIFT_SHORTCUT_AMOUNTS];
  const positive = amounts.map((a) => Number(a)).filter((a) => Number.isFinite(a) && a > 0);
  if (positive.length === 0) return [...HEART_GIFT_SHORTCUT_AMOUNTS];
  return positive;
}

/** List subevent keys that have a valid heart gift offering-config. */
export function listHeartGiftSubEventKeys(
  subEvents: Record<string, SubEventHeartGiftFields> | undefined,
  configs: Record<string, OfferingConfigLike>,
): string[] {
  if (!subEvents) return [];
  return Object.keys(subEvents).filter((key) => {
    const oid = getHeartGiftOfferingOid(subEvents[key], configs);
    return oid != null && isHeartGiftConfig(configs[oid]);
  });
}

export function resolveHeartGiftSubEvent(
  subEvents: Record<string, SubEventHeartGiftFields> | undefined,
  configs: Record<string, OfferingConfigLike>,
  subEventParam: string | undefined,
): { subEventKey: string } | { error: string } {
  const keys = listHeartGiftSubEventKeys(subEvents, configs);
  if (keys.length === 0) {
    return {
      error:
        'No heart gift offering is configured for this event. Set subEvents.<key>.heartGiftOfferingMode to a variable offering-config oid.',
    };
  }
  if (subEventParam && subEventParam.trim()) {
    const key = subEventParam.trim();
    if (!keys.includes(key)) {
      const se = subEvents?.[key];
      const hgOid = typeof se?.heartGiftOfferingMode === 'string' ? se.heartGiftOfferingMode.trim() : '';
      if (hgOid && !isHeartGiftConfig(configs[hgOid])) {
        return {
          error: `Offering "${hgOid}" must have config.mode === "variable" for heart gift.`,
        };
      }
      return { error: `Subevent "${key}" is not configured as a heart gift for this event.` };
    }
    return { subEventKey: key };
  }
  if (keys.length === 1) {
    return { subEventKey: keys[0] };
  }
  return {
    error: `Multiple heart gift subevents (${keys.join(', ')}). Add subEvent= to the URL.`,
  };
}
