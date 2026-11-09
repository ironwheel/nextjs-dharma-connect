/**
 * @file packages/sharedFrontend/src/VersionInfoModal.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2026
 * @license MIT
 * @description The version history and build details shown for one commit.
 *
 * The version badge opens it for the app's own build; VersionInfoModal opens it
 * for any commit. Both read the API's GET /deploy/version, which works it all
 * out from git: the release-* tags when the repository has any, otherwise the
 * pull requests recently merged on the tracked branch.
 *
 * Built from react-bootstrap and Bootstrap utility classes, which every app
 * loads, in Bootstrap's dark colour mode.
 */

import React, { useEffect, useState } from 'react';
import Modal from 'react-bootstrap/Modal';
import {
    getDeploymentVersion,
    type DeployChange,
    type DeployVersionInfo,
} from './apiActions';

const formatDateTime = (isoDate?: string): string => {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleString();
};

const formatDay = (isoDate?: string): string => {
    if (!isoDate) return 'Date unknown';
    const d = new Date(isoDate);
    return Number.isNaN(d.getTime())
        ? isoDate
        : d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
};

/** Merged pull requests grouped by the local day they landed, keeping newest-first order. */
const groupByDay = (changes: DeployChange[]): Array<{ day: string; changes: DeployChange[] }> => {
    const groups: Array<{ day: string; changes: DeployChange[] }> = [];
    for (const change of changes) {
        const day = formatDay(change.date);
        const last = groups[groups.length - 1];
        if (last && last.day === day) last.changes.push(change);
        else groups.push({ day, changes: [change] });
    }
    return groups;
};

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

const CurrentMark: React.FC = () => (
    <span className="badge text-bg-primary ms-2 align-middle" style={{ fontSize: '0.65rem', letterSpacing: '0.05em' }}>
        CURRENT
    </span>
);

export interface VersionInfoPanelProps {
    show?: boolean;
    info: DeployVersionInfo | null;
    isLoading: boolean;
    error: string | null;
    onClose: () => void;
}

/** The modal itself, for a caller that already holds the version info. */
export const VersionInfoPanel: React.FC<VersionInfoPanelProps> = ({ show = true, info, isLoading, error, onClose }) => {
    const hasReleases = !!info && info.releases.length > 0;
    const hasChanges = !!info && info.changes.length > 0;
    const notice = error || info?.reason;

    return (
        <Modal
            show={show}
            onHide={onClose}
            centered
            scrollable
            size="lg"
            data-bs-theme="dark"
            contentClassName="text-body"
        >
            <Modal.Header closeButton>
                <div>
                    <Modal.Title as="h5" className="mb-0">Version History</Modal.Title>
                    {info && (
                        <div className="small text-body-secondary mt-1">
                            {info.environment === 'dev' ? 'Dev' : 'Production'} · tracking {info.branch}
                            {' · '}
                            {info.commit ? (
                                <a href={info.commit.url} {...external} className="font-monospace link-info">
                                    {info.shortSha}
                                </a>
                            ) : (
                                <span className="font-monospace">{info.shortSha}</span>
                            )}
                        </div>
                    )}
                </div>
            </Modal.Header>

            <Modal.Body>
                {notice && (
                    <div className="alert alert-warning py-2 small">{notice}</div>
                )}

                {/* This build, when it is not itself a release */}
                {info && !info.releaseTag && (
                    <div className="border border-primary rounded p-3 mb-3 bg-body-tertiary">
                        <div className="fw-bold">
                            {info.label}
                            <CurrentMark />
                        </div>
                        <div className="small text-body-secondary mt-1">
                            {hasReleases ? `Not a release: built from ${info.branch}` : `Built from ${info.branch}`}
                        </div>
                        {info.commit && (
                            <a href={info.commit.url} {...external} className="d-block mt-2 link-light link-underline-opacity-0 link-underline-opacity-75-hover">
                                {info.commit.subject}
                                <span className="small text-body-secondary"> · {formatDateTime(info.commit.date)}</span>
                            </a>
                        )}
                    </div>
                )}

                {isLoading ? (
                    <div className="text-center py-4 text-body-secondary">Loading version history…</div>
                ) : hasReleases ? (
                    info.releases.map((release) => {
                        const isCurrent = release.tag === info.releaseTag;
                        return (
                            <div
                                key={release.tag}
                                className={`border rounded p-3 mb-3 ${isCurrent ? 'border-primary bg-body-tertiary' : ''}`}
                            >
                                <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                                    <div>
                                        <div className="fw-bold">
                                            {release.tag}
                                            {isCurrent && <CurrentMark />}
                                        </div>
                                        <div className="small text-body-secondary mt-1">
                                            {formatDateTime(release.date)}
                                            {release.promotedBy && ` · promoted by ${release.promotedBy}`}
                                            {' · '}<span className="font-monospace">{release.shortSha}</span>
                                        </div>
                                    </div>
                                    {release.compareUrl && (
                                        <a href={release.compareUrl} {...external} className="small link-info text-nowrap">
                                            Changes
                                        </a>
                                    )}
                                </div>

                                {release.reason && (
                                    <div className="fw-medium mb-2" style={{ whiteSpace: 'pre-line' }}>
                                        {release.reason}
                                    </div>
                                )}

                                {release.pullRequests.length > 0 && (
                                    <ul className="small mb-0 ps-3">
                                        {release.pullRequests.map((pr) => (
                                            <li key={pr.number} className="mb-1">
                                                <a href={pr.url} {...external} className="link-light link-underline-opacity-0 link-underline-opacity-75-hover">
                                                    <span className="text-body-secondary">#{pr.number}</span> {pr.title}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })
                ) : hasChanges ? (
                    <>
                        <div className="small text-uppercase fw-semibold text-body-secondary mb-2" style={{ letterSpacing: '0.05em' }}>
                            Recently merged on {info.branch}
                        </div>
                        {groupByDay(info.changes).map((group) => (
                            <div key={group.day} className="mb-3">
                                <div className="small fw-semibold mb-1">{group.day}</div>
                                <ul className="small mb-0 ps-3">
                                    {group.changes.map((change) => {
                                        const isCurrent = change.sha === info.sha;
                                        return (
                                            <li key={change.number} className="mb-1">
                                                <a href={change.url} {...external} className="link-light link-underline-opacity-0 link-underline-opacity-75-hover">
                                                    <span className="text-body-secondary">#{change.number}</span> {change.title}
                                                </a>
                                                {isCurrent && <CurrentMark />}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </>
                ) : (
                    <div className="text-body-secondary">No version history available.</div>
                )}
            </Modal.Body>
        </Modal>
    );
};

export interface VersionInfoModalProps {
    pid: string;
    hash: string;
    /** The full 40-character commit to describe. */
    sha: string;
    onClose: () => void;
}

/** Loads the version info for one commit and shows it. */
export const VersionInfoModal: React.FC<VersionInfoModalProps> = ({ pid, hash, sha, onClose }) => {
    const [info, setInfo] = useState<DeployVersionInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError(null);
        getDeploymentVersion(sha, pid, hash)
            .then((result) => {
                // A redirect means the auth flow has taken over.
                if (!cancelled && !('redirected' in result)) setInfo(result);
            })
            .catch(() => {
                if (!cancelled) setError('Failed to load version info');
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [pid, hash, sha]);

    return <VersionInfoPanel info={info} isLoading={isLoading} error={error} onClose={onClose} />;
};

export default VersionInfoModal;
