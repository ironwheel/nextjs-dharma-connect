/**
 * @file packages/api/lib/refunds.ts
 * @description Logic for handling refund requests.
 */
import nodemailer from 'nodemailer';
import { tableGetConfig } from './tableConfig';
import { putOneWithCondition, batchGetItems, getOne, updateItem } from './dynamoClient';
import { getConfigValue } from './authUtils';
import { stripeCreateRefund, sendRefundEmail } from './stripe';

const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const AUTH_EMAIL_FROM = process.env.AUTH_EMAIL_FROM;
const AUTH_EMAIL_REPLY_TO = process.env.AUTH_EMAIL_REPLY_TO;

export interface RefundRequest {
    host: string;
    stripePaymentIntent: string;
    pid: string;
    eventCode: string;
    subEvent?: string;
    reason: string;
    requestPid: string;
}

/**
 * @function createRefundRequest
 * @description Creates a new refund request if one does not already exist.
 */
export async function createRefundRequest(request: RefundRequest) {
    // 1. Validate Approvers Configuration (Fail fast)
    const approverPids = await getConfigValue(request.requestPid, request.host, 'refundApprovalList');
    if (!Array.isArray(approverPids) || approverPids.length === 0) {
        throw new Error('No refund approvers configured. Please contact support.');
    }

    // 2. Resolve Emails (Fail fast if no valid emails found)
    const studentsTableCfg = tableGetConfig('students');
    const emails: string[] = [];

    // Using simple loop for serial execution, parallel Promise.all map could be faster if list is long
    for (const pid of approverPids) {
        const student = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, pid);
        if (student && student.email) {
            emails.push(student.email);
        }
    }

    if (emails.length === 0) {
        console.warn(`Refund approvers configured but no valid emails found. PIDs: ${approverPids.join(', ')}`);
        throw new Error('No valid emails found for refund approvers. Please check configuration.');
    }

    const tableCfg = tableGetConfig('refunds');
    const timestamp = new Date().toISOString();
    const item = {
        ...request,
        createdAt: timestamp,
        approvalState: 'PENDING',
        approvalStateLastUpdated: timestamp
    };

    // 3. Create the record, ensuring uniqueness
    await putOneWithCondition(
        tableCfg.tableName,
        item,
        'attribute_not_exists(stripePaymentIntent)'
    );

    // 4. Send Notifications
    await sendRefundRequestNotifications(request, emails);
}

/**
 * @function checkRefundRequests
 * @description Checks a list of payment intent IDs to see which ones already have refund requests.
 * @returns List of payment intent IDs that exist in the refunds table.
 */
export async function checkRefundRequests(paymentIntentIds: string[]): Promise<string[]> {
    if (paymentIntentIds.length === 0) return [];

    const tableCfg = tableGetConfig('refunds');
    // Batch get only supports up to 100 items, handled by batchGetItems wrapper
    // We only need the keys back to know they exist
    const items = await batchGetItems(tableCfg.tableName, tableCfg.pk, paymentIntentIds);

    return items.map(item => item[tableCfg.pk]);
}

/**
 * @function sendRefundRequestNotifications
 * @description Sends email notifications to approvers.
 */
async function sendRefundRequestNotifications(request: RefundRequest, emails: string[]) {
    // 1. Emails already resolved and validated in createRefundRequest
    // 2. Emails passed directly
    if (emails.length === 0) {
        console.warn('No valid emails found for refund approvers.');
        return;
    }

    // 3. Send Email
    // 3. Send Email
    if (!SMTP_USERNAME || !SMTP_PASSWORD || !AUTH_EMAIL_FROM || !AUTH_EMAIL_REPLY_TO) {
        console.error('SMTP configuration missing, cannot send refund notification.');
        throw new Error('SMTP configuration missing, cannot send refund notification.');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: SMTP_USERNAME,
            pass: SMTP_PASSWORD,
        },
        // Ensure proper encoding to avoid quoted-printable encoding issues
        encoding: 'utf8'
    });

    // Fetch Student Name
    const studentsTableCfg = tableGetConfig('students');
    let studentName = request.pid;
    try {
        const student = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, request.pid);
        if (student && student.first && student.last) {
            studentName = `${student.first} ${student.last}`;
        }
    } catch (e) {
        console.error('Failed to resolve student name for email:', e);
    }

    // Fetch Requester Name
    let requesterName = request.requestPid;
    try {
        const requester = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, request.requestPid);
        if (requester && requester.first && requester.last) {
            requesterName = `${requester.first} ${requester.last}`;
        }
    } catch (e) {
        console.error('Failed to resolve requester name for email:', e);
    }

    // Fetch Event Name
    const eventsTableCfg = tableGetConfig('events');
    let eventName = request.eventCode;
    try {
        const event = await getOne(eventsTableCfg.tableName, eventsTableCfg.pk, request.eventCode);
        if (event && event.name) {
            eventName = event.name;
        }
    } catch (e) {
        console.error('Failed to resolve event name for email:', e);
    }

    const subEventDisplay = ['event', 'retreat'].includes(request.subEvent.toLowerCase())
        ? ''
        : `SubEvent: ${request.subEvent}\n        `;

    const mailOptions = {
        from: AUTH_EMAIL_FROM,
        to: emails.join(', '), // Send to all approvers
        replyTo: AUTH_EMAIL_REPLY_TO,
        subject: `New Refund Request: ${eventName}`,
        text: `A new refund request has been submitted.
        
        Event: ${eventName}
        ${subEventDisplay}Student: ${studentName}
        Reason: ${request.reason}
        Requested By: ${requesterName}
        
        Please review and action. THANK YOU!`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Refund notification sent to ${emails.join(', ')}`);
    } catch (error) {
        console.error('Failed to send refund notification email:', error);
        // Don't fail the request if email fails, just log it
    }
}

/**
 * @function listRefunds
 * @description lists the top 10 most recent refund requests.
 * @returns {Promise<{ items: any[], total: number }>} List of refund requests.
 */
export async function listRefunds(limit: number = 20, offset: number = 0): Promise<{ items: any[], total: number }> {
    const tableCfg = tableGetConfig('refunds');
    // Since we don't have a GSI on createdAt, we'll scan and sort. 
    // Ideally, for scale, we should have a GSI or index.
    // For now, assuming relatively low volume, scan is acceptable but we should limit.
    // However, DynamoDB Scan doesn't support "Top 10" efficiently without reading everything.
    // Given the request "top 10 decending order records sorted by createdAt", we scan all.

    // Using listAll from dynamoClient (which is a scan)
    const allRefunds = await import('./dynamoClient').then(mod => mod.listAll(tableCfg.tableName));

    // Sort by createdAt descending
    allRefunds.sort((a: any, b: any) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = allRefunds.length;
    const sliced = allRefunds.slice(offset, offset + limit);

    const enriched = await Promise.all(sliced.map(async (r: any) => {
        const studentsTableCfg = tableGetConfig('students');
        const eventsTableCfg = tableGetConfig('events');

        let studentName = r.pid;
        let requesterName = r.requestPid;
        let approverName = r.approverPid;
        let eventName = r.eventCode;

        // Resolve Student
        if (r.pid) {
            try {
                const s = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.pid);
                if (s && s.first && s.last) studentName = `${s.first} ${s.last}`;
            } catch (e) { console.error('Failed to resolve student', e); }
        }

        // Resolve Requester
        if (r.requestPid) {
            try {
                const req = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.requestPid);
                if (req && req.first && req.last) requesterName = `${req.first} ${req.last}`;
            } catch (e) { console.error('Failed to resolve requester', e); }
        }

        // Resolve Approver
        if (r.approverPid) {
            try {
                const app = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.approverPid);
                if (app && app.first && app.last) approverName = `${app.first} ${app.last}`;
            } catch (e) { console.error('Failed to resolve approver', e); }
        }

        // Resolve Event
        if (r.eventCode) {
            try {
                const ev = await getOne(eventsTableCfg.tableName, eventsTableCfg.pk, r.eventCode);
                if (ev && ev.name) eventName = ev.name;
            } catch (e) { console.error('Failed to resolve event', e); }
        }

        return {
            ...r,
            studentName,
            requesterName,
            approverName,
            eventName
        };
    }));

    return { items: enriched, total };
}

/**
 * @function processRefund
 * @description Processes a refund request (Approve or Deny).
 */
export async function processRefund(
    stripePaymentIntent: string,
    action: 'APPROVE' | 'DENY',
    approverPid: string,
    host: string
) {
    const refundsTableCfg = tableGetConfig('refunds');
    const studentsTableCfg = tableGetConfig('students');

    // 1. Fetch Refund Request
    const refundRequest = await getOne(refundsTableCfg.tableName, refundsTableCfg.pk, stripePaymentIntent);
    if (!refundRequest) {
        throw new Error('Refund request not found');
    }

    const timestamp = new Date().toISOString();

    // 2. Handle DENY
    if (action === 'DENY') {
        await updateItem(
            refundsTableCfg.tableName,
            { [refundsTableCfg.pk]: stripePaymentIntent },
            'SET #status = :status, #updated = :updated, #approver = :approver',
            {
                ':status': 'DENIED',
                ':updated': timestamp,
                ':approver': approverPid
            },
            {
                '#status': 'approvalState',
                '#updated': 'approvalStateLastUpdated',
                '#approver': 'approverPid'
            }
        );
        return { success: true, status: 'DENIED' };
    }

    // 3. Handle APPROVE
    if (action === 'APPROVE') {
        let refundResult;
        try {
            // A. Stripe Refund
            refundResult = await stripeCreateRefund(stripePaymentIntent);
        } catch (stripeErr: any) {
            console.error('Stripe refund failed:', stripeErr);
            // Update status to ERROR
            await updateItem(
                refundsTableCfg.tableName,
                { [refundsTableCfg.pk]: stripePaymentIntent },
                'SET #status = :status, #updated = :updated, #approver = :approver, #err = :err',
                {
                    ':status': 'ERROR',
                    ':updated': timestamp,
                    ':approver': approverPid,
                    ':err': stripeErr.message || 'Stripe Refund Failed'
                },
                {
                    '#status': 'approvalState',
                    '#updated': 'approvalStateLastUpdated',
                    '#approver': 'approverPid',
                    '#err': 'errMsg'
                }
            );
            throw new Error(`Stripe refund failed: ${stripeErr.message}`);
        }

        // B. Update Student Record (offeringRefund = true)
        const eventCode = refundRequest.eventCode;
        const subEvent = refundRequest.subEvent;
        const studentPid = refundRequest.pid;

        try {
            // Construct path: programs.<eventCode>.offeringHistory.<subEvent>.offeringRefund
            // Need expression names for path parts to avoid reserved words bugs
            const updateExpr = 'SET programs.#eventCode.offeringHistory.#subEvent.offeringRefund = :trueVal';
            await updateItem(
                studentsTableCfg.tableName,
                { [studentsTableCfg.pk]: studentPid },
                updateExpr,
                { ':trueVal': true },
                {
                    '#eventCode': eventCode,
                    '#subEvent': subEvent
                }
            );
        } catch (dbErr) {
            console.error('Failed to update student record offeringRefund:', dbErr);
            // Non-fatal, but logged. 
        }

        // C. Send Email to Student
        try {
            await sendRefundEmail(studentPid, eventCode, subEvent, stripePaymentIntent);
        } catch (emailErr) {
            console.error('Failed to send student refund email:', emailErr);
            // Non-fatal
        }

        // D. Update Refund Status to COMPLETE
        await updateItem(
            refundsTableCfg.tableName,
            { [refundsTableCfg.pk]: stripePaymentIntent },
            'SET #status = :status, #updated = :updated, #approver = :approver',
            {
                ':status': 'COMPLETE',
                ':updated': timestamp,
                ':approver': approverPid
            },
            {
                '#status': 'approvalState',
                '#updated': 'approvalStateLastUpdated',
                '#approver': 'approverPid'
            }
        );

        return { success: true, status: 'COMPLETE' };
    }

    throw new Error('Invalid action');
}
