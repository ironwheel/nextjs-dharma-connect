/**
 * @file packages/sharedFrontend/src/eligible.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Utility function to check student eligibility based on pool definitions.
 */

// TypeScript interfaces for the data structures
export interface StudentData {
    programs?: Record<string, any>;
    practice?: Record<string, any>;
    [key: string]: any;
}

export interface PoolAttribute {
    type: 'true' | 'pool' | 'pooldiff' | 'pooland' | 'practice' | 'offering' | 'currenteventoffering' | 'currenteventtest' | 'currenteventnotoffering' | 'offeringandpools' | 'oath' | 'attended' | 'join' | 'currenteventjoin' | 'currenteventaccepted' | 'currenteventnotjoin' | 'joinwhich' | 'eligible';
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
}

export interface Pool {
    name: string;
    attributes: PoolAttribute[];
    [key: string]: any;
}

/**
 * @function checkEligibility
 * @description Checks if a student is eligible for content based on pool definitions.
 * @param {string} poolName - The name of the eligibility pool to check.
 * @param {StudentData} studentData - The student data object containing programs, practice info, etc.
 * @param {string} currentAid - The AID of the current event context, for program-specific checks.
 * @param {Pool[]} allPoolsData - The complete array of pool definition objects.
 * @returns {boolean} True if the student is eligible according to the specified pool, false otherwise.
 */
export function checkEligibility(
    poolName: string,
    studentData: StudentData,
    currentAid: string,
    allPoolsData: Pool[]
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
                    isEligible = checkEligibility(attr.name, studentData, currentAid, allPoolsData);
                }
                break;
            case 'pooldiff':
                if (attr.inpool && attr.outpool) {
                    isEligible = checkEligibility(attr.inpool, studentData, currentAid, allPoolsData) &&
                        !checkEligibility(attr.outpool, studentData, currentAid, allPoolsData);
                }
                break;
            case 'pooland':
                if (attr.pool1 && attr.pool2) {
                    isEligible = checkEligibility(attr.pool1, studentData, currentAid, allPoolsData) &&
                        checkEligibility(attr.pool2, studentData, currentAid, allPoolsData);
                }
                break;
            case 'practice':
                if (attr.field) {
                    isEligible = !!(studentData.practice?.[attr.field]);
                }
                break;
            case 'offering':
                if (attr.aid && attr.subevent) {
                    isEligible = !!(studentData.programs?.[attr.aid]?.offeringHistory?.[attr.subevent]?.offeringSKU);
                }
                break;
            case 'currenteventoffering':
                if (studentData.programs?.[currentAid]?.offeringHistory?.[attr.subevent]) {
                    isEligible = !!(studentData.programs[currentAid].offeringHistory[attr.subevent!]?.offeringSKU) && 
                                !studentData.programs[currentAid]?.withdrawn;
                }
                break;
            case 'currenteventtest':
                isEligible = !!(studentData.programs?.[currentAid]?.test);
                break;
            case 'currenteventnotoffering':
                if (studentData.programs?.[currentAid]?.offeringHistory?.[attr.subevent]) {
                    isEligible = !(!!(studentData.programs[currentAid].offeringHistory[attr.subevent!]?.offeringSKU));
                }
                break;
            case 'offeringandpools':
                if (attr.aid && attr.subevent && attr.pools && studentData.programs?.[attr.aid]?.offeringHistory?.[attr.subevent]) {
                    isEligible = !!(attr.pools.some((p) => checkEligibility(p, studentData, currentAid, allPoolsData)));
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
                    const keys = Object.keys(studentData.programs[attr.aid].whichRetreats);
                    isEligible = keys.some((key) => key.startsWith(attr.retreat!));
                }
                break;
            case 'eligible':
                isEligible = !!(studentData.programs?.[currentAid]?.eligible);
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