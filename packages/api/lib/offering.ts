/**
 * @file packages/api/lib/offering.ts
 * @description Offering flow: offering-transactions table and completion (write offeringHistory to students).
 */
import { tableGetConfig } from './tableConfig';
import { getOne, putOne, updateItem } from './dynamoClient';
import { stripeRetrievePaymentIntent } from './stripe';

export type OfferingTransactionStatus = 'pending' | 'succeeded' | 'abandoned' | 'refunded';

export interface OfferingTransactionRecord {
  paymentIntentId: string;
  status: OfferingTransactionStatus;
  createdAt: string;
  updatedAt: string;
  succeededAt?: string;
  pid: string;
  eventCode: string;
  eventName?: string;
  amount: number;
  currency: string;
  description?: string;
  cart: any;
  summaryString: string;
  skuSummary: Array<{ personName: string; subEvent: string; offeringSKU?: string; amountCents?: number; currency?: string }>;
  refundedAmount?: number;
  payerEmail?: string;
}

/**
 * Put a new offering-transactions record (status pending). Call after creating Stripe PaymentIntent.
 */
export async function putOfferingTransaction(
  record: Omit<OfferingTransactionRecord, 'status' | 'createdAt' | 'updatedAt'> & { status?: 'pending' },
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const cfg = tableGetConfig('offering-transactions');
  const now = new Date().toISOString();
  const item: Record<string, any> = {
    paymentIntentId: record.paymentIntentId,
    status: record.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
    pid: record.pid,
    eventCode: record.eventCode,
    amount: record.amount,
    currency: record.currency,
    cart: record.cart,
    summaryString: record.summaryString,
    skuSummary: record.skuSummary,
  };
  if (record.eventName != null) item.eventName = record.eventName;
  if (record.description != null) item.description = record.description;
  if (record.payerEmail != null) item.payerEmail = record.payerEmail;
  await putOne(cfg.tableName, item, roleArn, oidcToken);
}

/**
 * Update offering-transactions record with refund amount (accumulate if partial; set status refunded when full).
 */
export async function updateOfferingTransactionRefund(
  paymentIntentId: string,
  thisRefundCents: number,
  totalAmountCents: number,
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const cfg = tableGetConfig('offering-transactions');
  const existing = await getOne(cfg.tableName, cfg.pk, paymentIntentId, roleArn, oidcToken);
  const previousRefunded = (existing as any)?.refundedAmount ?? 0;
  const refundedAmount = previousRefunded + thisRefundCents;
  const now = new Date().toISOString();
  const status = refundedAmount >= totalAmountCents ? 'refunded' : 'succeeded';
  await updateItem(
    cfg.tableName,
    { [cfg.pk]: paymentIntentId },
    'SET #refundedAmount = :refundedAmount, #updatedAt = :updatedAt, #status = :status',
    { ':refundedAmount': refundedAmount, ':updatedAt': now, ':status': status },
    { '#refundedAmount': 'refundedAmount', '#updatedAt': 'updatedAt', '#status': 'status' },
    roleArn,
    oidcToken
  );
}

/**
 * Update offering-transactions record to succeeded (set status and succeededAt).
 */
export async function updateOfferingTransactionSucceeded(
  paymentIntentId: string,
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const cfg = tableGetConfig('offering-transactions');
  const now = new Date().toISOString();
  await updateItem(
    cfg.tableName,
    { [cfg.pk]: paymentIntentId },
    'SET #status = :status, #updatedAt = :updatedAt, #succeededAt = :succeededAt',
    { ':status': 'succeeded', ':updatedAt': now, ':succeededAt': now },
    { '#status': 'status', '#updatedAt': 'updatedAt', '#succeededAt': 'succeededAt' },
    roleArn,
    oidcToken
  );
}

/**
 * Cart person shape (from front-end): id, name, currentOfferings { [subEventName]: { offeringSKU, offeringAmount, offeringIntent?, offeringSelection?, offeringIndex?, installmentName?, ... } }
 */
async function writeOfferingHistoryForPerson(
  personId: string,
  eventCode: string,
  currentOfferings: Record<string, any>,
  paymentIntentId: string,
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const studentsCfg = tableGetConfig('students');
  const student = await getOne(studentsCfg.tableName, studentsCfg.pk, personId, roleArn, oidcToken);
  if (!student) throw new Error(`Student not found: ${personId}`);

  const programs = student.programs || {};
  if (!programs[eventCode]) programs[eventCode] = {};
  const offeringHistory = programs[eventCode].offeringHistory || {};
  const now = new Date().toISOString();

  for (const [subEventName, obj] of Object.entries(currentOfferings || {})) {
    if (!obj || (obj.offeringSKU == null && obj.offeringAmount == null)) continue;
    const subKey = subEventName as string;
    if (!offeringHistory[subKey]) offeringHistory[subKey] = {};
    const entry = offeringHistory[subKey] as any;
    entry.offeringIntent = paymentIntentId;
    entry.offeringTime = now;
    if (obj.offeringSKU != null) entry.offeringSKU = obj.offeringSKU;
    if (obj.offeringAmount != null) entry.offeringAmount = obj.offeringAmount;
    if (obj.installmentName != null && obj.offeringAmount != null) {
      entry.installments = entry.installments || {};
      (entry.installments as any)[obj.installmentName] = {
        offeringAmount: obj.offeringAmount,
        offeringIntent: paymentIntentId,
        offeringSKU: obj.offeringSKU,
      };
    }
  }

  programs[eventCode].offeringHistory = offeringHistory;
  student.programs = programs;
  await putOne(studentsCfg.tableName, student, roleArn, oidcToken);
}

/**
 * Complete offering: verify PaymentIntent succeeded, update transaction record, write offeringHistory for each person in cart.
 * Cart: array of { id, name, currentOfferings: { [subEventName]: { offeringSKU, offeringAmount, ... } }, offeringHistory?: { [subEventName]: { offeringSKU? } } }.
 * subEventNames: keys of event.subEvents (for "remaining" fan-out).
 * Supports "remaining" fan-out: if subEventName === 'remaining', fan out to each subEventName that doesn't yet have an offering for that person.
 */
export async function completeOffering(
  paymentIntentId: string,
  pid: string,
  eventCode: string,
  cart: Array<{ id: string; name: string; currentOfferings?: Record<string, any>; offeringHistory?: Record<string, any> }>,
  subEventNames: string[],
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const pi = await stripeRetrievePaymentIntent(paymentIntentId);
  if (pi.status !== 'succeeded') {
    throw new Error(`PaymentIntent ${paymentIntentId} is not succeeded (status: ${pi.status})`);
  }

  const txCfg = tableGetConfig('offering-transactions');
  const existing = await getOne(txCfg.tableName, txCfg.pk, paymentIntentId, roleArn, oidcToken);
  if (existing && (existing as any).status === 'succeeded') {
    return;
  }

  await updateOfferingTransactionSucceeded(paymentIntentId, roleArn, oidcToken);

  for (const person of cart) {
    const currentOfferings = person.currentOfferings || {};
    const offeringHistory = person.offeringHistory || {};

    const toWrite: Record<string, any> = {};
    for (const [subEventName, obj] of Object.entries(currentOfferings)) {
      if (!obj || (obj.offeringSKU == null && obj.offeringAmount == null)) continue;
      if (subEventName === 'remaining') {
        for (const sub of subEventNames) {
          if (offeringHistory[sub]?.offeringSKU != null) continue;
          toWrite[sub] = { ...obj };
        }
      } else {
        toWrite[subEventName] = obj;
      }
    }
    if (Object.keys(toWrite).length > 0) {
      await writeOfferingHistoryForPerson(person.id, eventCode, toWrite, paymentIntentId, roleArn, oidcToken);
    }
  }
}
