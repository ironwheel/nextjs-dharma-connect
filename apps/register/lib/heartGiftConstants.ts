/** Synthetic cart person id for anonymous heart gifts (no student offeringHistory write). */
export const ANONYMOUS_HEART_GIFT_CART_ID = '__anonymous__';

/** Default shortcut amounts when offering-config.amounts is empty. */
export const HEART_GIFT_SHORTCUT_AMOUNTS = [27, 54, 108, 162] as const;

export type HeartGiftServiceCredentials = { pid: string; hash: string };

/** config-table key whose value is the offering-config oid used when a subevent has no override. */
export const DEFAULT_HEART_GIFT_OFFERING_CONFIG_KEY = 'defaultHeartGiftOfferingMode';

export type SubEventHeartGiftFields = {
  /** Registration link is open for this subevent. */
  regLinkAvailable?: boolean;
  /** Optional per-subevent offering-config oid (variable mode); otherwise the config-table default applies. */
  heartGiftOfferingMode?: string;
};

export type HeartGiftEventLike = {
  config?: { reglinkv2?: boolean } & Record<string, unknown>;
  subEvents?: Record<string, SubEventHeartGiftFields>;
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

/** Dollar amounts for shortcut buttons (from config.amounts, else defaults). */
export function heartGiftShortcutAmountsFromConfig(oc: OfferingConfigLike | null | undefined): number[] {
  const amounts = oc?.amounts;
  if (!Array.isArray(amounts)) return [...HEART_GIFT_SHORTCUT_AMOUNTS];
  const positive = amounts.map((a) => Number(a)).filter((a) => Number.isFinite(a) && a > 0);
  if (positive.length === 0) return [...HEART_GIFT_SHORTCUT_AMOUNTS];
  return positive;
}

/** A subevent can take heart gifts when the event uses reglinkv2 and the subevent's registration link is open. */
export function isHeartGiftEligible(
  event: HeartGiftEventLike | null | undefined,
  subEventKey: string,
): boolean {
  return event?.config?.reglinkv2 === true && event?.subEvents?.[subEventKey]?.regLinkAvailable === true;
}

/** Per-subevent offering-config oid override, or null when the config-table default applies. */
export function getHeartGiftOverrideOid(se: SubEventHeartGiftFields | undefined): string | null {
  const oid = typeof se?.heartGiftOfferingMode === 'string' ? se.heartGiftOfferingMode.trim() : '';
  return oid || null;
}

export function resolveHeartGiftSubEvent(
  event: HeartGiftEventLike,
  subEventParam: string | undefined,
): { subEventKey: string } | { error: string } {
  const subEvents = event.subEvents || {};
  if (event.config?.reglinkv2 !== true) {
    return { error: 'Heart gift is not available for this event.' };
  }
  const eligible = Object.keys(subEvents).filter((key) => isHeartGiftEligible(event, key));
  const requested = subEventParam && subEventParam.trim() ? subEventParam.trim() : '';
  if (requested) {
    if (!subEvents[requested]) {
      return { error: `Subevent "${requested}" does not exist on this event.` };
    }
    if (!eligible.includes(requested)) {
      return { error: `Heart gift is not available for subevent "${requested}".` };
    }
    return { subEventKey: requested };
  }
  if (eligible.length === 0) {
    return { error: 'No heart gift is available for this event.' };
  }
  if (eligible.length === 1) {
    return { subEventKey: eligible[0] };
  }
  return {
    error: `Multiple subevents accept heart gifts (${eligible.join(', ')}). Add subEvent= to the URL.`,
  };
}
