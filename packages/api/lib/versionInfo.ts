/**
 * @file packages/api/lib/versionInfo.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2026
 * @license MIT
 * @description GET /deploy/version: what the version badge shows for one build.
 *
 * The build knows only its own commit, which it sends. The label and history
 * come from the GitHub repository (see releaseInfo.ts), so there is no table of
 * versions to keep in step with git by hand.
 *
 * The answer is worked out here rather than in the browser because reading the
 * repository reliably needs a token, and a token reachable from the browser
 * would be handed to every user. Answers degrade rather than fail: without a
 * token, or when GitHub is unreachable, the badge still gets a label and a
 * reason saying what is missing.
 *
 * Configuration (all optional):
 *   GITHUB_TOKEN           read-only contents access to the repository
 *   VERSION_GITHUB_REPO    owner/name, default ironwheel/nextjs-dharma-connect
 *   VERSION_GITHUB_BRANCH  the branch deployments are built from, default main
 *   VERSION_ENVIRONMENT    'production' or 'dev', default production
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  branchChanges,
  commitInfo,
  releaseHistory,
  releaseTags,
  type CommitInfo,
  type MergedChange,
  type ReleaseEntry,
} from './releaseInfo';
import { versionLabel } from './releaseNotes';

const repo = () => process.env.VERSION_GITHUB_REPO || 'ironwheel/nextjs-dharma-connect';
const branch = () => process.env.VERSION_GITHUB_BRANCH || 'main';
const environment = () => (process.env.VERSION_ENVIRONMENT === 'dev' ? 'dev' : 'production');

/**
 * @function githubHeaders
 * @description GitHub API request headers, or null when no token is configured.
 *
 * Unauthenticated calls are limited per IP address, and serverless functions
 * share their addresses, so without a token the badge does not try at all.
 */
function githubHeaders(): Record<string, string> | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** What the version badge shows for one build. */
export interface VersionInfo {
  sha: string;
  shortSha: string;
  /** Release tag, else the short commit (prefixed "dev · " on dev). */
  label: string;
  releaseTag: string | null;
  environment: string;
  branch: string;
  commit: CommitInfo | null;
  /** Newest releases first; empty when the repository has no release tags. */
  releases: ReleaseEntry[];
  /** Pull requests recently merged on the branch, newest first; filled only when there are no releases. */
  changes: MergedChange[];
  /** Why something above is missing. Empty when everything resolved. */
  reason: string;
}

/**
 * @function buildVersionInfo
 * @description Everything the version badge needs for one build.
 * @param {string} sha - The build's full commit SHA.
 * @returns {Promise<VersionInfo>} The badge's data.
 */
export async function buildVersionInfo(sha: string): Promise<VersionInfo> {
  const shortSha = sha.substring(0, 7);
  const env = environment();
  const info: VersionInfo = {
    sha,
    shortSha,
    label: versionLabel(shortSha, null, env),
    releaseTag: null,
    environment: env,
    branch: branch(),
    commit: null,
    releases: [],
    changes: [],
    reason: '',
  };

  const headers = githubHeaders();
  if (!headers) {
    info.reason = 'GITHUB_TOKEN is not configured on the API';
    return info;
  }

  const problems: string[] = [];
  const note = (err: unknown) => problems.push((err as Error)?.message ?? String(err));

  const [tags, commit] = await Promise.all([
    releaseTags(repo(), headers).catch((err: unknown) => { note(err); return null; }),
    commitInfo(repo(), sha, headers).catch((err: unknown) => { note(err); return null; }),
  ]);
  info.commit = commit;

  if (tags && tags.length > 0) {
    // Only a tag naming this exact commit counts. A build is never credited to
    // a release that merely contains it.
    info.releaseTag = tags.find((t) => t.sha === sha)?.name ?? null;
    info.label = versionLabel(shortSha, info.releaseTag, env);
    info.releases = await releaseHistory(repo(), headers).catch((err: unknown) => { note(err); return []; });
  } else if (tags) {
    info.changes = await branchChanges(repo(), branch(), headers).catch((err: unknown) => { note(err); return []; });
  }

  info.reason = problems.join('; ');
  return info;
}

/**
 * @export
 * @function dispatchDeploy
 * @description Handles /api/deploy/* routes. The middleware has already checked
 * the caller's session and that its app may use the operation.
 * @param {string | undefined} action - The path segment after `deploy`.
 * @param {NextApiRequest} req - The request.
 * @param {NextApiResponse} res - The response.
 */
export async function dispatchDeploy(action: string | undefined, req: NextApiRequest, res: NextApiResponse) {
  if (action !== 'version') {
    return res.status(404).json({ error: `Unknown deploy action: ${action}` });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const sha = String(req.query.sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    return res.status(400).json({ error: 'sha must be a full 40-character commit id' });
  }
  return res.status(200).json(await buildVersionInfo(sha));
}
