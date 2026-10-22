/**
 * @file packages/api/lib/unsubscribe.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Email unsubscribe / re-subscribe for the participant named by the request's own pid.
 * The unsubscribe app links carry only a pid, so these handlers expose nothing beyond the
 * participant's first name and subscription state, and never create a participant record.
 */

// Subpath import: the package root re-exports React components, which must not be pulled
// into the API bundle.
import { checkEligibility } from 'sharedFrontend/eligible';
import { tableGetConfig } from './tableConfig';
import { getOne, listAll, updateItemWithCondition, putOneWithCondition } from './dynamoClient';
import { activityRecord } from './activity';

/** Pools reported with every (un)subscribe, matching the Student History modal. */
export const UNSUBSCRIBE_REPORT_POOLS = ['refuge', 'oath', 'psb', 'amitayus-lung'] as const;

export interface UnsubscribeStatus {
  found: boolean;
  first?: string;
  unsubscribed?: boolean;
  unsubscribeTS?: string;
  resubscribeTS?: string;
}

export interface SetUnsubscribeResult extends UnsubscribeStatus {
  changed: boolean;
}

function statusOf(student: any): UnsubscribeStatus {
  if (!student) return { found: false };
  return {
    found: true,
    first: typeof student.first === 'string' ? student.first : undefined,
    unsubscribed: student.unsubscribe === true,
    unsubscribeTS: typeof student.unsubscribeTS === 'string' ? student.unsubscribeTS : undefined,
    resubscribeTS: typeof student.resubscribeTS === 'string' ? student.resubscribeTS : undefined,
  };
}

/**
 * @function poolEligibility
 * @description Evaluates the reported pools for a participant, with the pool name as the aid,
 * exactly as the Student History modal does.
 */
export function poolEligibility(student: any, pools: any[]): Record<string, boolean> {
  return Object.fromEntries(
    UNSUBSCRIBE_REPORT_POOLS.map((pool) => {
      let eligible = false;
      try {
        eligible = checkEligibility(pool, student, pool, pools);
      } catch (err) {
        console.warn(`poolEligibility: ${pool} check failed:`, err);
      }
      return [pool, eligible];
    })
  );
}

/**
 * @async
 * @function getUnsubscribeStatus
 * @description Returns the participant's first name and subscription state.
 */
export async function getUnsubscribeStatus(pid: string, appRole: string, oidcToken?: string): Promise<UnsubscribeStatus> {
  const students = tableGetConfig('students');
  return statusOf(await getOne(students.tableName, students.pk, pid, appRole, oidcToken));
}

/**
 * @async
 * @function setUnsubscribe
 * @description Sets or clears the participant's unsubscribe flag, stamping unsubscribeTS or
 * resubscribeTS, and logs the change to the activity log (best effort) with the participant's
 * eligibility for the reported pools. A request for the current state changes nothing.
 */
export async function setUnsubscribe(
  pid: string,
  unsubscribe: boolean,
  appRole: string,
  oidcToken?: string
): Promise<SetUnsubscribeResult> {
  const students = tableGetConfig('students');
  const student = await getOne(students.tableName, students.pk, pid, appRole, oidcToken);
  if (!student) return { found: false, changed: false };
  if ((student.unsubscribe === true) === unsubscribe) return { ...statusOf(student), changed: false };

  const now = new Date();
  const ts = now.toISOString();
  const tsField = unsubscribe ? 'unsubscribeTS' : 'resubscribeTS';
  // Conditional on the record existing, so a pid deleted in the meantime is never recreated.
  await updateItemWithCondition(
    students.tableName,
    { [students.pk]: pid },
    'SET #u = :u, #ts = :ts',
    { ':u': unsubscribe, ':ts': ts },
    { '#u': 'unsubscribe', '#ts': tsField },
    appRole,
    oidcToken
  );
  const updated = { ...student, unsubscribe, [tsField]: ts };

  try {
    const pools = await listAll(tableGetConfig('pools').tableName, appRole, oidcToken);
    const studentName = [student.first, student.last].filter(Boolean).join(' ').trim() || undefined;
    const item = activityRecord(
      {
        type: unsubscribe ? 'student.unsubscribed' : 'student.resubscribed',
        source: 'unsubscribe',
        studentId: pid,
        studentName,
        summary: unsubscribe ? 'Unsubscribed from email via unsubscribe link' : 'Re-subscribed to email via unsubscribe link',
        details: {
          email: typeof student.email === 'string' ? student.email : undefined,
          eligibility: poolEligibility(student, pools),
        },
      },
      now,
      `${unsubscribe ? 'unsubscribe' : 'resubscribe'}|${pid}|${ts}`
    );
    const activity = tableGetConfig('activity-log');
    await putOneWithCondition(activity.tableName, item, 'attribute_not_exists(id)', undefined, appRole, oidcToken);
  } catch (err) {
    console.error(`setUnsubscribe: activity log write failed for ${pid}:`, err);
  }

  return { ...statusOf(updated), changed: true };
}
