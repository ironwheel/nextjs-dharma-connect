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
