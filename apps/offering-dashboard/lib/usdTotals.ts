/**
 * US-dollar totals for the offering dashboard.
 *
 * Rows show each payment in the currency it was made in, but totals must add like with like, so every
 * payment is counted at the USD amount Stripe settled. Stripe fees are already in USD; KM fees are
 * recorded in the payment's own currency and are converted at the payment's exchange rate. A payment
 * whose rate isn't recorded yet (a new one, until the cache builder fetches it from Stripe) is
 * estimated with the most recent known rate for its currency.
 */

export type UsdConvertible = {
    status?: string;
    currency?: string;
    timestamp?: string;
    /** KM fee in dollars, in the payment's own currency. */
    kmFee?: number;
    payerData?: { amount?: number; fee?: number; [key: string]: any };
    /** USD cents equivalent to payerData.amount, when known. */
    usdAmount?: number;
    /** USD per unit of the payment's currency, when known (1 for USD). */
    exchangeRate?: number;
    [key: string]: any;
};

export type UsdTotals = {
    count: number;
    amount: number;
    stripeFee: number;
    kmFee: number;
    net: number;
    /** Payments converted with an estimated rate. */
    estimated: number;
    /** Payments left out of the amounts because no rate is known for their currency. */
    unconverted: number;
};

function currencyOf(t: UsdConvertible): string {
    return (t.currency || 'USD').toUpperCase();
}

function knownRate(t: UsdConvertible): number | undefined {
    if (currencyOf(t) === 'USD') return 1;
    return typeof t.exchangeRate === 'number' && t.exchangeRate > 0 ? t.exchangeRate : undefined;
}

function latestKnownRates(txs: UsdConvertible[]): Map<string, number> {
    const latest = new Map<string, { time: number; rate: number }>();
    for (const t of txs) {
        const currency = currencyOf(t);
        const rate = knownRate(t);
        if (currency === 'USD' || rate === undefined) continue;
        const time = Date.parse(t.timestamp || '') || 0;
        const seen = latest.get(currency);
        if (!seen || time > seen.time) latest.set(currency, { time, rate });
    }
    return new Map(Array.from(latest, ([currency, { rate }]) => [currency, rate]));
}

export function calculateUsdTotals(txs: UsdConvertible[]): UsdTotals {
    const total: UsdTotals = { count: 0, amount: 0, stripeFee: 0, kmFee: 0, net: 0, estimated: 0, unconverted: 0 };
    const fallbackRates = latestKnownRates(txs);
    for (const t of txs) {
        total.count += 1;
        const currency = currencyOf(t);
        const recorded = knownRate(t);
        const rate = recorded ?? fallbackRates.get(currency);
        if (rate === undefined) {
            total.unconverted += 1;
            continue;
        }
        if (recorded === undefined || (currency !== 'USD' && t.usdAmount === undefined)) total.estimated += 1;

        const amount = t.usdAmount ?? Math.round((t.payerData?.amount || 0) * rate);
        const fee = t.payerData?.fee || 0; // Stripe reports its fee in USD
        if (t.status === 'REFUNDED') {
            total.amount += amount;
            total.stripeFee += fee;
            total.net += -(amount + fee);
        } else {
            const km = Math.round((t.kmFee || 0) * 100 * rate);
            total.amount += amount;
            total.stripeFee += fee;
            total.kmFee += km;
            total.net += amount - (fee + km);
        }
    }
    return total;
}
