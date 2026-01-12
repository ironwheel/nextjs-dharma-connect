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
    refundAmount?: number; // Amount in cents
    oidcToken?: string;
}

/**
 * @function createRefundRequest
 * @description Creates a new refund request if one does not already exist.
 */
export async function createRefundRequest(request: RefundRequest) {
    // 1. Validate Approvers Configuration (Fail fast)
    const approverPids = await getConfigValue(request.requestPid, request.host, 'refundApprovalList', request.oidcToken);
    if (!Array.isArray(approverPids) || approverPids.length === 0) {
        throw new Error('No refund approvers configured. Please contact support.');
    }

    // 2. Resolve Emails (Fail fast if no valid emails found)
    const studentsTableCfg = tableGetConfig('students');
    const emails: string[] = [];

    // Using simple loop for serial execution, parallel Promise.all map could be faster if list is long
    for (const pid of approverPids) {
        const student = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, pid, undefined, request.oidcToken);
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

    // --- GUARD RAILS ---
    // 1. Velocity Check: Max 4 requests in last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Using listAll (Scan) for now as we transition to GSI. 
    // This is acceptable for checking the guard rail on a per-tenant table.
    const allRefunds = await import('./dynamoClient').then(mod => mod.listAll(tableCfg.tableName, undefined, request.oidcToken));
    const recentRefunds = allRefunds.filter((r: any) => r.createdAt > oneDayAgo);

    if (recentRefunds.length >= 4) {
        throw new Error('Daily refund limit reached (max 4 per 24h).');
    }

    // 2. Value Check: Max $1000 in last 24h
    // Fetch current request amount
    const importStripe = await import('./stripe');
    let currentAmount = 0;

    if (request.refundAmount) {
        currentAmount = request.refundAmount;
    } else {
        const currentPi = await importStripe.stripeRetrievePaymentIntent(request.stripePaymentIntent);
        currentAmount = currentPi.amount; // in cents
    }

    // Fetch amounts for recent requests
    let totalRecentAmount = 0;
    try {
        const amountPromises = recentRefunds.map(async (r: any) => {
            // Use stored refundAmount if available (new records), else fetch PI (legacy)
            if (r.refundAmount) {
                return r.refundAmount;
            }
            try {
                const pi = await importStripe.stripeRetrievePaymentIntent(r.stripePaymentIntent);
                return pi.amount;
            } catch (err) {
                console.error(`Failed to fetch PI ${r.stripePaymentIntent} for guard rail check`, err);
                return 0; // Ignore if failed? Or conservative approach?
            }
        });
        const amounts = await Promise.all(amountPromises);
        totalRecentAmount = amounts.reduce((sum, a) => sum + a, 0);
    } catch (err) {
        console.error("Error calculating recent refund totals", err);
        // If we can't verify, do we block? 
        // Failing safe -> Block or alert? User said "display an explanation". 
        // We'll proceed with the check using what we have, but ideally this shouldn't fail.
    }

    const totalAmount = currentAmount + totalRecentAmount;
    if (totalAmount > 100000) { // $1000.00 * 100 cents
        throw new Error(`Daily refund value limit reached (max $1000 per 24h). Current total: $${(totalAmount / 100).toFixed(2)}`);
    }
    // -------------------

    // 3. Create Refund Request Record
    // Use putOneWithCondition to ensure we don't overwrite an existing request
    // Condition: attribute_not_exists(stripePaymentIntent)
    const refundRecord = {
        stripePaymentIntent: request.stripePaymentIntent,
        pid: request.pid,
        eventCode: request.eventCode,
        subEvent: request.subEvent,
        reason: request.reason,
        requesterPid: request.requestPid,
        createdAt: timestamp,
        approvalState: 'PENDING',
        approvalStateLastUpdated: timestamp,
        host: request.host,
        itemType: 'REFUND', // For GSI
        refundAmount: request.refundAmount // Store requested amount
    };
    await putOneWithCondition(
        tableCfg.tableName,
        refundRecord,
        'attribute_not_exists(stripePaymentIntent)',
        undefined,
        undefined,
        request.oidcToken
    );

    // 4. Send Notifications
    await sendRefundRequestNotifications(request, emails);
}

/**
 * @function checkRefundRequests
 * @description Checks a list of payment intent IDs to see which ones already have refund requests.
 * @returns List of payment intent IDs that exist in the refunds table.
 */
export async function checkRefundRequests(paymentIntentIds: string[], oidcToken?: string): Promise<Record<string, { approvalState: string, approverName?: string }>> {
    const tableCfg = tableGetConfig('refunds');
    const studentTableCfg = tableGetConfig('students');

    // Deduplicate IDs to prevent DynamoDB BatchGetItem error
    const uniqueIds = Array.from(new Set(paymentIntentIds));

    // Batch get supports up to 100 items
    const items = await batchGetItems(tableCfg.tableName, tableCfg.pk, uniqueIds, undefined, oidcToken);

    const resultMap: Record<string, { approvalState: string, approverName?: string }> = {};

    // Collect approver PIDs to resolve names
    const approverPids = new Set<string>();
    items.forEach(item => {
        if (item.approverPid) approverPids.add(item.approverPid);
    });

    // Resolve approver names
    const approverNames: Record<string, string> = {};
    if (approverPids.size > 0) {
        const approvers = await batchGetItems(studentTableCfg.tableName, studentTableCfg.pk, Array.from(approverPids), undefined, oidcToken);
        approvers.forEach(a => {
            approverNames[a.id] = `${a.first} ${a.last}`;
        });
    }

    items.forEach(item => {
        resultMap[item[tableCfg.pk]] = {
            approvalState: item.approvalState,
            approverName: item.approverPid ? approverNames[item.approverPid] : undefined
        };
    });

    return resultMap;
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
        const student = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, request.pid, undefined, request.oidcToken);
        if (student && student.first && student.last) {
            studentName = `${student.first} ${student.last}`;
        }
    } catch (e) {
        console.error('Failed to resolve student name for email:', e);
    }

    // Fetch Requester Name
    let requesterName = request.requestPid;
    try {
        const requester = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, request.requestPid, undefined, request.oidcToken);
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
        const event = await getOne(eventsTableCfg.tableName, eventsTableCfg.pk, request.eventCode, undefined, request.oidcToken);
        if (event && event.name) {
            eventName = event.name;
        }
    } catch (e) {
        console.error('Failed to resolve event name for email:', e);
    }

    const subEventDisplay = (request.subEvent && !['event', 'retreat'].includes(request.subEvent.toLowerCase()))
        ? `SubEvent: ${request.subEvent}\n        `
        : '';

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
export async function listRefunds(limit: number = 20, offset: number = 0, oidcToken?: string): Promise<{ items: any[], total: number }> {
    const tableCfg = tableGetConfig('refunds');
    // Since we don't have a GSI on createdAt, we'll scan and sort. 
    // Ideally, for scale, we should have a GSI or index.
    // For now, assuming relatively low volume, scan is acceptable but we should limit.
    // However, DynamoDB Scan doesn't support "Top 10" efficiently without reading everything.
    // Given the request "top 10 decending order records sorted by createdAt", we scan all.

    // Using listAll from dynamoClient (which is a scan)
    const allRefunds = await import('./dynamoClient').then(mod => mod.listAll(tableCfg.tableName, undefined, oidcToken));

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
        let requesterName = r.requesterPid || r.requestPid;
        let approverName = r.approverPid;
        let eventName = r.eventCode;
        let isInstallment = false;
        let isSeries = false;

        // Resolve Student
        if (r.pid) {
            try {
                const s = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.pid, undefined, oidcToken);
                if (s) {
                    if (s.first && s.last) {
                        studentName = `${s.first} ${s.last}`;
                    } else if (s.name) {
                        studentName = s.name;
                    } else if (s.email) {
                        studentName = s.email;
                    }

                    // Check for Installment
                    if (r.eventCode && r.subEvent &&
                        s.programs && s.programs[r.eventCode] &&
                        s.programs[r.eventCode].offeringHistory &&
                        s.programs[r.eventCode].offeringHistory[r.subEvent] &&
                        s.programs[r.eventCode].offeringHistory[r.subEvent].installments) {

                        const installments = s.programs[r.eventCode].offeringHistory[r.subEvent].installments;
                        // Iterate values to find matching intent
                        for (const inst of Object.values(installments)) {
                            if ((inst as any).offeringIntent === r.stripePaymentIntent) {
                                isInstallment = true;
                                break;
                            }
                        }
                    }

                    // Check for Series (Multiple occurrences of same stripePaymentIntent)
                    let intentCount = 0;
                    if (s.programs && r.eventCode && s.programs[r.eventCode]) {
                        const pData = s.programs[r.eventCode];
                        if (pData.offeringHistory) {
                            for (const subData of Object.values(pData.offeringHistory) as any[]) {
                                if (subData.offeringIntent === r.stripePaymentIntent && r.stripePaymentIntent !== 'installments') {
                                    intentCount++;
                                }
                                if (subData.installments) {
                                    for (const inst of Object.values(subData.installments) as any[]) {
                                        if (inst.offeringIntent === r.stripePaymentIntent && r.stripePaymentIntent !== 'installments') {
                                            intentCount++;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (intentCount > 1) {
                        isSeries = true;
                    }
                }
            } catch (e) { console.error(`Failed to resolve student ${r.pid}`, e); }
        }

        // Resolve Requester
        if (r.requesterPid) { // Changed from r.requestPid to match what might be in DB or fallback
            // The createRefundRequest uses request.requestPid mapping to requesterPid in DB record?
            // Let's check createRefundRequest: 
            // 124:         requesterPid: request.requestPid,
            // So in DB it is requesterPid.
            // But in listRefunds (line 308) it was pulling r.requestPid which might be undefined if the DB field is requesterPid.
            // Line 308: let requesterName = r.requestPid; -> This was likely the bug for empty requester name/ID.

            // Update variable init too? No, I'll fix the property access here.

            try {
                const req = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.requesterPid, undefined, oidcToken);
                if (req) {
                    if (req.first && req.last) {
                        requesterName = `${req.first} ${req.last}`;
                    } else if (req.name) {
                        requesterName = req.name;
                    }
                } else {
                    requesterName = r.requesterPid;
                }
            } catch (e) {
                console.error(`Failed to resolve requester ${r.requesterPid}`, e);
                requesterName = r.requesterPid;
            }
        } else if (r.requestPid) {
            // Fallback if field name was inconsistent in old records
            try {
                const req = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.requestPid, undefined, oidcToken);
                if (req && req.first && req.last) requesterName = `${req.first} ${req.last}`;
                else requesterName = r.requestPid;
            } catch (e) { console.error('Failed to resolve requester (legacy)', e); }
        }

        // Resolve Approver
        if (r.approverPid) {
            try {
                const app = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, r.approverPid, undefined, oidcToken);
                if (app) {
                    if (app.first && app.last) {
                        approverName = `${app.first} ${app.last}`;
                    } else if (app.name) {
                        approverName = app.name;
                    }
                }
            } catch (e) { console.error(`Failed to resolve approver ${r.approverPid}`, e); }
        }

        // Resolve Event
        if (r.eventCode) {
            try {
                const ev = await getOne(eventsTableCfg.tableName, eventsTableCfg.pk, r.eventCode, undefined, oidcToken);
                if (ev && ev.name) eventName = ev.name;
            } catch (e) { console.error('Failed to resolve event', e); }
        }

        return {
            ...r,
            studentName,
            requesterName,
            approverName,
            eventName,
            isInstallment,
            isSeries
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
    host: string,
    oidcToken?: string
) {
    const refundsTableCfg = tableGetConfig('refunds');
    const studentsTableCfg = tableGetConfig('students');

    // 1. Fetch Refund Request
    const refundRequest = await getOne(refundsTableCfg.tableName, refundsTableCfg.pk, stripePaymentIntent, undefined, oidcToken);
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
            // Pass refundAmount if it exists in the request
            const amountToRefund = refundRequest.refundAmount; // Can be undefined
            refundResult = await stripeCreateRefund(stripePaymentIntent, amountToRefund);
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
                },
                undefined,
                oidcToken
            );
            throw new Error(`Stripe refund failed: ${stripeErr.message}`);
        }

        // B. Update Student Record (offeringRefund = true)
        const eventCode = refundRequest.eventCode;
        const subEvent = refundRequest.subEvent;
        const studentPid = refundRequest.pid;

        try {
            // First, fetch the student record to find ALL occurrences of this payment intent
            const student = await getOne(studentsTableCfg.tableName, studentsTableCfg.pk, studentPid, undefined, oidcToken);

            if (student && student.programs) {
                const updateActions: string[] = [];
                const expressionAttributeNames: Record<string, string> = {};
                let pathCounter = 0;

                // Scoped update logic
                if (student.programs[eventCode] && student.programs[eventCode].offeringHistory) {
                    const pId = eventCode;
                    const pData = student.programs[eventCode];

                    for (const [subId, subData] of Object.entries(pData.offeringHistory) as [string, any][]) {
                        // Check direct offeringIntent
                        if (subData.offeringIntent === stripePaymentIntent && stripePaymentIntent !== 'installments') {
                            const pKey = `#p${pathCounter}`;
                            const subKey = `#s${pathCounter}`;
                            expressionAttributeNames[pKey] = pId;
                            expressionAttributeNames[subKey] = subId;
                            updateActions.push(`programs.${pKey}.offeringHistory.${subKey}.offeringRefund = :trueVal`);
                            pathCounter++;
                        }

                        // Check installments
                        if (subData.installments) {
                            for (const [instId, instData] of Object.entries(subData.installments) as [string, any][]) {
                                if (instData.offeringIntent === stripePaymentIntent && stripePaymentIntent !== 'installments') {
                                    const pKey = `#p${pathCounter}`;
                                    const subKey = `#s${pathCounter}`;
                                    const instKey = `#i${pathCounter}`;
                                    expressionAttributeNames[pKey] = pId;
                                    expressionAttributeNames[subKey] = subId;
                                    expressionAttributeNames[instKey] = instId;
                                    updateActions.push(`programs.${pKey}.offeringHistory.${subKey}.installments.${instKey}.offeringRefund = :trueVal`);
                                    pathCounter++;
                                }
                            }
                        }
                    }
                }

                if (updateActions.length > 0) {
                    const updateExpr = `SET ${updateActions.join(', ')}`;
                    await updateItem(
                        studentsTableCfg.tableName,
                        { [studentsTableCfg.pk]: studentPid },
                        updateExpr,
                        { ':trueVal': true },
                        expressionAttributeNames,
                        undefined,
                        oidcToken
                    );
                } else {
                    console.warn(`Payment intent ${stripePaymentIntent} not found in student record during refund process.`);
                }
            }
        } catch (dbErr) {
            console.error('Failed to update student record offeringRefund:', dbErr);
            // Non-fatal, but logged. 
        }

        // C. Send Email to Student
        try {
            await sendRefundEmail(studentPid, eventCode, subEvent, stripePaymentIntent, refundResult?.amount, oidcToken);
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
