/**
 * Stateless installments: paid total and sequential key helpers.
 * Sum traverses all installment line keys except the `refunded` aggregate bucket.
 * Legacy payment key names (deposit/balance/installmentN) are ignored only for sequencing, not for amounts.
 */

export function sumInstallmentPaymentsCents(installments: Record<string, unknown> | undefined): number {
  if (!installments || typeof installments !== 'object') return 0;
  let total = 0;
  for (const [key, entry] of Object.entries(installments)) {
    if (key === 'refunded') continue;
    const cents = Number((entry as { offeringAmount?: unknown })?.offeringAmount);
    if (Number.isFinite(cents)) total += cents;
  }
  return total;
}

/** Next N for installmentN (1-based). Only keys matching /^installment(\d+)$/i participate; legacy deposit/balance do not consume numbers. */
export function nextSequentialInstallmentNumber(installments: Record<string, unknown> | undefined): number {
  let max = 0;
  for (const key of Object.keys(installments || {})) {
    const match = key.match(/^installment(\d+)$/i);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** True if subevent history shows any offering activity (classic SKU or installment payments). */
export function subeventHasOfferingActivity(subEntry: Record<string, unknown> | undefined): boolean {
  if (!subEntry || typeof subEntry !== 'object') return false;
  if ((subEntry as { offeringSKU?: unknown }).offeringSKU != null && String((subEntry as { offeringSKU?: unknown }).offeringSKU).trim() !== '') {
    return true;
  }
  const inst = (subEntry as { installments?: Record<string, unknown> }).installments;
  return sumInstallmentPaymentsCents(inst) > 0;
}

/**
 * When installments + limitFee + config.offeringLimitFeeCount apply, only the first N selected
 * retreats (in Object.entries iteration order) contribute to minimum/balance totals.
 */
export function applyInstallmentsLimitFeeToSelectedRetreats(
  selectedRetreatsInOrder: string[],
  program: { limitFee?: boolean } | undefined | null,
  offeringLimitFeeCount: unknown,
): string[] {
  if (!selectedRetreatsInOrder.length) return selectedRetreatsInOrder;
  if (!program?.limitFee) return selectedRetreatsInOrder;
  if (typeof offeringLimitFeeCount === 'boolean') return selectedRetreatsInOrder;
  const n = Number(offeringLimitFeeCount);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n >= selectedRetreatsInOrder.length) {
    return selectedRetreatsInOrder;
  }
  return selectedRetreatsInOrder.slice(0, n);
}

/** Sum installment payments across all subevents; convert to cents for comparison to config thresholds. */
export function installmentsPaidCentsForCompare(
  offeringHistory: Record<string, unknown> | undefined,
  historyUsesCents: boolean,
): number {
  let raw = 0;
  if (offeringHistory && typeof offeringHistory === 'object') {
    for (const sub of Object.values(offeringHistory)) {
      const inst =
        sub && typeof sub === 'object'
          ? (sub as { installments?: Record<string, unknown> }).installments
          : undefined;
      raw += sumInstallmentPaymentsCents(inst);
    }
  }
  if (historyUsesCents) return Math.round(raw);
  return Math.round(raw * 100);
}
