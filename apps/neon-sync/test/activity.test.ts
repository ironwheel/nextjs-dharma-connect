import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityForChange, activityRecord } from '../src/activity.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');

describe('activityRecord', () => {
  it('keys by UTC day and timestamp, and sets expiry', () => {
    const record = activityRecord({ type: 'sync.run', summary: 'ok' }, NOW, 30);
    assert.equal(record.day, '2026-01-15');
    assert.match(record.id, /^2026-01-15T12:00:00\.000Z#[0-9a-f]{6}$/);
    assert.equal(record.ts, '2026-01-15T12:00:00.000Z');
    assert.equal(record.source, 'neon-sync');
    assert.equal(record.expiresAt, NOW.getTime() / 1000 + 30 * 86_400);
  });

  it('keeps email addresses out of the search text', () => {
    const record = activityRecord(
      activityForChange({
        kind: 'updateEmail',
        participantId: 'p1',
        neonId: '100',
        previousEmail: 'old@example.com',
        email: 'new@example.com',
        clearEmailKeys: ['campaign-a'],
      }, { id: 'p1', first: 'Ada', last: 'Example' }),
      NOW,
      365,
    );
    assert.equal(record.type, 'student.emailChanged');
    assert.equal(record.studentName, 'Ada Example');
    assert.ok(record.searchText.includes('ada example'));
    assert.ok(record.searchText.includes('campaign-a'));
    assert.ok(!record.searchText.includes('@'));
    assert.ok(!record.summary.includes('@'));
    assert.deepEqual(record.details, {
      neonId: '100',
      previousEmail: 'old@example.com',
      email: 'new@example.com',
      clearedSends: ['campaign-a'],
    });
  });

  it('describes new students with their programs', () => {
    const entry = activityForChange({
      kind: 'create',
      neonId: '200',
      item: {
        id: 'new-1', neonId: '200', first: 'Bo', last: 'Sample', email: 'bo@example.com',
        programs: { nextgen: { join: true } }, emails: {}, beta: false, translate: false,
        unsubscribe: false, language: 'English', vajrayana: 'RA',
      },
    });
    assert.equal(entry.type, 'student.created');
    assert.equal(entry.studentId, 'new-1');
    assert.equal(entry.studentName, 'Bo Sample');
    assert.deepEqual(entry.details, { neonId: '200', email: 'bo@example.com', programs: ['nextgen'], vajrayana: 'RA' });
  });
});
