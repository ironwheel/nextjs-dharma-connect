/**
 * @file packages/api/lib/offering.ts
 * @description Offering flow: offering-transactions table and completion (write offeringHistory to students).
 */
import { nextSequentialInstallmentNumber } from 'sharedFrontend/installmentsHelpers';
import { tableGetConfig } from './tableConfig';
import { getOne, putOne, updateItem } from './dynamoClient';
import { stripeRetrievePaymentIntentForOfferingAugmentation } from './stripe';

export type OfferingTransactionStatus = 'pending' | 'succeeded' | 'abandoned' | 'refunded';

export interface OfferingTransactionRecord {
  paymentIntentId: string;
  status: OfferingTransactionStatus;
  createdAt: string;
  updatedAt: string;
  succeededAt?: string;
  refundedAt?: string;
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

  // Dashboard-ready augmentation (for offering-dashboard + caching).
  dashboardStripeFeeCents?: number;
  dashboardKmFeeDollars?: number; // Stored in dollars; dashboard multiplies by 100.
  dashboardAmountCents?: number; // Amount excluding kmFee.
  dashboardStatus?: 'COMPLETED' | 'REFUNDED' | 'PENDING';
  dashboardStep?: string; // e.g. 'confirmCardPayment'
  dashboardTimestamp?: string; // Timestamp for year/month filters.

  // Card metadata for receipt display.
  card?: { brand?: string; last4?: string };
}

function stripInstallmentsSubeventPseudoFields(entry: Record<string, any>): void {
  delete entry.offeringIntent;
  delete entry.offeringSKU;
  delete entry.offeringAmount;
  delete entry.offeringTime;
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

  const willBeRefunded = status === 'refunded';
  const shouldSetRefundedAt = willBeRefunded && (existing as any)?.refundedAt == null;
  await updateItem(
    cfg.tableName,
    { [cfg.pk]: paymentIntentId },
    [
      'SET #refundedAmount = :refundedAmount',
      '#updatedAt = :updatedAt',
      '#status = :status',
      willBeRefunded ? '#dashboardStatus = :dashboardStatus' : '#dashboardStatus = :dashboardStatus',
      shouldSetRefundedAt ? '#refundedAt = :refundedAt' : undefined,
    ]
      .filter(Boolean)
      .join(', '),
    {
      ':refundedAmount': refundedAmount,
      ':updatedAt': now,
      ':status': status,
      ':dashboardStatus': willBeRefunded ? 'REFUNDED' : 'COMPLETED',
      ...(shouldSetRefundedAt ? { ':refundedAt': now } : {}),
    },
    {
      '#refundedAmount': 'refundedAmount',
      '#updatedAt': 'updatedAt',
      '#status': 'status',
      '#dashboardStatus': 'dashboardStatus',
      ...(shouldSetRefundedAt ? { '#refundedAt': 'refundedAt' } : {}),
    },
    roleArn,
    oidcToken
  );
}

/**
 * Update offering-transactions record to succeeded (set status and succeededAt).
 */
export async function updateOfferingTransactionSucceeded(
  paymentIntentId: string,
  dashboardStripeFeeCents: number | undefined,
  dashboardKmFeeDollars: number | undefined,
  dashboardAmountCents: number | undefined,
  cardBrand: string | undefined,
  cardLast4: string | undefined,
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const cfg = tableGetConfig('offering-transactions');
  const now = new Date().toISOString();

  const card = cardBrand || cardLast4 ? { brand: cardBrand, last4: cardLast4 } : undefined;

  const setParts: string[] = [
    '#status = :status',
    '#updatedAt = :updatedAt',
    '#succeededAt = :succeededAt',
    '#dashboardStatus = :dashboardStatus',
    '#dashboardStep = :dashboardStep',
    '#dashboardTimestamp = :dashboardTimestamp',
  ];
  const exprValues: Record<string, any> = {
    ':status': 'succeeded',
    ':updatedAt': now,
    ':succeededAt': now,
    ':dashboardStatus': 'COMPLETED',
    ':dashboardStep': 'confirmCardPayment',
    ':dashboardTimestamp': now,
  };
  const exprNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#succeededAt': 'succeededAt',
    '#dashboardStatus': 'dashboardStatus',
    '#dashboardStep': 'dashboardStep',
    '#dashboardTimestamp': 'dashboardTimestamp',
  };

  if (dashboardStripeFeeCents != null) {
    setParts.push('#dashboardStripeFeeCents = :dashboardStripeFeeCents');
    exprValues[':dashboardStripeFeeCents'] = dashboardStripeFeeCents;
    exprNames['#dashboardStripeFeeCents'] = 'dashboardStripeFeeCents';
  }

  if (dashboardKmFeeDollars != null) {
    setParts.push('#dashboardKmFeeDollars = :dashboardKmFeeDollars');
    exprValues[':dashboardKmFeeDollars'] = dashboardKmFeeDollars;
    exprNames['#dashboardKmFeeDollars'] = 'dashboardKmFeeDollars';
  }

  if (dashboardAmountCents != null) {
    setParts.push('#dashboardAmountCents = :dashboardAmountCents');
    exprValues[':dashboardAmountCents'] = dashboardAmountCents;
    exprNames['#dashboardAmountCents'] = 'dashboardAmountCents';
  }

  if (card) {
    setParts.push('#card = :card');
    exprValues[':card'] = card;
    exprNames['#card'] = 'card';
  }

  await updateItem(
    cfg.tableName,
    { [cfg.pk]: paymentIntentId },
    `SET ${setParts.join(', ')}`,
    exprValues,
    exprNames,
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
    const isInstallments = obj.offeringIntent === 'installments' || obj.installments === true;
    if (isInstallments && obj.offeringAmount != null) {
      entry.installments = entry.installments || {};
      const installments = entry.installments as Record<string, any>;
      stripInstallmentsSubeventPseudoFields(entry);

      const paymentAmount = Number(obj.offeringAmount);
      const installmentN = nextSequentialInstallmentNumber(installments);
      const installmentKey = `installment${installmentN}`;

      installments[installmentKey] = {
        offeringAmount: paymentAmount,
        offeringIntent: paymentIntentId,
        offeringSKU: obj.offeringSKU,
        offeringTime: now,
      };
      entry.installments = installments;
      stripInstallmentsSubeventPseudoFields(entry);
      continue;
    }

    entry.offeringIntent = paymentIntentId;
    entry.offeringTime = now;
    if (obj.offeringSKU != null) entry.offeringSKU = obj.offeringSKU;
    if (obj.offeringAmount != null) entry.offeringAmount = obj.offeringAmount;
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
  options: { mockPayment?: boolean } | undefined,
  roleArn: string,
  oidcToken?: string
): Promise<void> {
  const useMockPayment = options?.mockPayment === true;
  let pi: any = null;
  if (!useMockPayment) {
    pi = await stripeRetrievePaymentIntentForOfferingAugmentation(paymentIntentId);
    if (pi.status !== 'succeeded') {
      throw new Error(`PaymentIntent ${paymentIntentId} is not succeeded (status: ${pi.status})`);
    }
  }

  const txCfg = tableGetConfig('offering-transactions');
  const existing = await getOne(txCfg.tableName, txCfg.pk, paymentIntentId, roleArn, oidcToken);
  if (existing && (existing as any).status === 'succeeded') {
    return;
  }

  // Best-effort extraction from the single PI retrieve call.
  const latestCharge = (pi as any)?.latest_charge;
  const balanceTxnFee = (latestCharge as any)?.balance_transaction?.fee;
  const dashboardStripeFeeCents = useMockPayment ? 0 : (balanceTxnFee != null ? Number(balanceTxnFee) : undefined);

  const cardBrand = useMockPayment ? 'visa' : (latestCharge as any)?.payment_method_details?.card?.brand;
  const cardLast4 = useMockPayment ? '4242' : (latestCharge as any)?.payment_method_details?.card?.last4;

  const skuSummary = (existing as any)?.skuSummary ?? [];
  const kmLine = Array.isArray(skuSummary) ? skuSummary.find((x: any) => x?.subEvent === 'kmFee') : undefined;
  const kmFeeCents = kmLine?.amountCents != null ? Number(kmLine.amountCents) : 0;
  const dashboardKmFeeDollars = kmFeeCents ? kmFeeCents / 100 : 0;

  const recordAmount = typeof (existing as any)?.amount === 'number' ? (existing as any).amount : undefined;
  const dashboardAmountCents = recordAmount != null ? recordAmount - kmFeeCents : undefined;

  await updateOfferingTransactionSucceeded(
    paymentIntentId,
    dashboardStripeFeeCents,
    dashboardKmFeeDollars,
    dashboardAmountCents,
    cardBrand,
    cardLast4,
    roleArn,
    oidcToken
  );

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
