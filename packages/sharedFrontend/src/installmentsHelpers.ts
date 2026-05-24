/**
 * Stateless installments: paid total and sequential key helpers.
 * Received sums exclude refunded lines: legacy `refunded` bucket key or `offeringRefund === true`.
 * Legacy payment key names (deposit/balance/installmentN) are ignored only for sequencing, not for amounts.
 */

export type InstallmentLine = {
  offeringAmount?: unknown;
  offeringRefund?: unknown;
  offeringTime?: unknown;
};

/** Legacy bucket key or refund-approve / reconcile `offeringRefund` flag. */
export function isInstallmentLineRefunded(installmentKey: string, entry: unknown): boolean {
  if (installmentKey === 'refunded') return true;
  if (!entry || typeof entry !== 'object') return false;
  return (entry as InstallmentLine).offeringRefund === true;
}

function installmentAmountRaw(entry: unknown): number {
  const amount = Number((entry as InstallmentLine)?.offeringAmount);
  return Number.isFinite(amount) ? amount : 0;
}

/** Sum non-refunded installment payment amounts (received / paid-so-far). */
export function sumInstallmentPaymentsCents(installments: Record<string, unknown> | undefined): number {
  if (!installments || typeof installments !== 'object') return 0;
  let total = 0;
  for (const [key, entry] of Object.entries(installments)) {
    if (isInstallmentLineRefunded(key, entry)) continue;
    total += installmentAmountRaw(entry);
  }
  return total;
}

/** Sum refunded installment amounts (`refunded` bucket and `offeringRefund` lines). */
export function sumInstallmentRefundedCents(installments: Record<string, unknown> | undefined): number {
  if (!installments || typeof installments !== 'object') return 0;
  let total = 0;
  for (const [key, entry] of Object.entries(installments)) {
    if (!isInstallmentLineRefunded(key, entry)) continue;
    total += installmentAmountRaw(entry);
  }
  return total;
}

/** Sum received installment amounts across all subevents in an offeringHistory object. */
export function sumOfferingHistoryInstallmentPaymentsCents(
  offeringHistory: Record<string, unknown> | undefined,
): number {
  if (!offeringHistory || typeof offeringHistory !== 'object') return 0;
  let total = 0;
  for (const sub of Object.values(offeringHistory)) {
    if (!sub || typeof sub !== 'object') continue;
    const inst = (sub as { installments?: Record<string, unknown> }).installments;
    total += sumInstallmentPaymentsCents(inst);
  }
  return total;
}

/** Sum refunded installment amounts across all subevents in an offeringHistory object. */
export function sumOfferingHistoryInstallmentRefundedCents(
  offeringHistory: Record<string, unknown> | undefined,
): number {
  if (!offeringHistory || typeof offeringHistory !== 'object') return 0;
  let total = 0;
  for (const sub of Object.values(offeringHistory)) {
    if (!sub || typeof sub !== 'object') continue;
    const inst = (sub as { installments?: Record<string, unknown> }).installments;
    total += sumInstallmentRefundedCents(inst);
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
  const raw = sumOfferingHistoryInstallmentPaymentsCents(offeringHistory);
  if (historyUsesCents) return Math.round(raw);
  return Math.round(raw * 100);
}
