/**
 * @file packages/sharedFrontend/src/VersionBadge.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Shared version badge component that looks up version metadata from the `versions` DynamoDB table.
 */

import React, { useEffect, useState } from 'react';
import Modal from 'react-bootstrap/Modal';
import { getTableItemOrNull, getAllTableItems } from './apiActions';

export interface VersionRecord {
  gitSHA: string;
  versionString?: string;
  features?: string[];
  fixes?: string[];
  headline?: string;
  date?: string;
}

export interface VersionBadgeProps {
  pid: string;
  hash: string;
  /**
   * Optional override for the current git SHA.
   * If not provided, the component will use NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA or VERCEL_GIT_COMMIT_SHA.
   */
  gitShaOverride?: string;
  /**
   * Optional className to customize the badge container.
   */
  className?: string;
}

const formatDate = (isoDate?: string): string => {
  if (!isoDate) return '';
  try {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleString();
  } catch {
    return isoDate;
  }
};

const resolveCurrentGitSha = (): string => {
  // NOTE: Only NEXT_PUBLIC_ env vars are exposed to the browser in Next.js.
  const envSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || null;

  if (!envSha) {
    throw new Error(
      'VersionBadge: NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA must be defined (and exposed to the browser) for version lookup.'
    );
  }

  return envSha;
};

const VersionBadge: React.FC<VersionBadgeProps> = ({ pid, hash, gitShaOverride, className }) => {
  const [currentRecord, setCurrentRecord] = useState<VersionRecord | null>(null);
  const [allRecords, setAllRecords] = useState<VersionRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedGitSha = gitShaOverride || resolveCurrentGitSha();

  // Load the current version record based on git SHA
  useEffect(() => {
    const loadCurrent = async () => {
      if (!pid || !hash) return;
      if (!resolvedGitSha || resolvedGitSha === 'localhost') {
        setCurrentRecord(null);
        return;
      }

      setIsLoadingCurrent(true);
      setError(null);
      try {
        const record = await getTableItemOrNull('versions', resolvedGitSha, pid, hash);

        if (record && 'redirected' in record) {
          // Auth flow will be handled by sharedFrontend httpClient
          return;
        }

        if (record) {
          setCurrentRecord(record as VersionRecord);
        } else {
          setCurrentRecord(null);
        }
      } catch (err: any) {
        console.error('VersionBadge: failed to load current version record:', err);
        setError('Failed to load version info');
        setCurrentRecord(null);
      } finally {
        setIsLoadingCurrent(false);
      }
    };

    loadCurrent();
    // We intentionally exclude resolvedGitSha from deps to avoid re-fetching
    // on every render; it is stable for a given page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, hash]);

  const loadAllRecords = async () => {
    if (!pid || !hash) return;
    if (isLoadingAll || allRecords.length > 0) {
      return;
    }

    setIsLoadingAll(true);
    setError(null);
    try {
      const items = await getAllTableItems('versions', pid, hash);

      if (items && 'redirected' in items) {
        // Auth flow handled elsewhere
        return;
      }

      const castItems = (items || []) as VersionRecord[];
      const sorted = [...castItems].sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return bTime - aTime;
      });
      setAllRecords(sorted);
    } catch (err: any) {
      console.error('VersionBadge: failed to load all version records:', err);
      setError('Failed to load version history');
    } finally {
      setIsLoadingAll(false);
    }
  };

  const handleOpenModal = async () => {
    setIsModalOpen(true);
    await loadAllRecords();
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const displayLabel = (() => {
    if (resolvedGitSha === 'localhost' || !resolvedGitSha) {
      return 'localhost';
    }
    if (currentRecord?.versionString) {
      return currentRecord.versionString;
    }
    return resolvedGitSha.substring(0, 7);
  })();

  return (
    <>
      <button
        type="button"
        onClick={handleOpenModal}
        className={className}
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          display: 'inline'
        }}
        title="Click to view version history"
      >
        {isLoadingCurrent ? 'Version Loading…' : `Version ${displayLabel}`}
      </button>

      <Modal
        show={isModalOpen}
        onHide={handleCloseModal}
        centered
        size="lg"
        backdrop="static"
        dialogClassName="version-modal-dialog"
        contentClassName="bg-slate-900 text-slate-100 border border-slate-700"
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <span className="text-sm font-semibold tracking-wide text-slate-200">
              Version Notes
            </span>
          </Modal.Title>
        </Modal.Header>

        {error && (
          <div className="px-4 py-2 text-sm text-red-300 border-b border-red-500/40 bg-red-950/40">
            {error}
          </div>
        )}

        <Modal.Body>
          {isLoadingAll && allRecords.length === 0 && (
            <div className="flex items-center justify-center py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent mr-3" />
              <span className="text-sm text-slate-300">
                Loading version history…
              </span>
            </div>
          )}

          {!isLoadingAll && allRecords.length === 0 && !error && (
            <div className="text-sm text-slate-300">
              No version records found.
            </div>
          )}

          {allRecords.map((record) => {
            const isCurrent =
              currentRecord?.gitSHA &&
              record.gitSHA === currentRecord.gitSHA;

            return (
              <div
                key={record.gitSHA}
                className={`version-notes-card mb-3 rounded-md border px-4 py-3 ${
                  isCurrent
                    ? 'border-blue-400/80 bg-slate-800/80'
                    : 'border-slate-700 bg-slate-900'
                }`}
              >
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <div className="text-sm font-semibold">
                    {record.versionString || record.gitSHA.substring(0, 7)}
                    {isCurrent && (
                      <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-blue-300">
                        (Current)
                      </span>
                    )}
                  </div>
                  <div className="whitespace-nowrap text-xs text-slate-400">
                    {formatDate(record.date)}
                  </div>
                </div>

                {record.headline && (
                  <div className="mb-2 text-sm font-medium text-slate-100">
                    {record.headline}
                  </div>
                )}

                {Array.isArray(record.features) &&
                  record.features.length > 0 && (
                    <div className="mb-2">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                        Features
                      </div>
                      <ul className="m-0 list-disc pl-5 text-sm text-slate-200">
                        {record.features.map((f, idx) => (
                          <li key={idx}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                {Array.isArray(record.fixes) &&
                  record.fixes.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                        Fixes
                      </div>
                      <ul className="m-0 list-disc pl-5 text-sm text-slate-200">
                        {record.fixes.map((f, idx) => (
                          <li key={idx}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            );
          })}
        </Modal.Body>
      </Modal>
    </>
  );
};

export default VersionBadge;


