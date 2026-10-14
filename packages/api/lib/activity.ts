/**
 * @file packages/api/lib/activity.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Writes entries to the shared activity log (see docs/ACTIVITY_LOG.md).
 */

import { createHash } from 'crypto';
import { waitUntil } from '@vercel/functions';
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

/**
 * @function parseSignInApps
 * @description Parses ACTIVITY_LOG_SIGNIN_APPS: comma-separated actions profiles (apps) whose sign-ins
 * are logged. `*` means every app; `-name` excludes an app (e.g. `*,-register`). Blank logs nothing.
 */
export function parseSignInApps(value: string | undefined): (app: string) => boolean {
  const entries = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const excluded = new Set(entries.filter((e) => e.startsWith('-')).map((e) => e.slice(1).trim()));
  const included = new Set(entries.filter((e) => !e.startsWith('-')));
  const all = included.has('*');
  return (app: string) => !excluded.has(app) && (all || included.has(app));
}

const signInLogged = parseSignInApps(process.env.ACTIVITY_LOG_SIGNIN_APPS);
/** Sign-ins by the same participant, device and app within one window are logged once. */
const SIGNIN_WINDOW_MS = 10 * 60 * 1000;
/** Partition holding short-lived dedupe markers; never a real day, so the UI never reads it. */
const DEDUPE_PARTITION = '_dedupe';
const recentSignIns = new Map<string, number>();

export type SignInMethod = 'email-verification' | 'session' | 'silent-session';

/**
 * @function noteSignIn
 * @description Logs an `auth.signIn` activity when a participant gets a fresh access token for an app
 * selected by ACTIVITY_LOG_SIGNIN_APPS. Returns immediately: the write runs after the response is sent
 * (waitUntil) and failures are only logged, so it never delays or breaks the auth check.
 * Entries are written with the API's auth role (AUTH_ROLE_ARN), which needs PutItem on the activity
 * table; the participant's name is looked up best effort with the app's role.
 */
export function noteSignIn(
  pid: string,
  deviceFingerprint: string,
  app: string,
  method: SignInMethod,
  appRole: string,
  oidcToken?: string
): void {
  try {
    if (!signInLogged(app)) return;
    const now = Date.now();
    const windowStart = now - (now % SIGNIN_WINDOW_MS);
    // A page load fires several requests at once; skip repeats seen by this instance.
    const key = `${pid}|${deviceFingerprint}|${app}`;
    if (recentSignIns.get(key) === windowStart) return;
    if (recentSignIns.size > 10_000) recentSignIns.clear();
    recentSignIns.set(key, windowStart);
    waitUntil(
      recordSignIn(pid, deviceFingerprint, app, method, new Date(now), windowStart, appRole, oidcToken).catch((err) =>
        console.warn(`noteSignIn: failed to log sign-in for ${app}:`, err)
      )
    );
  } catch (err) {
    console.warn('noteSignIn: skipped:', err);
  }
}

async function recordSignIn(
  pid: string,
  deviceFingerprint: string,
  app: string,
  method: SignInMethod,
  at: Date,
  windowStart: number,
  appRole: string,
  oidcToken?: string
): Promise<void> {
  const activity = tableGetConfig('activity-log');
  const authRole = process.env.AUTH_ROLE_ARN!;
  // Other instances may be handling the same page load; the first to claim the marker logs it.
  const markerKey = createHash('sha256').update(`${pid}|${deviceFingerprint}|${app}|${windowStart}`).digest('hex');
  try {
    await putOneWithCondition(
      activity.tableName,
      { day: DEDUPE_PARTITION, id: `signin#${markerKey}`, expiresAt: Math.floor(windowStart / 1000) + 2 * 3600 },
      'attribute_not_exists(id)',
      undefined,
      authRole,
      oidcToken
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Condition check failed')) return;
    throw err;
  }

  let studentName: string | undefined;
  try {
    const students = tableGetConfig('students');
    const student = await getOne(students.tableName, students.pk, pid, appRole, oidcToken);
    studentName = [student?.first, student?.last].filter(Boolean).join(' ').trim() || undefined;
  } catch (err) {
    console.warn('recordSignIn: participant lookup failed:', err);
  }

  const item = activityRecord(
    {
      type: 'auth.signIn',
      source: 'api',
      studentId: pid,
      studentName,
      summary: `Signed in to ${app}${method === 'email-verification' ? ' after email verification' : ''}`,
      details: { app, method },
    },
    at,
    `signin|${markerKey}`
  );
  await putOneWithCondition(activity.tableName, item, 'attribute_not_exists(id)', undefined, authRole, oidcToken);
}
