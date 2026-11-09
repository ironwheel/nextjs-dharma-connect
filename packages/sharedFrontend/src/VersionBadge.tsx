/**
 * @file packages/sharedFrontend/src/VersionBadge.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared version badge: which build this is, and the version history.
 *
 * The build knows only its own commit (NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, mapped
 * from Vercel's VERCEL_GIT_COMMIT_SHA by each app's next.config). Everything
 * else comes from the API's GET /deploy/version, which reads it from git: the
 * label is the build's release tag when it is exactly a release and its short
 * commit otherwise, and the history is the releases, or the pull requests
 * recently merged on the tracked branch. There is no table to maintain.
 */

import React, { useEffect, useState } from 'react';
import { getDeploymentVersion, type DeployVersionInfo } from './apiActions';
import { VersionInfoPanel } from './VersionInfoModal';

export interface VersionBadgeProps {
  pid: string;
  hash: string;
  /**
   * Optional override for the current git SHA.
   * If not provided, the component uses NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.
   */
  gitShaOverride?: string;
  /**
   * Optional className to customize the badge container.
   */
  className?: string;
}

const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleString();
};

// Only NEXT_PUBLIC_ variables reach the browser. A local build has no commit.
const resolveCurrentGitSha = (): string => process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'localhost';

const isCommitSha = (sha: string): boolean => /^[0-9a-f]{40}$/i.test(sha);

const VersionBadge: React.FC<VersionBadgeProps> = ({ pid, hash, gitShaOverride, className }) => {
  const [info, setInfo] = useState<DeployVersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sha = gitShaOverride || resolveCurrentGitSha();

  useEffect(() => {
    const load = async () => {
      // 'localhost', or anything else that is not a commit, has nothing to look up.
      if (!pid || !hash || !isCommitSha(sha)) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await getDeploymentVersion(sha, pid, hash);
        if ('redirected' in result) {
          // Auth flow will be handled by sharedFrontend httpClient
          return;
        }
        setInfo(result);
      } catch (err: unknown) {
        console.error('VersionBadge: failed to load version info:', err);
        setError('Failed to load version info');
      } finally {
        setIsLoading(false);
      }
    };
    load();
    // The build's commit is fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, hash]);

  const label = !isCommitSha(sha) ? 'localhost' : info?.label || sha.substring(0, 7);
  const tooltip = [
    info?.commit ? `${info.commit.subject} (${formatDate(info.commit.date)})` : null,
    info?.reason || null,
    'Click to view version history',
  ].filter(Boolean).join('\n');

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className={className}
        style={{
          border: 'none',
          background: 'transparent',
          margin: 0,
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
        title={tooltip}
      >
        {isLoading ? 'Version Loading…' : `Version ${label}`}
      </button>

      <VersionInfoPanel
        show={isModalOpen}
        info={info}
        isLoading={isLoading}
        error={error}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};

export default VersionBadge;
