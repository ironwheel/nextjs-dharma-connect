/**
 * Durable event recorder for diagnosing audio playback on a locked phone.
 *
 * The failure we are chasing happens at the moment iOS may be suspending the page, which
 * is the worst possible time to depend on a console: buffered output can be lost, and
 * attaching Safari's Web Inspector changes the thing being measured, because a page held
 * open for debugging is not a page iOS is free to suspend.
 *
 * So every event is written straight through to localStorage as it happens. Whatever the
 * phone does next, the record survives and can be read after unlocking, with or without a
 * Mac attached. The shape of the tail is itself the finding:
 *
 *   - a media `error` before playback stops  -> the connection was torn down
 *   - a bare `pause` with no error           -> the audio session was interrupted
 *   - the log simply ends                    -> iOS suspended the page, and no page code
 *                                               can prevent that
 *
 * Off unless switched on with ?audioDebug=1, so students never pay for it.
 */

const STORAGE_KEY = 'audioDiag.v1';
const ENABLED_KEY = 'audioDiag.enabled';
const MAX_ENTRIES = 300;

export interface DiagEntry {
    /** Milliseconds since the first entry, so the gap before a stall is obvious. */
    t: number;
    wall: string;
    event: string;
    [key: string]: unknown;
}

let enabled: boolean | null = null;
let entries: DiagEntry[] | null = null;
let origin = 0;

function readEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        if (new URLSearchParams(window.location.search).get('audioDebug') === '1') {
            window.localStorage.setItem(ENABLED_KEY, '1');
            return true;
        }
        return window.localStorage.getItem(ENABLED_KEY) === '1';
    } catch {
        return false;
    }
}

export function diagEnabled(): boolean {
    if (enabled === null) enabled = readEnabled();
    return enabled;
}

function load(): DiagEntry[] {
    if (entries) return entries;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        entries = raw ? (JSON.parse(raw) as DiagEntry[]) : [];
    } catch {
        entries = [];
    }
    if (entries.length && typeof entries[0].t === 'number') origin = 0;
    return entries;
}

/**
 * Record one event. Written through to localStorage immediately — the whole point is that
 * it survives the page being suspended or killed a moment later.
 */
export function diagRecord(event: string, data?: Record<string, unknown>): void {
    if (!diagEnabled() || typeof window === 'undefined') return;
    const list = load();
    const now = Date.now();
    if (!list.length) origin = now;
    list.push({
        t: origin ? now - origin : 0,
        wall: new Date(now).toISOString().slice(11, 23),
        event,
        vis: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        ...data,
    });
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
        // A full or unavailable store must never break playback.
    }
}

/** Snapshot of an <audio> element, attached to every media event. */
export function diagMediaState(element: HTMLAudioElement | null): Record<string, unknown> {
    if (!element) return { element: 'null' };
    return {
        at: Number(element.currentTime.toFixed(1)),
        paused: element.paused,
        ready: element.readyState,
        net: element.networkState,
        err: element.error ? element.error.code : null,
        buffered: element.buffered.length
            ? Number(element.buffered.end(element.buffered.length - 1).toFixed(1))
            : null,
    };
}

export function diagEntries(): DiagEntry[] {
    if (!diagEnabled() || typeof window === 'undefined') return [];
    return load();
}

export function diagClear(): void {
    entries = [];
    origin = 0;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // nothing to do
    }
}

export function diagAsText(): string {
    return diagEntries()
        .map((e) => {
            const { t, wall, event, ...rest } = e;
            const detail = Object.entries(rest)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ');
            return `${String(t).padStart(7)}ms ${wall} ${event.padEnd(18)} ${detail}`;
        })
        .join('\n');
}

/**
 * Media, document and window events worth recording. Deliberately includes the quiet ones
 * (`suspend`, `stalled`, `emptied`) because their presence or absence is what separates a
 * torn-down connection from a suspended page.
 */
export const DIAG_MEDIA_EVENTS = [
    'loadstart', 'loadedmetadata', 'canplay', 'canplaythrough',
    'play', 'playing', 'pause', 'ended',
    'waiting', 'stalled', 'suspend', 'abort', 'emptied', 'error',
] as const;
