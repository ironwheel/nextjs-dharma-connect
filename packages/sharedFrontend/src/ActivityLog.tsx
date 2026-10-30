import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Spinner, Table } from 'react-bootstrap';
import { queryTablePage } from './apiActions';

/** One activity log record; see docs/ACTIVITY_LOG.md. */
export interface ActivityItem {
    day: string;
    id: string;
    ts: string;
    type: string;
    source: string;
    studentId?: string;
    studentName?: string;
    summary: string;
    details?: Record<string, unknown>;
    searchText?: string;
}

export interface ActivityLogProps {
    pid: string;
    hash: string;
    /** Operator may see email addresses (the app's emailDisplay permission). */
    emailDisplayPermission: boolean;
    /** Section heading; defaults to "Activity". */
    title?: string;
}

const RESOURCE = 'activity-log';
const STUDENT_INDEX = 'studentId-id-index';
const PAGE_LIMIT = 200;
/** Each "load older" stops after this many new items or this many days, whichever comes first. */
const LOAD_TARGET_ITEMS = 150;
const LOAD_MAX_DAYS = 14;
const LIVE_POLL_MS = 20_000;
const MAX_ROWS_RENDERED = 500;
const EMAIL_DETAIL_KEYS = new Set(['email', 'previousEmail', 'to', 'recipient']);

const TYPE_INFO: Record<string, { label: string; color: string }> = {
    'student.created': { label: 'New student', color: '#22c55e' },
    'student.emailChanged': { label: 'Email change', color: '#f59e0b' },
    'student.updated': { label: 'Student update', color: '#3b82f6' },
    'email.sent': { label: 'Email sent', color: '#a855f7' },
    'registration.submitted': { label: 'Registration', color: '#14b8a6' },
    'student.unsubscribed': { label: 'Unsubscribed', color: '#ef4444' },
    'student.resubscribed': { label: 'Re-subscribed', color: '#22c55e' },
    'access.rcpLevel': { label: 'Access level', color: '#ec4899' },
    'auth.signIn': { label: 'Sign-in', color: '#38bdf8' },
    'auth.accessChanged': { label: 'App access', color: '#f59e0b' },
    'auth.passkeyInvited': { label: 'Passkey invite', color: '#a855f7' },
    'auth.signInLimitsChanged': { label: 'Sign-in limits', color: '#f59e0b' },
    'sync.run': { label: 'Sync run', color: '#9ca3af' },
    'sync.blocked': { label: 'Sync blocked', color: '#f97316' },
    'sync.failed': { label: 'Sync failed', color: '#ef4444' },
};

/** Pool eligibility details (e.g. on unsubscribes), labelled and marked as in the Student History modal. */
const ELIGIBILITY_LABELS: Record<string, string> = {
    'refuge': 'Refuge',
    'oath': 'Oathed',
    'psb': 'PSB Lung',
    'amitayus-lung': 'Amitayus Lung',
};
const CHECK_MARK = <span style={{ color: '#60a5fa', fontSize: '1.2em', fontWeight: 'bold' }}>✓</span>;
const X_MARK = <span style={{ color: '#ef4444', fontSize: '1.2em', fontWeight: 'bold' }}>✗</span>;

function isEligibilityMap(key: string, value: unknown): value is Record<string, boolean> {
    return key === 'eligibility' && !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Known pools in modal order (DynamoDB maps don't keep key order), then any others. */
function orderedPools(value: Record<string, boolean>): [string, boolean][] {
    const known = Object.keys(ELIGIBILITY_LABELS).filter(pool => pool in value);
    const others = Object.keys(value).filter(pool => !(pool in ELIGIBILITY_LABELS)).sort();
    return [...known, ...others].map(pool => [pool, value[pool]]);
}

function typeInfo(type: string) {
    return TYPE_INFO[type] ?? { label: type, color: '#9ca3af' };
}

function utcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function previousDay(day: string): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return utcDay(d);
}

function isRedirect(value: unknown): value is { redirected: true } {
    return !!value && typeof value === 'object' && 'redirected' in value;
}

/** Newest first, without duplicates. */
function mergeItems(existing: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
    const byId = new Map(existing.map(item => [item.id, item]));
    incoming.forEach(item => byId.set(item.id, item));
    return Array.from(byId.values()).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

function formatTime(ts: string): string {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
    });
}

function formatValue(key: string, value: unknown, showEmails: boolean): string {
    if (EMAIL_DETAIL_KEYS.has(key)) return showEmails ? String(value ?? '') : '(hidden)';
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
}

function haystack(item: ActivityItem, showEmails: boolean): string {
    const parts = [
        item.searchText ?? `${item.type} ${item.source} ${item.studentName ?? ''} ${item.studentId ?? ''} ${item.summary}`,
        typeInfo(item.type).label,
        formatTime(item.ts),
    ];
    if (showEmails && item.details) {
        Object.entries(item.details).forEach(([key, value]) => {
            if (EMAIL_DETAIL_KEYS.has(key) && typeof value === 'string') parts.push(value);
        });
    }
    return parts.join(' ').toLowerCase();
}

export const ActivityLog: React.FC<ActivityLogProps> = ({ pid, hash, emailDisplayPermission, title = 'Activity' }) => {
    const [items, setItems] = useState<ActivityItem[]>([]);
    const [cursor, setCursor] = useState<{ day: string; start: string | null }>({ day: utcDay(new Date()), start: null });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('all');
    const [live, setLive] = useState(true);
    const [lastPolled, setLastPolled] = useState<Date | null>(null);
    const [student, setStudent] = useState<{ id: string; name: string; items: ActivityItem[] } | null>(null);
    const loadingRef = useRef(false);
    const itemsRef = useRef<ActivityItem[]>([]);
    itemsRef.current = items;

    const fetchPage = useCallback(async (query: Parameters<typeof queryTablePage>[1]) => {
        const page = await queryTablePage<ActivityItem>(RESOURCE, query, pid, hash);
        if (isRedirect(page)) throw new Error('Authentication required');
        return page;
    }, [pid, hash]);

    /** Walks backwards through day partitions from the cursor until enough items are found. */
    const loadOlder = useCallback(async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        setError(null);
        try {
            let { day, start } = cursor;
            const found: ActivityItem[] = [];
            let daysScanned = 0;
            while (found.length < LOAD_TARGET_ITEMS && daysScanned < LOAD_MAX_DAYS) {
                const page = await fetchPage({ pk: day, limit: PAGE_LIMIT, start: start ?? undefined });
                found.push(...page.items);
                if (page.nextStart) {
                    start = page.nextStart;
                } else {
                    day = previousDay(day);
                    start = null;
                    daysScanned++;
                }
            }
            setItems(prev => mergeItems(prev, found));
            setCursor({ day, start });
        } catch (err: any) {
            setError(err?.message || 'Failed to load activity');
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, [cursor, fetchPage]);

    // Initial load
    useEffect(() => {
        if (!pid || !hash) return;
        loadOlder();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pid, hash]);

    /** Fetches anything newer than the newest loaded item (today, and yesterday around midnight UTC). */
    const pollNew = useCallback(async () => {
        const newest = itemsRef.current[0]?.id;
        const today = utcDay(new Date());
        const days = newest && newest.slice(0, 10) < today ? [newest.slice(0, 10), today] : [today];
        try {
            const fresh: ActivityItem[] = [];
            for (const day of days) {
                let start: string | undefined;
                do {
                    const page = await fetchPage({ pk: day, after: newest, order: 'asc', limit: PAGE_LIMIT, start });
                    fresh.push(...page.items);
                    start = page.nextStart ?? undefined;
                } while (start);
            }
            if (fresh.length) setItems(prev => mergeItems(prev, fresh));
            setLastPolled(new Date());
        } catch (err: any) {
            setError(err?.message || 'Failed to refresh activity');
        }
    }, [fetchPage]);

    useEffect(() => {
        if (!live || !pid || !hash) return;
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') pollNew();
        }, LIVE_POLL_MS);
        return () => clearInterval(timer);
    }, [live, pid, hash, pollNew]);

    const showStudent = useCallback(async (studentId: string, name: string) => {
        setStudent({ id: studentId, name, items: [] });
        setError(null);
        try {
            const page = await fetchPage({ pk: studentId, index: STUDENT_INDEX, limit: 500 });
            setStudent({ id: studentId, name, items: mergeItems([], page.items) });
        } catch (err: any) {
            setError(err?.message || 'Failed to load student activity');
        }
    }, [fetchPage]);

    const source = student ? student.items : items;
    const types = useMemo(() => Array.from(new Set(source.map(item => item.type))).sort(), [source]);
    const terms = useMemo(() => search.toLowerCase().split(/\s+/).filter(Boolean), [search]);
    const filtered = useMemo(() => source.filter(item =>
        (typeFilter === 'all' || item.type === typeFilter) &&
        (terms.length === 0 || terms.every(term => haystack(item, emailDisplayPermission).includes(term)))
    ), [source, typeFilter, terms, emailDisplayPermission]);

    const oldestLoaded = items.length ? items[items.length - 1].day : null;

    return (
        <section className="activity-section">
            <div className="section-header">
                <h3 className="section-title">{title}</h3>
                <div className="section-controls">
                    <div className="search-container">
                        <input
                            className="search-input"
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search activity..."
                            aria-label="Search activity"
                        />
                    </div>
                    <Form.Select
                        size="sm"
                        className="activity-select"
                        value={typeFilter}
                        onChange={e => setTypeFilter(e.target.value)}
                        aria-label="Filter by activity type"
                    >
                        <option value="all">All types</option>
                        {types.map(type => <option key={type} value={type}>{typeInfo(type).label}</option>)}
                    </Form.Select>
                    <Form.Check
                        type="switch"
                        id="activity-live"
                        className="activity-live"
                        label="Live"
                        checked={live}
                        onChange={e => setLive(e.target.checked)}
                    />
                </div>
            </div>

            <div className="status-bar activity-status">
                {student ? (
                    <span className="status-item">
                        {student.name}: {student.items.length} entries
                        <Button size="sm" variant="link" className="activity-clear" onClick={() => setStudent(null)}>show all</Button>
                    </span>
                ) : (
                    <span className="status-item">
                        {items.length} loaded{oldestLoaded ? ` back to ${oldestLoaded}` : ''}
                    </span>
                )}
                {(terms.length > 0 || typeFilter !== 'all') && (
                    <span className="status-item">{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>
                )}
                {live && lastPolled && !student && (
                    <span className="status-item">updated {lastPolled.toLocaleTimeString()}</span>
                )}
                {error && <span className="status-item activity-error">{error}</span>}
            </div>

            <div className="activity-table-container">
                <Table striped bordered hover size="sm" variant="dark" className="activity-table">
                    <thead>
                        <tr>
                            <th style={{ width: '170px' }}>Time</th>
                            <th style={{ width: '130px' }}>Type</th>
                            <th style={{ width: '200px' }}>Student</th>
                            <th>Activity</th>
                            <th style={{ width: '110px' }}>Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.slice(0, MAX_ROWS_RENDERED).map(item => {
                            const info = typeInfo(item.type);
                            return (
                                <tr key={item.id}>
                                    <td className="activity-time">{formatTime(item.ts)}</td>
                                    <td>
                                        <span className="activity-badge" style={{ borderColor: info.color, color: info.color }}>{info.label}</span>
                                    </td>
                                    <td>
                                        {item.studentId ? (
                                            <span
                                                className="cursor-pointer text-primary"
                                                title="Show this student's activity"
                                                onClick={() => showStudent(item.studentId!, item.studentName || item.studentId!)}
                                            >
                                                {item.studentName || item.studentId}
                                            </span>
                                        ) : <span className="text-muted">—</span>}
                                    </td>
                                    <td>
                                        <div>{item.summary}</div>
                                        {item.details && Object.keys(item.details).length > 0 && (
                                            <div className="activity-details">
                                                {Object.entries(item.details).map(([key, value]) => isEligibilityMap(key, value) ? (
                                                    orderedPools(value).map(([pool, eligible]) => (
                                                        <span key={`${key}.${pool}`} className="activity-detail">
                                                            {ELIGIBILITY_LABELS[pool] ?? pool}: {eligible === true ? CHECK_MARK : X_MARK}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span key={key} className="activity-detail">
                                                        {key}: {formatValue(key, value, emailDisplayPermission)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </td>
                                    <td className="text-muted">{item.source}</td>
                                </tr>
                            );
                        })}
                        {filtered.length === 0 && !loading && (
                            <tr>
                                <td colSpan={5} className="text-center text-muted">
                                    {source.length === 0 ? 'No activity recorded yet.' : 'No matching activity in what has been loaded.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </Table>
            </div>

            <div className="activity-footer">
                {filtered.length > MAX_ROWS_RENDERED && (
                    <span className="text-muted">Showing the newest {MAX_ROWS_RENDERED} of {filtered.length}; refine the search to see others.</span>
                )}
                {!student && (
                    <Button size="sm" variant="outline-light" disabled={loading} onClick={loadOlder}>
                        {loading ? <><Spinner animation="border" size="sm" /> Loading…</> : 'Load older activity'}
                    </Button>
                )}
            </div>
        </section>
    );
};
