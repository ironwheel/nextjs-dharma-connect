import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planSync, recentSendKeys, type PlanOptions } from '../src/reconcile.ts';
import type { NeonAccount, Participant } from '../src/types.ts';

const NOW = new Date('2026-01-15T12:00:00Z');

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  let n = 0;
  return {
    accounts: true,
    emails: true,
    excludeFirstNames: [],
    excludeLastNames: [],
    resendWindowDays: 7,
    now: NOW,
    newId: () => `new-${++n}`,
    ...overrides,
  };
}

function account(overrides: Partial<NeonAccount> = {}): NeonAccount {
  return {
    accountId: '100',
    firstName: 'Ada',
    lastName: 'Example',
    email: 'ada@example.com',
    deceased: false,
    doNotContact: false,
    custom: {},
    ...overrides,
  };
}

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p1',
    neonId: '100',
    first: 'Ada',
    last: 'Example',
    email: 'ada@example.com',
    unsubscribe: false,
    programs: {},
    emails: {},
    ...overrides,
  };
}

describe('planSync accounts', () => {
  it('creates a participant for an unknown account with new-only programs and vajrayana', () => {
    const plan = planSync([], [account({ email: ' Ada@Example.com ', custom: { '79': 'Attended', '95': 'RIC 2021', '92': 'SSA' } })], options());
    assert.deepEqual(plan.changes, [
      {
        kind: 'create',
        neonId: '100',
        item: {
          id: 'new-1',
          neonId: '100',
          first: 'Ada',
          last: 'Example',
          email: 'ada@example.com',
          programs: { drgy: { join: true } },
          emails: {},
          beta: false,
          translate: false,
          unsubscribe: false,
          language: 'English',
          vajrayana: 'SSA',
        },
      },
    ]);
  });

  it('skips do-not-contact and deceased accounts', () => {
    const plan = planSync(
      [],
      [account({ accountId: '1', doNotContact: true }), account({ accountId: '2', deceased: true })],
      options(),
    );
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.skipped.neonDoNotContact, ['1']);
    assert.deepEqual(plan.skipped.neonDeceased, ['2']);
  });

  it('treats a name or email match without a neonId link as a possible duplicate', () => {
    const unlinked = participant({ neonId: undefined, email: 'other@example.com' });
    const plan = planSync(
      [unlinked],
      [account({ accountId: '1', firstName: 'ADA' }), account({ accountId: '2', firstName: 'Bo', email: 'OTHER@example.com' })],
      options(),
    );
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.skipped.possibleDuplicate, ['1', '2']);
  });

  it('does not create two participants for the same person in one run', () => {
    const plan = planSync([], [account({ accountId: '1' }), account({ accountId: '2' })], options());
    assert.equal(plan.changes.length, 1);
    assert.deepEqual(plan.skipped.possibleDuplicate, ['2']);
  });

  it('applies case-insensitive substring name exclusions', () => {
    const plan = planSync(
      [],
      [account({ accountId: '1', firstName: 'Anonymous Donor' }), account({ accountId: '2', lastName: 'Testperson', email: 'b@example.com' })],
      options({ excludeFirstNames: ['anonymous'], excludeLastNames: ['testp'] }),
    );
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.skipped.excludedName, ['1', '2']);
  });

  it('does not create participants without an email', () => {
    const plan = planSync([], [account({ email: '' })], options());
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.skipped.blankNeonEmail, ['100']);
  });

  it('adds missing program flags and vajrayana to existing subscribed participants', () => {
    const plan = planSync(
      [participant({ programs: { nextgen: { visible: true }, pilgrimage2020: { join: true } } })],
      [account({ custom: { '79': 'x', '80': '2020', '83': 'Yes', '92': 'RA', '95': 'RIC 2021' } })],
      options(),
    );
    assert.deepEqual(plan.changes, [
      { kind: 'setVajrayana', participantId: 'p1', neonId: '100', value: 'RA' },
      { kind: 'setProgramFlag', participantId: 'p1', neonId: '100', program: 'nextgen', flag: 'join', programExists: true },
      { kind: 'setProgramFlag', participantId: 'p1', neonId: '100', program: 'ric2021', flag: 'invite', programExists: false },
    ]);
  });

  it('never overwrites an existing vajrayana level', () => {
    const plan = planSync([participant({ vajrayana: 'SWA' })], [account({ custom: { '92': 'RA' } })], options());
    assert.deepEqual(plan.changes, []);
  });

  it('leaves unsubscribed participants alone', () => {
    const plan = planSync([participant({ unsubscribe: true })], [account({ custom: { '83': 'Yes', '92': 'RA' } })], options());
    assert.deepEqual(plan.changes, []);
  });

  it('matches neonId regardless of number/string storage', () => {
    const plan = planSync([participant({ neonId: 100 as unknown as string })], [account()], options());
    assert.deepEqual(plan.changes, []);
  });

  it('tolerates participants missing neonId, unsubscribe, and programs', () => {
    const sparse: Participant = { id: 'admin', email: 'admin@example.com' };
    const plan = planSync([sparse, participant({ programs: undefined })], [account({ custom: { '83': 'Yes' } })], options());
    assert.deepEqual(plan.changes, [
      { kind: 'setProgramFlag', participantId: 'p1', neonId: '100', program: 'nextgen', flag: 'join', programExists: false },
    ]);
  });

  it('with --participant, only updates those participants and creates nobody', () => {
    const plan = planSync(
      [participant({ id: 'p1', neonId: '1' }), participant({ id: 'p2', neonId: '2', first: 'B', email: 'b@example.com' })],
      [account({ accountId: '1', custom: { '83': 'Yes' } }), account({ accountId: '2', firstName: 'B', email: 'b@example.com', custom: { '83': 'Yes' } }), account({ accountId: '3', firstName: 'C', email: 'c@example.com' })],
      options({ participantIds: new Set(['p2']) }),
    );
    assert.deepEqual(plan.changes.map((c) => c.kind === 'setProgramFlag' && c.participantId), ['p2']);
  });

  it('reports duplicate neonIds and uses the first participant', () => {
    const plan = planSync([participant({ id: 'a' }), participant({ id: 'b' })], [], options({ accounts: false, emails: false }));
    assert.deepEqual(plan.skipped.duplicateNeonId, ['b']);
  });
});

describe('planSync emails', () => {
  it('takes the normalized Neon email and clears recent sends', () => {
    const plan = planSync(
      [
        participant({
          email: 'old@example.com',
          emails: {
            recent: '2026-01-10T09:00:00.000Z',
            naiveRecent: '2026-01-14T09:00:00',
            old: '2025-12-01T09:00:00Z',
            legacy: true,
          },
        }),
      ],
      [account({ email: ' New@Example.com' })],
      options({ accounts: false }),
    );
    assert.deepEqual(plan.changes, [
      {
        kind: 'updateEmail',
        participantId: 'p1',
        neonId: '100',
        previousEmail: 'old@example.com',
        email: 'new@example.com',
        clearEmailKeys: ['naiveRecent', 'recent'],
      },
    ]);
  });

  it('ignores case and whitespace differences', () => {
    const plan = planSync([participant({ email: 'ADA@example.com ' })], [account()], options({ accounts: false }));
    assert.deepEqual(plan.changes, []);
  });

  it('skips blank Neon emails, missing accounts, and addresses held by another participant', () => {
    const plan = planSync(
      [
        participant({ id: 'blank', neonId: '1' }),
        participant({ id: 'gone', neonId: '2' }),
        participant({ id: 'taken', neonId: '3', email: 'mine@example.com' }),
        participant({ id: 'holder', neonId: undefined, email: 'theirs@example.com' }),
      ],
      [account({ accountId: '1', email: '' }), account({ accountId: '3', email: 'theirs@example.com' })],
      options({ accounts: false }),
    );
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.skipped.blankNeonEmail, ['blank']);
    assert.deepEqual(plan.skipped.participantNotInNeon, ['gone']);
    assert.deepEqual(plan.skipped.emailInUse, ['taken']);
  });

  it('syncs emails for do-not-contact accounts too', () => {
    const plan = planSync([participant()], [account({ doNotContact: true, email: 'new@example.com' })], options({ accounts: false }));
    assert.equal(plan.changes[0]?.kind, 'updateEmail');
  });
});

describe('recentSendKeys', () => {
  it('includes the window boundary and future timestamps, skips unparseable values', () => {
    const keys = recentSendKeys(
      { edge: '2026-01-08T12:00:00Z', future: '2026-02-01T00:00:00+01:00', junk: 'not a date', stale: '2026-01-08T11:59:59Z' },
      NOW,
      7,
    );
    assert.deepEqual(keys, ['edge', 'future']);
  });
});
