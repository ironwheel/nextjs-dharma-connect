/**
 * @file packages/api/lib/releaseInfo.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2026
 * @license MIT
 * @description Release history, recent changes and commit details from GitHub,
 * for the version badge.
 *
 * Nothing is stored: everything is read from the repository, so there is no
 * table to keep in step with git.
 *
 * Releases are release-* annotated tags, if the repository has any. Each one's
 * notes are its tag annotation (who promoted it and why) plus the pull requests
 * that landed since the release before it. A repository with no release tags
 * instead gets its recent changes: the pull requests merged on the tracked
 * branch, read from its first-parent line.
 *
 * Caching follows what can change. The tag list and the branch's recent
 * changes are re-read every five minutes; a tag's annotation, the commits
 * between two tags and a commit's details never change, so those are kept for
 * the life of the API instance.
 */

import {
  compareReleaseTags,
  firstParentChain,
  isReleaseTag,
  parseTagMessage,
  prTitleFromCommit,
  prTitlesFromCommits,
  type PullRequestTitle,
} from './releaseNotes';

export interface ReleaseEntry {
  tag: string;
  sha: string;
  shortSha: string;
  /** When the tag was made, ISO 8601; empty if unknown. */
  date: string;
  promotedBy: string;
  reason: string;
  /** The release before this one, or null for the oldest listed. */
  previousTag: string | null;
  /** GitHub's comparison of this release against the previous one. */
  compareUrl: string | null;
  pullRequests: Array<PullRequestTitle & { url: string }>;
}

/** A pull request as it landed on the tracked branch. */
export interface MergedChange extends PullRequestTitle {
  url: string;
  /** The merge or squash commit on the branch. */
  sha: string;
  shortSha: string;
  /** When it landed on the branch, ISO 8601; empty if unknown. */
  date: string;
}

export interface CommitInfo {
  subject: string;
  date: string;
  url: string;
}

type Headers = Record<string, string>;
type TagRef = { name: string; sha: string };

/** Releases listed in the badge's history. Older ones stay reachable on GitHub. */
export const RELEASE_HISTORY_LIMIT = 20;
/** Merged pull requests listed when there are no releases. */
export const CHANGE_HISTORY_LIMIT = 30;
const LIST_TTL_MS = 5 * 60 * 1000;

let tagListCache: { at: number; repo: string; tags: TagRef[] } | null = null;
let historyCache: { at: number; repo: string; releases: ReleaseEntry[] } | null = null;
let changesCache: { at: number; key: string; changes: MergedChange[] } | null = null;
const tagCache = new Map<string, { date: string; message: string }>();
const prCache = new Map<string, Array<PullRequestTitle & { url: string }>>();
const commitCache = new Map<string, CommitInfo | null>();

async function github<T>(url: string, headers: Headers): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status} for ${url.replace('https://api.github.com', '')}`);
  return (await res.json()) as T;
}

/**
 * @function releaseTags
 * @description The repository's release-* tags, newest first, each with its commit.
 *
 * The tags endpoint resolves an annotated tag to the commit it names, which the
 * refs endpoint does not; a tag object's own SHA would match no build.
 */
export async function releaseTags(repo: string, headers: Headers): Promise<TagRef[]> {
  if (tagListCache && tagListCache.repo === repo && Date.now() - tagListCache.at < LIST_TTL_MS) {
    return tagListCache.tags;
  }
  const body = await github<Array<{ name?: string; commit?: { sha?: string } }>>(
    `https://api.github.com/repos/${repo}/tags?per_page=100`, headers);
  const tags = body
    .filter((t) => !!t?.name && !!t.commit?.sha && isReleaseTag(t.name))
    .map((t) => ({ name: t.name as string, sha: t.commit?.sha as string }))
    .sort((a, b) => compareReleaseTags(a.name, b.name));
  tagListCache = { at: Date.now(), repo, tags };
  return tags;
}

/**
 * @function tagDetails
 * @description A release tag's date and annotation.
 *
 * A promote workflow writes annotated tags, whose date and message live on the
 * tag object; a lightweight tag has neither, so its commit date stands in.
 */
async function tagDetails(repo: string, tag: string, commitSha: string, headers: Headers) {
  const key = `${repo}@${tag}`;
  const hit = tagCache.get(key);
  if (hit) return hit;

  const ref = await github<{ object?: { type?: string; sha?: string } }>(
    `https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, headers);
  let details: { date: string; message: string };
  if (ref.object?.type === 'tag' && ref.object.sha) {
    const obj = await github<{ message?: string; tagger?: { date?: string } }>(
      `https://api.github.com/repos/${repo}/git/tags/${ref.object.sha}`, headers);
    details = { date: obj.tagger?.date ?? '', message: obj.message ?? '' };
  } else {
    details = { date: (await commitInfo(repo, commitSha, headers))?.date ?? '', message: '' };
  }
  tagCache.set(key, details);
  return details;
}

/**
 * @function pullRequestsBetween
 * @description Pull requests that landed after one release and by the next.
 */
async function pullRequestsBetween(repo: string, from: string, to: string, headers: Headers): Promise<Array<PullRequestTitle & { url: string }>> {
  const key = `${repo}@${from}...${to}`;
  const hit = prCache.get(key);
  if (hit) return hit;

  // Compare lists commits oldest first and returns at most 250, far more than
  // one promotion carries. Newest first reads better in the badge.
  const body = await github<{ commits?: Array<{ commit?: { message?: string } }> }>(
    `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}?per_page=250`,
    headers);
  const prs = prTitlesFromCommits((body.commits ?? []).map((c) => c.commit?.message ?? ''))
    .reverse()
    .map((pr) => ({ ...pr, url: `https://github.com/${repo}/pull/${pr.number}` }));
  prCache.set(key, prs);
  return prs;
}

/**
 * @function commitInfo
 * @description A commit's subject, date and page, or null when GitHub does not
 * have it (a build made from an unpushed commit).
 */
export async function commitInfo(repo: string, sha: string, headers: Headers): Promise<CommitInfo | null> {
  const key = `${repo}@${sha}`;
  if (commitCache.has(key)) return commitCache.get(key) ?? null;

  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}`, { headers });
  if (res.status === 404 || res.status === 422) {
    // Not cached: the commit may be pushed later.
    return null;
  }
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status} for commit ${sha.substring(0, 7)}`);
  const body = (await res.json()) as { html_url?: string; commit?: { message?: string; committer?: { date?: string } } };
  const info: CommitInfo = {
    subject: (body.commit?.message ?? '').split('\n')[0],
    date: body.commit?.committer?.date ?? '',
    url: body.html_url ?? `https://github.com/${repo}/commit/${sha}`,
  };
  commitCache.set(key, info);
  return info;
}

/**
 * @function releaseHistory
 * @description The newest releases, newest first, each with its notes.
 *
 * Throws when the tag list itself cannot be read; the caller reports that. A
 * failure fetching one release's details leaves that entry's notes empty rather
 * than losing the whole history.
 */
export async function releaseHistory(repo: string, headers: Headers): Promise<ReleaseEntry[]> {
  if (historyCache && historyCache.repo === repo && Date.now() - historyCache.at < LIST_TTL_MS) {
    return historyCache.releases;
  }

  const ordered = await releaseTags(repo, headers);

  // One more than is shown, so the oldest shown release still has a predecessor
  // to list its pull requests against.
  const window = ordered.slice(0, RELEASE_HISTORY_LIMIT + 1);
  const releases: ReleaseEntry[] = [];
  for (let i = 0; i < Math.min(window.length, RELEASE_HISTORY_LIMIT); i++) {
    const tag = window[i];
    const previous = window[i + 1]?.name ?? null;
    const entry: ReleaseEntry = {
      tag: tag.name,
      sha: tag.sha,
      shortSha: tag.sha.substring(0, 7),
      date: '',
      promotedBy: '',
      reason: '',
      previousTag: previous,
      compareUrl: previous ? `https://github.com/${repo}/compare/${previous}...${tag.name}` : null,
      pullRequests: [],
    };
    try {
      const details = await tagDetails(repo, tag.name, tag.sha, headers);
      const parsed = parseTagMessage(details.message);
      entry.date = details.date;
      entry.promotedBy = parsed.promotedBy;
      entry.reason = parsed.reason;
      if (previous) entry.pullRequests = await pullRequestsBetween(repo, previous, tag.name, headers);
    } catch (err: unknown) {
      console.warn(`[release] could not read details for ${tag.name}:`, (err as Error)?.message ?? err);
    }
    releases.push(entry);
  }

  historyCache = { at: Date.now(), repo, releases };
  return releases;
}

/**
 * @function branchChanges
 * @description The pull requests most recently merged on a branch, newest first.
 *
 * Used when the repository has no release tags. One page of the branch's
 * commits is read and only its first-parent line kept, so each pull request
 * appears once, as the merge or squash commit that landed it. Commits pushed
 * straight to the branch without a pull request are skipped.
 */
export async function branchChanges(repo: string, branch: string, headers: Headers): Promise<MergedChange[]> {
  const key = `${repo}@${branch}`;
  if (changesCache && changesCache.key === key && Date.now() - changesCache.at < LIST_TTL_MS) {
    return changesCache.changes;
  }

  const commits = await github<Array<{
    sha?: string;
    parents?: Array<{ sha?: string }>;
    commit?: { message?: string; committer?: { date?: string } };
  }>>(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100`, headers);

  const listed = commits.filter((c) => !!c?.sha);
  const bySha = new Map(listed.map((c) => [c.sha as string, c]));
  // The branch head is the first commit listed.
  const chain = firstParentChain(
    listed.map((c) => ({ sha: c.sha as string, parents: (c.parents ?? []).map((p) => p.sha ?? '') })),
    listed[0]?.sha ?? '',
  );

  const changes: MergedChange[] = [];
  for (const sha of chain) {
    const c = bySha.get(sha);
    const pr = prTitleFromCommit(c?.commit?.message ?? '');
    if (!pr) continue;
    changes.push({
      ...pr,
      url: `https://github.com/${repo}/pull/${pr.number}`,
      sha,
      shortSha: sha.substring(0, 7),
      date: c?.commit?.committer?.date ?? '',
    });
    if (changes.length >= CHANGE_HISTORY_LIMIT) break;
  }

  changesCache = { at: Date.now(), key, changes };
  return changes;
}

/** For tests: forget everything cached. */
export function resetReleaseCaches(): void {
  tagListCache = null;
  historyCache = null;
  changesCache = null;
  tagCache.clear();
  prCache.clear();
  commitCache.clear();
}
