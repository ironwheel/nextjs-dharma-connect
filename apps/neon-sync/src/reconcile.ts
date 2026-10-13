import type { Change, NeonAccount, NewParticipant, Participant } from './types.ts';
import { VAJRAYANA_FIELD_ID, rulesFor } from './programs.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanOptions {
  /** Plan Neon account -> participant creates and program/vajrayana updates. */
  accounts: boolean;
  /** Plan Neon "Email 1" -> participant email updates. */
  emails: boolean;
  /** When set, only these participant ids are updated and no participants are created. */
  participantIds?: ReadonlySet<string>;
  excludeFirstNames: readonly string[];
  excludeLastNames: readonly string[];
  resendWindowDays: number;
  now: Date;
  newId: () => string;
}

export type SkipReason =
  | 'neonDoNotContact'
  | 'neonDeceased'
  | 'possibleDuplicate'
  | 'excludedName'
  | 'blankNeonEmail'
  | 'participantNotInNeon'
  | 'emailInUse'
  | 'duplicateNeonId';

export interface Plan {
  changes: Change[];
  skipped: Record<SkipReason, string[]>;
}

export function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function nameKey(first: string | undefined, last: string | undefined): string | null {
  const f = (first ?? '').trim().toLowerCase();
  const l = (last ?? '').trim().toLowerCase();
  return f && l ? `${f}\u0000${l}` : null;
}

function neonIdOf(participant: Participant): string | null {
  const id = String(participant.neonId ?? '').trim();
  return id || null;
}

/** Timestamps without a zone are treated as UTC (that is how the sending services write them). */
function parseSentAt(value: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

/** emails.<key> entries sent within the window, i.e. ones that should be resent to a corrected address. */
export function recentSendKeys(
  emails: Participant['emails'],
  now: Date,
  windowDays: number,
): string[] {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  return Object.entries(emails ?? {})
    .filter(([, sentAt]) => typeof sentAt === 'string' && parseSentAt(sentAt) >= cutoff)
    .map(([key]) => key)
    .sort();
}

/**
 * Computes the participant table changes needed to reflect Neon. Pure: performs no I/O.
 *
 * Accounts: each Neon account (skipping do-not-contact and deceased) is matched to a
 * participant by neonId. Matched, subscribed participants gain any program flags and
 * vajrayana level they're missing. Unmatched accounts become new participants, unless
 * a participant with the same name or email already exists (a likely duplicate that
 * needs a human to link it), or the name is on the exclusion list.
 *
 * Emails: a participant whose email differs from their Neon account's "Email 1" takes
 * the Neon address, and recent sends are cleared so they go out again to the new address.
 */
export function planSync(
  participants: readonly Participant[],
  accounts: readonly NeonAccount[],
  options: PlanOptions,
): Plan {
  const plan: Plan = {
    changes: [],
    skipped: {
      neonDoNotContact: [],
      neonDeceased: [],
      possibleDuplicate: [],
      excludedName: [],
      blankNeonEmail: [],
      participantNotInNeon: [],
      emailInUse: [],
      duplicateNeonId: [],
    },
  };
  const inScope = (p: Participant) => !options.participantIds || options.participantIds.has(p.id);

  const byNeonId = new Map<string, Participant>();
  const byName = new Set<string>();
  const byEmail = new Map<string, string>(); // normalized email -> participant id
  for (const p of participants) {
    const neonId = neonIdOf(p);
    if (neonId) {
      if (byNeonId.has(neonId)) plan.skipped.duplicateNeonId.push(p.id);
      else byNeonId.set(neonId, p);
    }
    const key = nameKey(p.first, p.last);
    if (key) byName.add(key);
    const email = normalizeEmail(p.email);
    if (email && !byEmail.has(email)) byEmail.set(email, p.id);
  }

  if (options.emails) {
    const accountsById = new Map(accounts.map((a) => [a.accountId, a]));
    for (const p of byNeonId.values()) {
      if (!inScope(p)) continue;
      const account = accountsById.get(neonIdOf(p)!);
      if (!account) {
        plan.skipped.participantNotInNeon.push(p.id);
        continue;
      }
      const neonEmail = normalizeEmail(account.email);
      const current = normalizeEmail(p.email);
      if (neonEmail === current) continue;
      if (!neonEmail) {
        plan.skipped.blankNeonEmail.push(p.id);
        continue;
      }
      const holder = byEmail.get(neonEmail);
      if (holder && holder !== p.id) {
        plan.skipped.emailInUse.push(p.id);
        continue;
      }
      byEmail.set(neonEmail, p.id);
      plan.changes.push({
        kind: 'updateEmail',
        participantId: p.id,
        neonId: account.accountId,
        previousEmail: p.email ?? '',
        email: neonEmail,
        clearEmailKeys: recentSendKeys(p.emails, options.now, options.resendWindowDays),
      });
    }
  }

  if (options.accounts) {
    for (const account of accounts) {
      if (account.doNotContact) {
        plan.skipped.neonDoNotContact.push(account.accountId);
        continue;
      }
      if (account.deceased) {
        plan.skipped.neonDeceased.push(account.accountId);
        continue;
      }

      const existing = byNeonId.get(account.accountId);
      if (existing) {
        if (inScope(existing) && !existing.unsubscribe) {
          plan.changes.push(...updatesFor(existing, account));
        }
        continue;
      }
      if (options.participantIds) continue;

      const key = nameKey(account.firstName, account.lastName);
      const email = normalizeEmail(account.email);
      if ((key && byName.has(key)) || (email && byEmail.has(email))) {
        plan.skipped.possibleDuplicate.push(account.accountId);
        continue;
      }
      if (isExcluded(account, options)) {
        plan.skipped.excludedName.push(account.accountId);
        continue;
      }
      if (!email) {
        plan.skipped.blankNeonEmail.push(account.accountId);
        continue;
      }

      const item = newParticipant(account, options.newId());
      plan.changes.push({ kind: 'create', neonId: account.accountId, item });
      // Guard against creating two participants for the same person within one run.
      if (key) byName.add(key);
      byEmail.set(email, item.id);
    }
  }

  return plan;
}

function updatesFor(p: Participant, account: NeonAccount): Change[] {
  const changes: Change[] = [];
  const vajrayana = account.custom[VAJRAYANA_FIELD_ID];
  if (vajrayana && !p.vajrayana) {
    changes.push({ kind: 'setVajrayana', participantId: p.id, neonId: account.accountId, value: vajrayana });
  }
  for (const rule of rulesFor('existing')) {
    if (!account.custom[rule.fieldId]) continue;
    const program = p.programs?.[rule.program];
    if (program?.[rule.flag]) continue;
    changes.push({
      kind: 'setProgramFlag',
      participantId: p.id,
      neonId: account.accountId,
      program: rule.program,
      flag: rule.flag,
      programExists: program !== undefined && program !== null,
    });
  }
  return changes;
}

function isExcluded(account: NeonAccount, options: PlanOptions): boolean {
  const first = account.firstName.toLowerCase();
  const last = account.lastName.toLowerCase();
  return (
    options.excludeFirstNames.some((s) => first.includes(s)) ||
    options.excludeLastNames.some((s) => last.includes(s))
  );
}

function newParticipant(account: NeonAccount, id: string): NewParticipant {
  const programs: NewParticipant['programs'] = {};
  for (const rule of rulesFor('new')) {
    if (account.custom[rule.fieldId]) programs[rule.program] = { [rule.flag]: true };
  }
  const vajrayana = account.custom[VAJRAYANA_FIELD_ID];
  return {
    id,
    neonId: account.accountId,
    first: account.firstName,
    last: account.lastName,
    email: normalizeEmail(account.email),
    programs,
    emails: {},
    beta: false,
    translate: false,
    unsubscribe: false,
    language: 'English',
    ...(vajrayana ? { vajrayana } : {}),
  };
}
