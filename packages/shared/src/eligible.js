/**
 * @file packages/shared/src/eligible.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Utility function to check student eligibility based on pool definitions.
 */

/**
 * Checks if a student is eligible for content based on pool definitions.
 * Recursive function to handle nested pool logic.
 *
 * @function checkEligibility
 * @param {string} poolName - The name of the eligibility pool to check.
 * @param {object} studentData - The student data object containing programs, practice info, etc.
 * @param {string} currentAid - The AID of the current event context, for program-specific checks.
 * @param {Array<object> | any} allPoolsData - The complete array of pool definition objects. Should be an array.
 * @returns {boolean} True if the student is eligible according to the specified pool, false otherwise.
 */
function checkEligibility(poolName, studentData, currentAid, allPoolsData) {
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
        isEligible = checkEligibility(attr.name, studentData, currentAid, allPoolsData);
        break;
      case 'pooldiff':
        isEligible = checkEligibility(attr.inpool, studentData, currentAid, allPoolsData) &&
          !checkEligibility(attr.outpool, studentData, currentAid, allPoolsData);
        break;
      case 'pooland':
        isEligible = checkEligibility(attr.pool1, studentData, currentAid, allPoolsData) &&
          checkEligibility(attr.pool2, studentData, currentAid, allPoolsData);
        break;
      case 'practice':
        isEligible = !!(studentData.practice?.[attr.field]);
        break;
      case 'offering':
        isEligible = !!(studentData.programs?.[attr.aid]?.offeringHistory?.[attr.subevent]?.offeringSKU);
        break;
      case 'offeringandpools':
        if (studentData.programs?.[attr.aid]?.offeringHistory?.[attr.subevent]) {
          isEligible = !!(attr.pools?.some((p) => checkEligibility(p, studentData, currentAid, allPoolsData)));
        }
        break;
      case 'oath':
        isEligible = !!(studentData.programs?.[attr.aid]?.oath);
        break;
      case 'attended':
        isEligible = !!(studentData.programs?.[attr.aid]?.attended);
        break;
      case 'join':
        isEligible = !!(studentData.programs?.[attr.aid]?.join);
        break;
      case 'joinwhich':
        if (studentData.programs?.[attr.aid]?.join &&
          !studentData.programs?.[attr.aid]?.withdrawn &&
          studentData.programs?.[attr.aid]?.whichRetreats) {
          const keys = Object.keys(studentData.programs[attr.aid].whichRetreats);
          isEligible = keys.some((key) => key.startsWith(attr.retreat));
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

// Export the function
export { checkEligibility as eligible };
