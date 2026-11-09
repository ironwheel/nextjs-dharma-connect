// Unit tests for lib/releaseNotes.ts: the pure helpers behind the version badge.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transpileLib } = require('./transpile.cjs');

const {
  compareReleaseTags,
  firstParentChain,
  isReleaseTag,
  parseTagMessage,
  prTitleFromCommit,
  prTitlesFromCommits,
  versionLabel,
} = require(path.join(transpileLib('releaseNotes', ['releaseNotes']), 'releaseNotes.js'));

test('release tags are recognised; other tags are not', () => {
  assert.ok(isReleaseTag('release-2026-09-17'));
  assert.ok(isReleaseTag('release-2026-09-17.4'));
  assert.equal(isReleaseTag('archive/old-2026-03-04'), false);
  assert.equal(isReleaseTag('release-2026-9-17'), false);
  assert.equal(isReleaseTag('v1.18.4'), false);
});

test('release tags sort newest first, by date and then same-day counter', () => {
  const tags = ['release-2026-09-17.2', 'release-2026-09-16', 'release-2026-09-17', 'release-2026-09-17.10', 'release-2026-09-16.1'];
  assert.deepEqual([...tags].sort(compareReleaseTags), [
    'release-2026-09-17.10', 'release-2026-09-17.2', 'release-2026-09-17', 'release-2026-09-16.1', 'release-2026-09-16',
  ]);
});

test('non-release tags sort after release tags', () => {
  assert.deepEqual(['v1', 'release-2026-01-01'].sort(compareReleaseTags), ['release-2026-01-01', 'v1']);
});

test('a promote workflow tag message splits into its parts', () => {
  const msg = 'Promoted to release by someone\n\nRun: https://github.com/o/r/actions/runs/1\n\nfix the dashboard (#208)\n';
  assert.deepEqual(parseTagMessage(msg), {
    promotedBy: 'someone',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    reason: 'fix the dashboard (#208)',
  });
});

test('a tag with no reason, or a hand-written message, still parses', () => {
  assert.equal(parseTagMessage('Promoted to release by a\n\nRun: https://x/1\n').reason, '');
  assert.deepEqual(parseTagMessage('Hotfix for the dashboard'), { promotedBy: '', runUrl: '', reason: 'Hotfix for the dashboard' });
  assert.deepEqual(parseTagMessage(''), { promotedBy: '', runUrl: '', reason: '' });
});

test('squash merges and merge commits yield pull request titles; direct commits do not', () => {
  const commits = [
    'Scope access tokens to the app that requested them (#211)\n\nlong body',
    'Merge pull request #57 from o/feat/some-branch\n\nShow the link found in the email',
    'Checkpoint commit',
    'Track release tags (#209)',
  ];
  assert.deepEqual(prTitlesFromCommits(commits), [
    { number: 211, title: 'Scope access tokens to the app that requested them' },
    { number: 57, title: 'Show the link found in the email' },
    { number: 209, title: 'Track release tags' },
  ]);
});

test('a single commit yields its pull request, or null', () => {
  assert.deepEqual(prTitleFromCommit('Merge pull request #12 from o/b\n\n\n  Title here  \nmore'), { number: 12, title: 'Title here' });
  assert.deepEqual(prTitleFromCommit('Squashed title (#3)'), { number: 3, title: 'Squashed title' });
  assert.equal(prTitleFromCommit('Merge branch main into feature'), null);
  assert.equal(prTitleFromCommit(''), null);
});

test('a pull request seen twice is listed once', () => {
  assert.deepEqual(prTitlesFromCommits(['a (#1)', 'a again (#1)']), [{ number: 1, title: 'a' }]);
});

test('a merge commit without a body falls back to its subject', () => {
  assert.deepEqual(prTitlesFromCommits(['Merge pull request #7 from o/b']), [{ number: 7, title: 'Merge pull request #7 from o/b' }]);
});

test('the first-parent line skips commits merged in from pull request branches', () => {
  // main: m3 (merge of f2) -> m2 (merge of f1) -> m1; f1 and f2 are branch commits.
  const commits = [
    { sha: 'm3', parents: ['m2', 'f2'] },
    { sha: 'f2', parents: ['m2'] },
    { sha: 'm2', parents: ['m1', 'f1'] },
    { sha: 'f1', parents: ['m1'] },
    { sha: 'm1', parents: ['m0'] }, // m0 is beyond the fetched page
  ];
  assert.deepEqual(firstParentChain(commits, 'm3'), ['m3', 'm2', 'm1']);
  assert.deepEqual(firstParentChain(commits, 'nope'), []);
  assert.deepEqual(firstParentChain([{ sha: 'a', parents: ['a'] }], 'a'), ['a'], 'a cycle stops');
});

test('the badge shows the release tag, else the short commit, marked dev on dev', () => {
  assert.equal(versionLabel('75568c7', 'release-2026-09-17.4', 'production'), 'release-2026-09-17.4');
  assert.equal(versionLabel('75568c7', 'release-2026-09-17.4', 'dev'), 'release-2026-09-17.4');
  assert.equal(versionLabel('a7132ec', null, 'dev'), 'dev · a7132ec');
  assert.equal(versionLabel('a7132ec', null, 'production'), 'a7132ec');
});
