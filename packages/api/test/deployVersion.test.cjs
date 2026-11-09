// Exercises GET /deploy/version end to end -- dispatchDeploy, the release
// history, and the merged-pull-request history used when there are no release
// tags -- against a stubbed GitHub API.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transpileLib } = require('./transpile.cjs');

const REPO = 'example-owner/example-repo';

const sha = (c) => c.repeat(40);
const S = {
  r1: sha('1'), r2: sha('2'), r3: sha('3'), dev: sha('d'),
  // The branch, for the no-tags history: m3 merges a pull request branch (b2 <- b1),
  // m2 is a squash merge, m1 a direct push.
  m3: sha('a'), b2: sha('b'), b1: sha('c'), m2: sha('e'), m1: sha('f'),
};
const tagObj = (c) => `ab${c}`.padEnd(40, 'f');

// --- stubbed GitHub ------------------------------------------------------------
let calls = [];
let failTagDetailsFor = null;
let withReleaseTags = true;
let failBranchList = false;

const releaseTagList = () => [
  // GitHub's own order is not chronological; the code must sort.
  { name: 'release-2026-09-17', commit: { sha: S.r2 } },
  { name: 'archive/old-2026-03-04', commit: { sha: sha('0') } },
  { name: 'release-2026-09-17.1', commit: { sha: S.r3 } },
  { name: 'release-2026-09-16', commit: { sha: S.r1 } },
];

const branchCommits = () => [
  { sha: S.m3, parents: [{ sha: S.m2 }, { sha: S.b2 }], commit: { message: 'Merge pull request #12 from example-owner/feat/thing\n\nShow the thing', committer: { date: '2026-11-08T18:00:00Z' } } },
  { sha: S.b2, parents: [{ sha: S.b1 }], commit: { message: 'Tidy up', committer: { date: '2026-11-08T17:00:00Z' } } },
  { sha: S.b1, parents: [{ sha: S.m2 }], commit: { message: 'Not on main itself (#99)', committer: { date: '2026-11-08T16:00:00Z' } } },
  { sha: S.m2, parents: [{ sha: S.m1 }], commit: { message: 'Fix the other thing (#11)\n\nbody', committer: { date: '2026-11-06T12:00:00Z' } } },
  { sha: S.m1, parents: [{ sha: sha('9') }], commit: { message: 'Direct push to main', committer: { date: '2026-11-05T12:00:00Z' } } },
];

const routes = [
  [/\/repos\/example-owner\/example-repo\/tags\?per_page=100$/, () => (withReleaseTags ? releaseTagList() : [{ name: 'v1.0.0', commit: { sha: sha('0') } }])],
  [/\/git\/ref\/tags\/release-2026-09-16$/, () => ({ object: { type: 'commit', sha: S.r1 } })], // a lightweight tag
  [/\/git\/ref\/tags\/(release-[\d.-]+)$/, (m) => {
    if (m[1] === failTagDetailsFor) return { status: 500 };
    return { object: { type: 'tag', sha: tagObj(m[1].endsWith('.1') ? 3 : 2) } };
  }],
  [new RegExp(`/git/tags/${tagObj(3)}$`), () => ({ message: 'Promoted to release by someone\n\nRun: https://x/2\n\nhost fix (#203)\n', tagger: { date: '2026-09-17T12:00:00Z' } })],
  [new RegExp(`/git/tags/${tagObj(2)}$`), () => ({ message: 'Promoted to release by someone\n\nRun: https://x/1\n', tagger: { date: '2026-09-17T09:00:00Z' } })],
  [/\/compare\/release-2026-09-17\.\.\.release-2026-09-17\.1\?per_page=250$/, () => ({ commits: [
    { commit: { message: 'fix: first (#201)' } },
    { commit: { message: 'Checkpoint commit' } },
    { commit: { message: 'fix: second (#203)\n\nbody' } },
  ] })],
  [/\/compare\/release-2026-09-16\.\.\.release-2026-09-17\?per_page=250$/, () => ({ commits: [{ commit: { message: 'feat: earlier (#199)' } }] })],
  [/\/commits\?sha=main&per_page=100$/, () => (failBranchList ? { status: 502 } : branchCommits())],
  [new RegExp(`/commits/(${[S.r1, S.r2, S.r3, S.dev, S.m3].join('|')})$`), (m) => ({ html_url: `https://github.com/${REPO}/commit/${m[1]}`, commit: { message: `subject of ${m[1].substring(0, 7)}\n\nbody`, committer: { date: '2026-09-17T08:00:00Z' } } })],
  [/\/commits\/[0-9a-f]{40}$/, () => ({ status: 404 })],
];

function fakeFetch(url) {
  calls.push(url);
  for (const [re, handler] of routes) {
    const m = re.exec(url);
    if (!m) continue;
    const out = handler(m);
    const status = out && typeof out.status === 'number' && Object.keys(out).length === 1 ? out.status : 200;
    return Promise.resolve({ ok: status < 400, status, json: async () => out });
  }
  return Promise.resolve({ ok: false, status: 599, json: async () => ({}) });
}

let dispatchDeploy, resetReleaseCaches;

before(() => {
  const build = transpileLib('deployVersion', ['versionInfo', 'releaseInfo', 'releaseNotes']);
  Object.assign(process.env, {
    GITHUB_TOKEN: 'test-token',
    VERSION_ENVIRONMENT: 'production',
    VERSION_GITHUB_BRANCH: 'main',
    VERSION_GITHUB_REPO: REPO,
  });
  globalThis.fetch = fakeFetch;
  const quiet = console.warn; console.warn = () => {};
  ({ dispatchDeploy } = require(path.join(build, 'versionInfo.js')));
  ({ resetReleaseCaches } = require(path.join(build, 'releaseInfo.js')));
  process.on('exit', () => { console.warn = quiet; });
});

beforeEach(() => {
  calls = [];
  failTagDetailsFor = null;
  withReleaseTags = true;
  failBranchList = false;
  resetReleaseCaches();
});

async function getVersion(query, method = 'GET') {
  let status = 0; let body;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, setHeader() {} };
  await dispatchDeploy('version', { method, query }, res);
  return { status, body };
}

// --- with release tags -----------------------------------------------------------

test('a released build is labelled with its tag', async () => {
  const { status, body } = await getVersion({ sha: S.r3 });
  assert.equal(status, 200);
  assert.equal(body.releaseTag, 'release-2026-09-17.1');
  assert.equal(body.label, 'release-2026-09-17.1');
  assert.equal(body.commit.subject, `subject of ${S.r3.substring(0, 7)}`);
  assert.equal(body.reason, '');
  assert.deepEqual(body.changes, [], 'merged-PR history is only for repositories without releases');
  assert.ok(!calls.some((u) => u.includes('/commits?sha=')));
});

test('release history is newest first, release tags only, with notes', async () => {
  const { body } = await getVersion({ sha: S.r3 });
  assert.deepEqual(body.releases.map((r) => r.tag), ['release-2026-09-17.1', 'release-2026-09-17', 'release-2026-09-16']);
  const [newest, middle, oldest] = body.releases;
  assert.equal(newest.promotedBy, 'someone');
  assert.equal(newest.reason, 'host fix (#203)');
  assert.equal(newest.date, '2026-09-17T12:00:00Z');
  assert.equal(newest.previousTag, 'release-2026-09-17');
  assert.equal(newest.compareUrl, `https://github.com/${REPO}/compare/release-2026-09-17...release-2026-09-17.1`);
  assert.equal(middle.reason, '');
  assert.equal(oldest.previousTag, null);
  assert.equal(oldest.compareUrl, null);
});

test('each release lists the pull requests it carried, newest first, with links', async () => {
  const { body } = await getVersion({ sha: S.r3 });
  assert.deepEqual(body.releases[0].pullRequests, [
    { number: 203, title: 'fix: second', url: `https://github.com/${REPO}/pull/203` },
    { number: 201, title: 'fix: first', url: `https://github.com/${REPO}/pull/201` },
  ]);
  assert.deepEqual(body.releases[1].pullRequests.map((p) => p.number), [199]);
  assert.deepEqual(body.releases[2].pullRequests, []);
});

test('a lightweight tag takes its date from the commit', async () => {
  const { body } = await getVersion({ sha: S.r3 });
  assert.equal(body.releases[2].date, '2026-09-17T08:00:00Z');
});

test('an unreleased build is labelled by its short commit, not the release containing it', async () => {
  const { body } = await getVersion({ sha: S.dev });
  assert.equal(body.releaseTag, null);
  assert.equal(body.label, S.dev.substring(0, 7)); // production environment: no dev prefix
  assert.equal(body.releases.length, 3);
});

test('one release failing to load keeps the rest of the history', async () => {
  failTagDetailsFor = 'release-2026-09-17';
  const { body } = await getVersion({ sha: S.r3 });
  assert.equal(body.releases.length, 3);
  assert.equal(body.releases[1].tag, 'release-2026-09-17');
  assert.equal(body.releases[1].reason, '');
  assert.equal(body.releases[0].reason, 'host fix (#203)');
});

test('history and tag details are cached between requests', async () => {
  await getVersion({ sha: S.r3 });
  const first = calls.length;
  calls = [];
  await getVersion({ sha: S.r3 });
  assert.ok(calls.length < first, `expected fewer GitHub calls the second time (${calls.length} vs ${first})`);
  assert.ok(!calls.some((u) => u.includes('/git/')), 'tag annotations are not re-read');
  assert.ok(!calls.some((u) => u.includes('per_page=250')), 'release comparisons are not re-read');
  assert.ok(!calls.some((u) => u.includes('/tags?')), 'the tag list is not re-read within five minutes');
});

// --- without release tags ----------------------------------------------------------

test('with no release tags, the history is the pull requests merged on the branch', async () => {
  withReleaseTags = false;
  const { status, body } = await getVersion({ sha: S.m3 });
  assert.equal(status, 200);
  assert.equal(body.releaseTag, null);
  assert.equal(body.label, S.m3.substring(0, 7));
  assert.deepEqual(body.releases, []);
  assert.deepEqual(body.changes, [
    { number: 12, title: 'Show the thing', url: `https://github.com/${REPO}/pull/12`, sha: S.m3, shortSha: S.m3.substring(0, 7), date: '2026-11-08T18:00:00Z' },
    { number: 11, title: 'Fix the other thing', url: `https://github.com/${REPO}/pull/11`, sha: S.m2, shortSha: S.m2.substring(0, 7), date: '2026-11-06T12:00:00Z' },
  ]);
  assert.equal(body.reason, '');
});

test('the merged-pull-request history is cached between requests', async () => {
  withReleaseTags = false;
  await getVersion({ sha: S.m3 });
  calls = [];
  await getVersion({ sha: S.m3 });
  assert.ok(!calls.some((u) => u.includes('/commits?sha=')), 'the branch is not re-read within five minutes');
});

test('a failed branch read still answers, with the reason', async () => {
  withReleaseTags = false;
  failBranchList = true;
  const { status, body } = await getVersion({ sha: S.m3 });
  assert.equal(status, 200);
  assert.deepEqual(body.changes, []);
  assert.match(body.reason, /HTTP 502/);
  assert.equal(body.label, S.m3.substring(0, 7));
});

// --- either way ----------------------------------------------------------------------

test('an unknown commit still answers, with the commit unresolved', async () => {
  const { status, body } = await getVersion({ sha: 'c'.repeat(40) });
  assert.equal(status, 200);
  assert.equal(body.commit, null);
  assert.equal(body.label, 'ccccccc');
});

test('dev builds are marked as such', async () => {
  process.env.VERSION_ENVIRONMENT = 'dev';
  try {
    withReleaseTags = false;
    const { body } = await getVersion({ sha: S.m3 });
    assert.equal(body.environment, 'dev');
    assert.equal(body.label, `dev · ${S.m3.substring(0, 7)}`);
  } finally {
    process.env.VERSION_ENVIRONMENT = 'production';
  }
});

test('a malformed sha is refused', async () => {
  for (const bad of [undefined, 'localhost', 'abc1234', 'z'.repeat(40), `${S.r3}0`]) {
    const { status } = await getVersion({ sha: bad });
    assert.equal(status, 400, `sha=${bad}`);
  }
  assert.equal(calls.length, 0);
});

test('only GET is served, and only the version action', async () => {
  assert.equal((await getVersion({ sha: S.r3 }, 'POST')).status, 405);
  let status = 0;
  const res = { status(s) { status = s; return this; }, json() { return this; }, setHeader() {} };
  await dispatchDeploy('latest', { method: 'GET', query: {} }, res);
  assert.equal(status, 404);
});

test('without a GitHub token the badge still gets a label and the reason', async () => {
  const saved = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    const { status, body } = await getVersion({ sha: S.r3 });
    assert.equal(status, 200);
    assert.equal(body.label, S.r3.substring(0, 7));
    assert.match(body.reason, /GITHUB_TOKEN is not configured/);
    assert.deepEqual(body.releases, []);
    assert.deepEqual(body.changes, []);
    assert.equal(calls.length, 0);
  } finally {
    process.env.GITHUB_TOKEN = saved;
  }
});
