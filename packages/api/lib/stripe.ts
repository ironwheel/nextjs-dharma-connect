/**
 * @file packages/api/lib/stripe.ts
 * @description Stripe integration for payments and refunds.
 */
import {
    DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import nodemailer from 'nodemailer';
import Stripe from 'stripe';
import { tableGetConfig } from './tableConfig';
import { getOne } from './dynamoClient';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-12-18.acacia',
});

const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const AUTH_EMAIL_FROM = process.env.AUTH_EMAIL_FROM;
const AUTH_EMAIL_REPLY_TO = process.env.AUTH_EMAIL_REPLY_TO;

/**
 * @function getPromptsForAid
 * @description Fetches prompts relevant to a given application ID (aid) from DynamoDB.
 * Reuse of pattern from authUtils.ts
 */
async function getPromptsForAid(aid: string): Promise<Array<any>> {
    const tableCfg = tableGetConfig('prompts');
    return await listAllFiltered(tableCfg.tableName, 'aid', aid);
}

/**
 * @function findParticipant
 * @description Finds a participant by ID in DynamoDB (using 'students' resource alias).
 */
async function findParticipant(id: string): Promise<any> {
    const tableCfg = tableGetConfig('students');
    return await getOne(tableCfg.tableName, tableCfg.pk, id);
}

// --- Stripe Operations ---

export async function stripeCreatePaymentIntent(aid: string, pid: string, amount: string, currency: string, description: string) {
    if (!amount || !currency || !description) throw new Error("Missing required parameters for CreatePaymentIntent");

    const paymentIntent = await stripe.paymentIntents.create({
        amount: parseInt(amount, 10),
        currency: currency,
        description: description,
        automatic_payment_methods: {
            enabled: true,
        },
        metadata: { 'aid': aid, 'pid': pid }
    });

    return {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret
    };
}

export async function stripeUpdatePaymentIntent(pmIntentId: string, amount: string) {
    if (!pmIntentId || !amount) throw new Error("Missing required parameters for UpdatePaymentIntent");

    const paymentIntent = await stripe.paymentIntents.update(
        pmIntentId,
        { amount: parseInt(amount, 10) }
    );

    return {
        id: paymentIntent.id
    };
}

export async function stripeRetrieveTransaction(pmIntentId: string) {
    if (!pmIntentId) throw new Error("Missing pmintent");

    const paymentIntent = await stripe.paymentIntents.retrieve(pmIntentId);

    // Get the latest charge ID
    const chargeId = paymentIntent.latest_charge;
    if (!chargeId) {
        throw new Error("No latest_charge found on PaymentIntent");
    }

    // Retrieve the charge to get the balance transaction
    // latest_charge in PaymentIntent is string | Charge, but default retrieval is ID
    const charge = await stripe.charges.retrieve(chargeId as string);

    if (!charge.balance_transaction) {
        throw new Error("No balance transaction found on the charge");
    }

    const balanceTransactionId = charge.balance_transaction as string;
    const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);

    return {
        balanceTransaction: balanceTransaction
    };
}

export async function stripeCreateRefund(paymentIntentId: string, amount?: number) {
    if (!paymentIntentId) throw new Error("Missing paymentIntentId");

    const refundParams: Stripe.RefundCreateParams = {
        payment_intent: paymentIntentId,
    };
    if (amount) {
        refundParams.amount = amount;
    }

    const refund = await stripe.refunds.create(refundParams);
    return refund;
}

export async function stripeRetrievePaymentIntent(paymentIntentId: string) {
    if (!paymentIntentId) throw new Error("Missing paymentIntentId");

    // Expand latest_charge to get more details if needed, but retrieving PI is usually enough for amount/currency
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method']
    });
    return paymentIntent;
}

// --- Email Notification ---

// Assuming imports need to be added/checked.
// Need: tableGetConfig, getOne, stripeRetrievePaymentIntent
// stripeRetrievePaymentIntent is in this file.
// tableGetConfig, getOne are in other files.

export async function sendRefundEmail(
    pid: string,
    eventCode: string,
    subEvent: string | undefined,
    paymentIntentId: string
) {
    if (!SMTP_USERNAME || !SMTP_PASSWORD || !AUTH_EMAIL_FROM || !AUTH_EMAIL_REPLY_TO) {
        // Log instead of throw to avoid crashing the refund process? 
        // Original code threw error. Better to throw so caller decides (caller logs it currently).
        throw new Error("Email configuration missing");
    }

    // 1. Fetch Participant
    const studentsTableCfg = tableGetConfig('students');
    const participant = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, pid);
    if (!participant || !participant.email) {
        throw new Error("Participant not found or has no email");
    }
    const studentName = `${participant.first || ''} ${participant.last || ''}`.trim();

    // 2. Fetch Event
    const eventsTableCfg = tableGetConfig('events');
    let eventName = eventCode;
    try {
        const event = await getOne(eventsTableCfg.tableName, eventsTableCfg.pk, eventCode);
        if (event && event.name) eventName = event.name;
    } catch (e) { console.error("Failed to resolve event for email", e); }

    // 3. Fetch Stripe Details
    const pi = await stripeRetrievePaymentIntent(paymentIntentId);
    const amount = (pi.amount / 100).toFixed(2);
    const currency = pi.currency.toUpperCase();
    const chargeDate = new Date(pi.created * 1000).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    // Determine card details
    let cardType = 'Card';
    let last4 = '????';

    // Check payment_method object if expanded
    const pm = pi.payment_method as any;
    if (pm && pm.card) {
        cardType = pm.card.brand ? pm.card.brand.toUpperCase() : 'Card';
        last4 = pm.card.last4 || '????';
    }
    // Fallback to charges if payment_method not expanded or null (e.g. older API version default)
    // But we are expanding 'payment_method' in retrieve.
    // Also check charges array just in case
    else if (pi.charges && pi.charges.data && pi.charges.data.length > 0) {
        const charge = pi.charges.data[0];
        if (charge.payment_method_details && charge.payment_method_details.card) {
            cardType = charge.payment_method_details.card.brand ? charge.payment_method_details.card.brand.toUpperCase() : 'Card';
            last4 = charge.payment_method_details.card.last4 || '????';
        }
    }

    const description = pi.description || 'Event Registration';

    // 4. Construct Email Body
    // Template:
    // Subject: Refund of offering for <event>
    // Dear First Last,
    // Your offering for <event> <subevent> for <amount> <currency> charged on <date> on <card type> ... <last 4> <description> has been refunded. It may take a few days for the money to reach your credit card account.
    // With best wishes,
    // The Offerings Support Team

    const subEventText = subEvent && !['event', 'retreat'].includes(subEvent.toLowerCase()) ? `(${subEvent})` : '';

    const subject = `Refund of offering for ${eventName}`;
    const body = `
        <p>Dear ${studentName},</p>
        <p>Your offering for <strong>${eventName}</strong> ${subEventText} for <strong>${amount} ${currency}</strong> charged on ${chargeDate} on <strong>${cardType} ... ${last4}</strong> (${description}) has been refunded. It may take a few days for the money to reach your credit card account.</p>
        <p>With best wishes,<br/>The Offerings Support Team</p>
    `;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD
        },
        encoding: 'utf8'
    });

    const mailOptions = {
        from: AUTH_EMAIL_FROM,
        replyTo: AUTH_EMAIL_REPLY_TO,
        to: participant.email,
        subject: subject,
        html: body
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Refund email sent to ${participant.email}: ${info.messageId}`);
    return true;
}
