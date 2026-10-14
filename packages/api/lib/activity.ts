/**
 * @file packages/api/lib/activity.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Writes entries to the shared activity log (see docs/ACTIVITY_LOG.md).
 */

import { createHash } from 'crypto';
import { tableGetConfig } from './tableConfig';
import { getOne, putOneWithCondition } from './dynamoClient';

const RETENTION_DAYS = 365;
/** Detail keys holding email addresses: excluded from searchText, masked in the UI. */
const EMAIL_DETAIL_KEYS = new Set(['email', 'previousEmail', 'to', 'recipient']);
/** A registration is only logged if it was submitted this recently (allows for slow clients and clock skew). */
const REGISTRATION_MAX_AGE_MS = 15 * 60 * 1000;
const REGISTRATION_MAX_FUTURE_MS = 5 * 60 * 1000;

export interface ActivityEntry {
  type: string;
  source: string;
  studentId?: string;
  studentName?: string;
  /** Human-readable; must not contain email addresses. */
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * @function activityRecord
 * @description Builds an activity log item. `idSeed` makes the sort key deterministic, so recording
 * the same event twice can be detected with a conditional put.
 */
export function activityRecord(entry: ActivityEntry, at: Date, idSeed: string) {
  const ts = at.toISOString();
  const details = Object.fromEntries(
    Object.entries(entry.details ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const searchable = [entry.type, entry.source, entry.studentName, entry.studentId, entry.summary];
  for (const [key, value] of Object.entries(details)) {
    if (EMAIL_DETAIL_KEYS.has(key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string' || typeof v === 'number') searchable.push(String(v));
    }
  }
  // Omit absent attributes entirely: undefined values can't be marshalled.
  const { details: _details, studentId, studentName, ...rest } = entry;
  return {
    day: ts.slice(0, 10),
    id: `${ts}#${createHash('sha256').update(idSeed).digest('hex').slice(0, 6)}`,
    ts,
    ...rest,
    ...(studentId ? { studentId } : {}),
    ...(studentName ? { studentName } : {}),
    ...(Object.keys(details).length ? { details } : {}),
    searchText: searchable.filter(Boolean).join(' ').toLowerCase(),
    expiresAt: Math.floor(at.getTime() / 1000) + RETENTION_DAYS * 86_400,
  };
}

export type RegistrationActivityResult = 'recorded' | 'duplicate' | 'not-registered';

/**
 * @async
 * @function recordRegistration
 * @description Records a `registration.submitted` activity for the authenticated participant, but
 * only if their own record shows a registration for the event submitted within the last few
 * minutes, so a client cannot log registrations that did not happen. Repeat calls for the same
 * submission are ignored.
 */
export async function recordRegistration(
  pid: string,
  eventCode: string,
  appRole: string,
  oidcToken?: string
): Promise<RegistrationActivityResult> {
  const students = tableGetConfig('students');
  const student = await getOne(students.tableName, students.pk, pid, appRole, oidcToken);
  const program = student?.programs?.[eventCode];
  const submittedAt = typeof program?.submitTime === 'string' ? new Date(program.submitTime) : null;
  const age = submittedAt ? Date.now() - submittedAt.getTime() : NaN;
  if (!student || program?.join !== true || !(age <= REGISTRATION_MAX_AGE_MS && age >= -REGISTRATION_MAX_FUTURE_MS)) {
    return 'not-registered';
  }

  let eventName: string | undefined;
  try {
    const events = tableGetConfig('events');
    eventName = (await getOne(events.tableName, events.pk, eventCode, appRole, oidcToken))?.name;
  } catch (err) {
    console.warn(`recordRegistration: event lookup failed for ${eventCode}:`, err);
  }

  const whichRetreats = program.whichRetreats && typeof program.whichRetreats === 'object' ? program.whichRetreats : {};
  const retreats = Object.keys(whichRetreats).filter((k) => whichRetreats[k] === true).sort();
  const studentName = [student.first, student.last].filter(Boolean).join(' ').trim() || undefined;
  const item = activityRecord(
    {
      type: 'registration.submitted',
      source: 'register',
      studentId: pid,
      studentName,
      summary: `Registered for ${eventName || eventCode}${program.submitCount > 1 ? ` (submission ${program.submitCount})` : ''}`,
      details: {
        eventCode,
        eventName,
        submitCount: typeof program.submitCount === 'number' ? program.submitCount : undefined,
        retreats: retreats.length ? retreats : undefined,
        joinMY: typeof program.joinMY === 'boolean' ? program.joinMY : undefined,
        joinVY: typeof program.joinVY === 'boolean' ? program.joinVY : undefined,
      },
    },
    submittedAt!,
    `registration|${pid}|${eventCode}|${program.submitTime}`
  );

  const activity = tableGetConfig('activity-log');
  try {
    await putOneWithCondition(activity.tableName, item, 'attribute_not_exists(id)', undefined, appRole, oidcToken);
    return 'recorded';
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Condition check failed')) return 'duplicate';
    throw err;
  }
}
