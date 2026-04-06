/**
 * @file packages/sharedFrontend/src/eligible.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Utility function to check student eligibility based on pool definitions.
 */

import {
  applyInstallmentsLimitFeeToSelectedRetreats,
  installmentsPaidCentsForCompare,
  subeventHasOfferingActivity,
} from './installmentsHelpers';

// TypeScript interfaces for the data structures
export interface StudentData {
    programs?: Record<string, any>;
    practice?: Record<string, any>;
    [key: string]: any;
}

export interface PoolAttribute {
    type: 'true' | 'pool' | 'pooldiff' | 'pooland' | 'practice' | 'offering' | 'currenteventoffering' | 'currenteventtest' | 'currenteventnotoffering' | 'currenteventminimumdue' | 'currenteventbalancedue' | 'offeringandpools' | 'oath' | 'attended' | 'join' | 'currenteventjoin' | 'currenteventmanualinclude' | 'currenteventaccepted' | 'currenteventnotjoin' | 'joinwhich' | 'offeringwhich' | 'eligible' | 'specifiedAIDBool';
    name?: string;
    inpool?: string;
    outpool?: string;
    pool1?: string;
    pool2?: string;
    field?: string;
    aid?: string;
    subevent?: string;
    pools?: string[];
    retreat?: string;
    boolName?: string;
}

export interface Pool {
    name: string;
    attributes: PoolAttribute[];
    [key: string]: any;
}

function currentEventInstallmentsPaidLtThreshold(
    studentData: StudentData,
    currentAid: string,
    eventContext: Record<string, any> | undefined,
    mode: 'minimum' | 'balance',
): boolean {
    if (!eventContext) return false;
    const program = studentData.programs?.[currentAid];
    if (!program || typeof program !== 'object' || (program as { withdrawn?: boolean }).withdrawn) return false;
    const cfg = (eventContext as { config?: Record<string, unknown> }).config || {};
    if (String(cfg.offeringPresentation || '').toLowerCase() !== 'installments') return false;
    const whichConfig = cfg.whichRetreatsConfig;
    if (!whichConfig || typeof whichConfig !== 'object') return false;
    const wr = (program as { whichRetreats?: Record<string, boolean> }).whichRetreats;
    if (!wr || typeof wr !== 'object') return false;
    const selectedAll = Object.entries(wr)
        .filter(([, v]) => v === true)
        .map(([k]) => k);
    if (!selectedAll.length) return false;
    const selectedRetreats = applyInstallmentsLimitFeeToSelectedRetreats(
        selectedAll,
        program as { limitFee?: boolean },
        cfg.offeringLimitFeeCount,
    );
    let minCents = 0;
    let balCents = 0;
    for (const key of selectedRetreats) {
        const rc = (whichConfig as Record<string, unknown>)[key];
        if (!rc || typeof rc !== 'object') return false;
        const row = rc as { offeringMinimum?: unknown; offeringTotal?: unknown; offeringCashTotal?: unknown };
        const om = Number(row.offeringMinimum ?? 0);
        minCents += Math.max(0, Math.round(om * 100));
        const total = Number(row.offeringTotal ?? 0);
        const cashTotal = Number(row.offeringCashTotal ?? 0);
        balCents += Math.max(0, Math.round((total - cashTotal) * 100));
    }
    const historyUsesCents = !!cfg.reglinkv2;
    const paidCents = installmentsPaidCentsForCompare(
        (program as { offeringHistory?: Record<string, unknown> }).offeringHistory,
        historyUsesCents,
    );
    if (mode === 'minimum') return paidCents < minCents;
    return paidCents < balCents;
}

/**
 * @function checkEligibility
 * @description Checks if a student is eligible for content based on pool definitions.
 * @param {string} poolName - The name of the eligibility pool to check.
 * @param {StudentData} studentData - The student data object containing programs, practice info, etc.
 * @param {string} currentAid - The AID of the current event context, for program-specific checks.
 * @param {Pool[]} allPoolsData - The complete array of pool definition objects.
 * @param eventContext - Optional event record (e.g. { config, aid }) for attributes that read event config.
 * @returns {boolean} True if the student is eligible according to the specified pool, false otherwise.
 */
export function checkEligibility(
    poolName: string,
    studentData: StudentData,
    currentAid: string,
    allPoolsData: Pool[],
    eventContext?: Record<string, any> | null,
): boolean {
    if (!Array.isArray(allPoolsData)) {
        console.error("Eligibility check error: Expected allPoolsData to be an array, but received:", typeof allPoolsData, allPoolsData);
        return false;
    }

    const pool = allPoolsData.find(o => o.name === poolName);
    if (!pool) {
        console.warn("Eligibility check failed: Pool definition not found for name:", poolName, "in context AID:", currentAid);
        return false;
    }

    if (!pool.attributes || pool.attributes.length === 0) {
        console.warn("Eligibility check warning: Pool has no attributes defined:", poolName);
        return false;
    }

    // Check each attribute rule within the pool
    for (let i = 0; i < pool.attributes.length; i++) {
        const attr = pool.attributes[i];
        let isEligible = false;

        switch (attr.type) {
            case 'true':
                isEligible = true;
                break;
            case 'pool':
                if (attr.name) {
                    isEligible = checkEligibility(attr.name, studentData, currentAid, allPoolsData, eventContext);
                }
                break;
            case 'pooldiff':
                if (attr.inpool && attr.outpool) {
                    isEligible = checkEligibility(attr.inpool, studentData, currentAid, allPoolsData, eventContext) &&
                        !checkEligibility(attr.outpool, studentData, currentAid, allPoolsData, eventContext);
                }
                break;
            case 'pooland':
                if (attr.pool1 && attr.pool2) {
                    isEligible = checkEligibility(attr.pool1, studentData, currentAid, allPoolsData, eventContext) &&
                        checkEligibility(attr.pool2, studentData, currentAid, allPoolsData, eventContext);
                }
                break;
            case 'practice':
                if (attr.field) {
                    isEligible = !!(studentData.practice?.[attr.field]);
                }
                break;
            case 'offering':
                if (attr.aid && attr.subevent) {
                    if (attr.subevent === 'any') {
                        // Check if student has any offering in any subevent for this program
                        const offeringHistory = studentData.programs?.[attr.aid]?.offeringHistory;
                        if (offeringHistory) {
                            isEligible = Object.keys(offeringHistory).some(subeventKey =>
                                subeventHasOfferingActivity(offeringHistory[subeventKey]),
                            );
                        }
                    } else {
                        // Check specific subevent (classic offeringSKU or installments payments)
                        isEligible = subeventHasOfferingActivity(
                            studentData.programs?.[attr.aid]?.offeringHistory?.[attr.subevent],
                        );
                    }
                }
                break;
            case 'currenteventoffering':
                if (attr.subevent && studentData.programs?.[currentAid]?.offeringHistory?.[attr.subevent]) {
                    isEligible =
                        subeventHasOfferingActivity(studentData.programs[currentAid].offeringHistory[attr.subevent]) &&
                        !studentData.programs[currentAid]?.withdrawn;
                }
                break;
            case 'currenteventtest':
                isEligible = !!(studentData.programs?.[currentAid]?.test);
                break;
            case 'currenteventnotoffering':
                if (attr.subevent && studentData.programs?.[currentAid]?.offeringHistory?.[attr.subevent]) {
                    isEligible = !subeventHasOfferingActivity(
                        studentData.programs[currentAid].offeringHistory[attr.subevent],
                    );
                }
                break;
            case 'currenteventminimumdue':
                isEligible = currentEventInstallmentsPaidLtThreshold(studentData, currentAid, eventContext ?? undefined, 'minimum');
                break;
            case 'currenteventbalancedue':
                isEligible = currentEventInstallmentsPaidLtThreshold(studentData, currentAid, eventContext ?? undefined, 'balance');
                break;
            case 'offeringandpools':
                if (
                    attr.aid &&
                    attr.subevent &&
                    attr.pools &&
                    subeventHasOfferingActivity(studentData.programs?.[attr.aid]?.offeringHistory?.[attr.subevent])
                ) {
                    isEligible = !!(attr.pools.some((p) => checkEligibility(p, studentData, currentAid, allPoolsData, eventContext)));
                }
                break;
            case 'oath':
                if (attr.aid) {
                    isEligible = !!(studentData.programs?.[attr.aid]?.oath);
                }
                break;
            case 'attended':
                if (attr.aid) {
                    isEligible = !!(studentData.programs?.[attr.aid]?.attended);
                }
                break;
            case 'join':
                if (attr.aid) {
                    isEligible = !!(studentData.programs?.[attr.aid]?.join);
                }
                break;
            case 'currenteventjoin':
                isEligible = !!(studentData.programs?.[currentAid]?.join);
                break;
            case 'currenteventmanualinclude':
                isEligible = !!(studentData.programs?.[currentAid]?.manualInclude);
                break;
            case 'currenteventaccepted':
                isEligible = !!(studentData.programs?.[currentAid]?.accepted) && 
                            !studentData.programs?.[currentAid]?.withdrawn;
                break;
            case 'currenteventnotjoin':
                isEligible = !(!!(studentData.programs?.[currentAid]?.join));
                break;
            case 'joinwhich':
                if (attr.aid && attr.retreat &&
                    studentData.programs?.[attr.aid]?.join &&
                    !studentData.programs?.[attr.aid]?.withdrawn &&
                    studentData.programs?.[attr.aid]?.whichRetreats) {
                    const whichRetreats = studentData.programs[attr.aid].whichRetreats;
                    const keys = Object.keys(whichRetreats);
                    isEligible = keys.some((key) => key.startsWith(attr.retreat!) && whichRetreats[key]);
                }
                break;
            case 'offeringwhich':
                if (attr.aid && attr.retreat && attr.subevent &&
                    studentData.programs?.[attr.aid]?.join &&
                    !studentData.programs?.[attr.aid]?.withdrawn &&
                    studentData.programs?.[attr.aid]?.whichRetreats) {
                    // First check: verify the retreat is in whichRetreats and is truthy
                    const whichRetreats = studentData.programs[attr.aid].whichRetreats;
                    const retreatKeys = Object.keys(whichRetreats);
                    const hasRetreat = retreatKeys.some((key) => key.startsWith(attr.retreat!) && whichRetreats[key]);
                    
                    // Second check: verify offering exists for the subevent (independent of whichRetreats)
                    if (hasRetreat && studentData.programs[attr.aid].offeringHistory) {
                        const offeringHistory = studentData.programs[attr.aid].offeringHistory;
                        const offeringKeys = Object.keys(offeringHistory);
                        isEligible = offeringKeys.some(
                            (key) =>
                                key.startsWith(attr.subevent!) && subeventHasOfferingActivity(offeringHistory[key]),
                        );
                    }
                }
                break;
            case 'eligible':
                isEligible = !!(studentData.programs?.[currentAid]?.eligible);
                break;
            case 'specifiedAIDBool':
                if (attr.aid && attr.boolName) {
                    isEligible = !!(studentData.programs?.[attr.aid]?.[attr.boolName]);
                }
                break;
            default:
                console.warn("UNKNOWN POOL ATTRIBUTE TYPE encountered:", poolName, attr.type);
                isEligible = false;
        }

        if (isEligible) {
            return true;
        }
    }
    return false;
}

// Export the function with the original name for backward compatibility
export { checkEligibility as eligible }; 