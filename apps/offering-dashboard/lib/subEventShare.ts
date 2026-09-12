/**
 * Apportioning of multi-subevent payments for per-subevent dashboard views.
 *
 * One payment can cover several subevents (e.g. "all remaining weekends"). Its amount, Stripe fee
 * and KM fee belong to the whole payment, so a subevent view that sums them counts the full payment
 * in every subevent it touches. These helpers scale a payment down to the selected subevent's share,
 * taken from the per-subevent offering amounts recorded on the payment.
 */

type ApportionableTransaction = {
    payerData?: { amount?: number; fee?: number; net?: number; [key: string]: any };
    kmFee?: number;
    total?: number;
    skuSummary?: Array<{ subEvent?: string; amountCents?: number | string }>;
    cart?: unknown;
    [key: string]: any;
};

function parseCart(raw: unknown): any[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw) {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function shareOf(entries: Array<[string, number]>, subEventKey: string): number | null {
    let selected = 0;
    let all = 0;
    for (const [subEvent, amount] of entries) {
        if (!Number.isFinite(amount) || amount <= 0) continue;
        all += amount;
        if (subEvent === subEventKey) selected += amount;
    }
    if (all <= 0 || selected <= 0) return null;
    return selected / all;
}

/**
 * Fraction (0..1] of a payment that belongs to `subEventKey`. Uses the v2 skuSummary lines, then the
 * cart's currentOfferings; returns 1 when neither identifies the subevent (e.g. heart gifts routed by
 * a backfilled subEvent field), so such payments stay whole.
 */
export function subEventShare(t: ApportionableTransaction, subEventKey: string): number {
    const lines = (Array.isArray(t.skuSummary) ? t.skuSummary : []).filter(
        (x) => typeof x?.subEvent === 'string' && x.subEvent !== 'kmFee',
    );
    const fromLines = shareOf(
        lines.map((x) => [x.subEvent as string, Number(x.amountCents)]),
        subEventKey,
    );
    if (fromLines != null) return fromLines;

    const fromCart = shareOf(
        parseCart(t.cart).flatMap((person) =>
            Object.entries(person?.currentOfferings || {}).map(
                ([subEvent, offering]: [string, any]) => [subEvent, Number(offering?.offeringAmount)] as [string, number],
            ),
        ),
        subEventKey,
    );
    return fromCart ?? 1;
}

/** Returns a copy of `t` whose amount, fees, net and total are scaled to the subevent's share. */
export function apportionTransactionToSubEvent<T extends ApportionableTransaction>(t: T, subEventKey: string): T {
    const share = subEventShare(t, subEventKey);
    if (share >= 1) return t;
    const payerData = t.payerData || {};
    return {
        ...t,
        payerData: {
            ...payerData,
            amount: Math.round((payerData.amount || 0) * share),
            fee: Math.round((payerData.fee || 0) * share),
            net: Math.round((payerData.net || 0) * share),
        },
        kmFee: Math.round((t.kmFee || 0) * 100 * share) / 100,
        total: typeof t.total === 'number' ? Math.round(t.total * 100 * share) / 100 : t.total,
    };
}
