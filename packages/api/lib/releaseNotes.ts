/**
 * @file packages/api/lib/releaseNotes.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2026
 * @license MIT
 * @description Reads release information out of git data: release tag order,
 * a promote workflow's tag message, pull request titles from commit messages,
 * and a branch's first-parent line.
 *
 * Kept free of imports and I/O so it can be unit-tested directly; releaseInfo.ts
 * does the fetching.
 */

/** A pull request that landed in a release, as recovered from its commit. */
export interface PullRequestTitle {
  number: number;
  title: string;
}

/** What the promote workflow writes into a release tag's annotation. */
export interface TagMessage {
  promotedBy: string;
  runUrl: string;
  /** The reason given when promoting; empty when none was. */
  reason: string;
}

const RELEASE_TAG = /^release-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/;

/**
 * @function isReleaseTag
 * @description Whether a tag name is one the promote workflow writes.
 * @param {string} name - Tag name.
 * @returns {boolean} True for release-YYYY-MM-DD and release-YYYY-MM-DD.N.
 */
export function isReleaseTag(name: string): boolean {
  return RELEASE_TAG.test(name);
}

/**
 * @function compareReleaseTags
 * @description Sort comparator putting the newest release tag first.
 *
 * By date, then by the same-day counter, where the first promotion of a day has
 * no counter and so counts as 0. Plain string order gets this wrong once a day
 * reaches .10.
 * @param {string} a - Tag name.
 * @param {string} b - Tag name.
 * @returns {number} Negative when a is newer than b.
 */
export function compareReleaseTags(a: string, b: string): number {
  const ma = RELEASE_TAG.exec(a);
  const mb = RELEASE_TAG.exec(b);
  if (!ma || !mb) {
    if (ma) return -1;
    if (mb) return 1;
    return b.localeCompare(a);
  }
  if (ma[1] !== mb[1]) return mb[1].localeCompare(ma[1]);
  return Number(mb[2] ?? 0) - Number(ma[2] ?? 0);
}

/**
 * @function parseTagMessage
 * @description Splits a promote workflow tag annotation into its parts.
 *
 * The workflow writes "Promoted to release by <actor>", a "Run: <url>" line,
 * and then the reason, each separated by a blank line. Anything that is not one
 * of the first two lines is treated as the reason, so a hand-made tag still
 * shows its message.
 * @param {string} message - The annotated tag's message.
 * @returns {TagMessage} The parsed parts, empty strings where absent.
 */
export function parseTagMessage(message: string): TagMessage {
  const lines = String(message ?? '').split('\n');
  let promotedBy = '';
  let runUrl = '';
  const rest: string[] = [];
  for (const line of lines) {
    const by = /^Promoted to release by (.+)$/.exec(line.trim());
    const run = /^Run: (\S+)$/.exec(line.trim());
    if (by && !promotedBy) promotedBy = by[1];
    else if (run && !runUrl) runUrl = run[1];
    else rest.push(line);
  }
  return { promotedBy, runUrl, reason: rest.join('\n').trim() };
}

/**
 * @function prTitlesFromCommits
 * @description Pull requests named by a list of commit messages, in the order given.
 *
 * Recognises a squash merge ("<title> (#123)") and a merge commit ("Merge pull
 * request #123 from owner/branch", with the title on the first body line).
 * Commits pushed without a pull request are skipped, and a pull request seen
 * twice is listed once.
 * @param {string[]} messages - Full commit messages.
 * @returns {PullRequestTitle[]} Pull request numbers and titles.
 */
export function prTitlesFromCommits(messages: string[]): PullRequestTitle[] {
  const seen = new Set<number>();
  const out: PullRequestTitle[] = [];
  for (const message of messages ?? []) {
    const found = prTitleFromCommit(message);
    if (found && !seen.has(found.number)) {
      seen.add(found.number);
      out.push(found);
    }
  }
  return out;
}

/**
 * @function prTitleFromCommit
 * @description The pull request a single commit message records, if any.
 *
 * A squash merge ends its subject with "(#123)"; a merge commit's subject is
 * "Merge pull request #123 from owner/branch" with the title on the first body
 * line, falling back to the subject when the body is empty.
 * @param {string} message - Full commit message.
 * @returns {PullRequestTitle | null} The pull request, or null for a plain commit.
 */
export function prTitleFromCommit(message: string): PullRequestTitle | null {
  const [subject = '', ...body] = String(message ?? '').split('\n');
  const squash = /^(.*\S)\s+\(#(\d+)\)$/.exec(subject.trim());
  if (squash) return { number: Number(squash[2]), title: squash[1] };
  const merge = /^Merge pull request #(\d+) from \S+/.exec(subject.trim());
  if (merge) {
    const title = body.map((l) => l.trim()).find((l) => l.length > 0) ?? subject.trim();
    return { number: Number(merge[1]), title };
  }
  return null;
}

/**
 * @function firstParentChain
 * @description The commits on a branch's own line, newest first.
 *
 * GitHub's commit list for a branch includes every commit reachable from it,
 * so a merged pull request's own commits appear alongside the merge. Following
 * only the first parent from the tip keeps what landed on the branch itself --
 * one merge or squash commit per pull request -- which is `git log
 * --first-parent`. The walk stops at the first commit missing from the list,
 * which is where the fetched page ends.
 * @param {Array<{ sha: string; parents: string[] }>} commits - Commits as listed, in any order.
 * @param {string} tip - The branch head to start from.
 * @returns {string[]} Commit SHAs from the tip back along first parents.
 */
export function firstParentChain(commits: Array<{ sha: string; parents: string[] }>, tip: string): string[] {
  const bySha = new Map((commits ?? []).map((c) => [c.sha, c]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let at: string | undefined = tip;
  while (at && bySha.has(at) && !seen.has(at)) {
    seen.add(at);
    chain.push(at);
    at = bySha.get(at)?.parents?.[0];
  }
  return chain;
}

/**
 * @function versionLabel
 * @description What the version badge shows for a build.
 *
 * The release tag when the build is exactly a release; otherwise the short
 * commit, marked as dev on the dev environment so it is not mistaken for one.
 * @param {string} shortSha - Seven-character commit id.
 * @param {string | null} releaseTag - The build's release tag, if it has one.
 * @param {string} environment - 'production' or 'dev'.
 * @returns {string} The badge label.
 */
export function versionLabel(shortSha: string, releaseTag: string | null, environment: string): string {
  if (releaseTag) return releaseTag;
  return environment === 'dev' ? `dev · ${shortSha}` : shortSha;
}
