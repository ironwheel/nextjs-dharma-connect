/**
 * @file apps/student-dashboard/components/emailConditionals.ts
 * @description Line-based #if / #else / #endif filtering for embedded emails.
 * Mirrors the filtering in apps/email-agent/src/email_sender.py so a template
 * renders the same in the dashboard as it does in the sent email.
 *
 * Supported conditions:
 *   #if oathed
 *   #if offering <subevent>
 *   #if retreats <prefix> [<prefix2>]
 */

import { applyInstallmentsLimitFeeToSelectedRetreats } from 'sharedFrontend';

export interface EmailConditionalContext {
    student: any;
    event: any;
    checkEligibility: (pool: string, student: any, aid: string, pools: any[], event?: any) => boolean;
    pools: any[];
}

const retreatNetOfferingDollars = (row: any): number => {
    if (!row) return 0;
    const total = Number(row.offeringTotal ?? 0);
    const cash = Number(row.offeringCashTotal ?? 0);
    if (Number.isNaN(total) || Number.isNaN(cash)) return 0;
    return Math.max(0, total - cash);
};

const sumInstallmentPaymentsReceived = (installments: Record<string, any>): number => {
    let received = 0;
    for (const [key, row] of Object.entries(installments)) {
        if (key === 'refunded' || !row || typeof row !== 'object') continue;
        const n = Number(row.offeringAmount ?? 0);
        if (!Number.isNaN(n)) received += n;
    }
    return received;
};

const offeringCondition = (subevent: string | undefined, ctx: EmailConditionalContext): boolean => {
    const { student, event } = ctx;
    const aid = event?.aid;
    const program = student?.programs?.[aid];
    const installments = event?.config?.offeringPresentation === 'installments';

    if (!installments) {
        return !!(subevent && program?.offeringHistory?.[subevent]);
    }

    const oh = program?.offeringHistory?.retreat?.installments;
    if (!oh) return false;
    const wr = program?.whichRetreats;
    if (!wr) return false;
    const whichRetreatsConfig = event?.config?.whichRetreatsConfig;
    if (!whichRetreatsConfig) {
        throw new Error("Can't use #if offering with installments in a non-multiple retreats event.");
    }
    const selected = Object.entries(wr).filter(([, v]) => v).map(([k]) => k);
    const limited = applyInstallmentsLimitFeeToSelectedRetreats(selected, program, event.config.offeringLimitFeeCount);
    const required = limited.reduce((sum: number, key: string) => sum + retreatNetOfferingDollars(whichRetreatsConfig[key]), 0);
    return required <= sumInstallmentPaymentsReceived(oh);
};

const retreatsCondition = (args: string[], ctx: EmailConditionalContext): boolean => {
    const wr = ctx.student?.programs?.[ctx.event?.aid]?.whichRetreats;
    if (!wr || typeof wr !== 'object') return false;
    const matches = (prefix: string | undefined) =>
        !!prefix && Object.keys(wr).some(key => key.startsWith(prefix) && wr[key]);
    return matches(args[1]) || matches(args[2]);
};

const evaluateCondition = (line: string, ctx: EmailConditionalContext): boolean => {
    const index = line.indexOf('#if');
    const largs = line.slice(index + 4).split(/[ <]/);
    switch (largs[0]) {
        case 'oathed':
            return ctx.checkEligibility('oath', ctx.student, ctx.event.aid, ctx.pools, ctx.event);
        case 'offering':
            return offeringCondition(largs[1], ctx);
        case 'retreats':
            return retreatsCondition(largs, ctx);
        default:
            throw new Error(`Unknown #if condition: ${largs[0]}`);
    }
};

/**
 * Filters html by #if/#else/#endif directives. Directive lines are discarded;
 * lines in a false branch are dropped. Throws on malformed nesting.
 */
export const applyEmailConditionals = (html: string, ctx: EmailConditionalContext): string => {
    if (!html.includes('#if')) return html;

    const out: string[] = [];
    let inIf = false;
    let condition = false;

    for (const line of html.split(/\r?\n/)) {
        if (!inIf) {
            if (line.includes('#if')) {
                inIf = true;
                condition = evaluateCondition(line, ctx);
            } else if (line.includes('#endif')) {
                throw new Error('Non-prefaced #endif');
            } else if (line.includes('#else')) {
                throw new Error('Non-prefaced #else');
            } else {
                out.push(line);
            }
        } else if (line.includes('#endif')) {
            inIf = false;
        } else if (line.includes('#else')) {
            condition = !condition;
        } else if (condition) {
            out.push(line);
        }
    }

    if (inIf) throw new Error('EOF in #if condition');
    return out.join('\n');
};
