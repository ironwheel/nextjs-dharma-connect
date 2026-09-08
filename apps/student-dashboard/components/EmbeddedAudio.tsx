import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMinus, faPause, faPlay, faPlus } from '@fortawesome/free-solid-svg-icons';
import { getAudioPlaybackUrl, promptLookup, promptLookupAIDSpecific } from 'sharedFrontend';
import { getAvailableLanguages, languageLabel, resolveInitialMediaLanguage } from './mediaLanguage';
import {
    DIAG_MEDIA_EVENTS,
    diagAsText,
    diagClear,
    diagEnabled,
    diagMediaState,
    diagRecord,
} from './audioDiagnostics';

// Playback speed was removed from the interface. Kept here, with the state and the
// control row below, so it can be restored without rebuilding it.
// const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Tell WebKit this page's audio is primary playback, not incidental page sound.
 *
 * Safari infers a session type when the page does not declare one, and an <audio> element
 * with no visible controls is readily inferred as "ambient" — a category iOS silences
 * when the screen locks. That matches the recorded failure exactly: a pause with no media
 * error, a fraction of a second before the page is marked hidden, with the page still
 * running afterwards. "playback" is the category for media the listener expects to
 * continue with the screen off.
 *
 * navigator.audioSession is Safari 16.4+ and absent elsewhere, which is harmless: other
 * browsers already keep this audio playing.
 */
function declarePlaybackAudioSession(): string {
    if (typeof navigator === 'undefined') return 'no-navigator';
    const session = (navigator as unknown as { audioSession?: { type?: string } }).audioSession;
    if (!session) return 'unsupported';
    try {
        session.type = 'playback';
        return session.type || 'set';
    } catch {
        return 'failed';
    }
}

/** Give up re-minting after this many consecutive media errors on one track. */
const MAX_ERROR_RETRIES = 2;

/**
 * Wait this long after a media error before acting on it. iOS drops the connection when
 * the screen locks, which surfaces as a media error, and Safari often resumes on its own
 * once the connection returns. Reacting immediately destroyed playback that would have
 * recovered by itself.
 */
const ERROR_RECOVERY_DELAY_MS = 3000;

/** Re-mint this far before the URL expires, so a scrub never lands on a dead signature. */
const REFRESH_AT_FRACTION = 0.8;

/**
 * An audio language value is an asset object written by utils/upload_event_audio.py —
 * unlike video, where it is a bare Vimeo id string.
 */
export function getAudioAvailableLanguages(audioEntry: Record<string, unknown>): string[] {
    return getAvailableLanguages(
        audioEntry,
        (value) => !!value && typeof value === 'object'
            && typeof (value as { key?: unknown }).key === 'string'
    );
}

function getAudioLanguageFallbackNote(): string {
    const audioLangNote = promptLookup('audioLanguageNotAvailable');
    if (!audioLangNote.includes('-unknown')) {
        return audioLangNote;
    }
    const videoLangNote = promptLookup('videoLanguageNotAvailable');
    if (!videoLangNote.includes('-unknown')) {
        return videoLangNote.replace(/video/gi, 'audio');
    }
    return 'This audio is unavailable in your language. Playing English instead.';
}

function formatTime(totalSeconds: number): string {
    // Zero is a real position now that this also formats elapsed time, so it renders
    // 0:00 rather than blank. Callers formatting a *duration* guard on > 0 themselves,
    // where zero still means "not known yet".
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '';
    const seconds = Math.round(totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

type EmbeddedAudioProps = {
    audioKey: string;
    audioEntry: Record<string, unknown>;
    preferredLanguage: string;
    parentEventAid: string;
    parentEventAidAlias?: string;
    subEventName: string;
    index: number;
    pid: string;
    hash: string;
    /** Shown on the iOS lock screen / Android notification via the Media Session API. */
    eventTitle?: string;
    sessionLabel?: string;
    artworkUrl?: string;
    isAudioOpen: (audioKey: string) => boolean;
    onAudioToggle: (audioKey: string) => void;
};

export default function EmbeddedAudio({
    audioKey,
    audioEntry,
    preferredLanguage,
    parentEventAid,
    parentEventAidAlias,
    subEventName,
    index,
    pid,
    hash,
    eventTitle,
    sessionLabel,
    artworkUrl,
    isAudioOpen,
    onAudioToggle,
}: EmbeddedAudioProps) {
    const availableLanguages = useMemo(() => getAudioAvailableLanguages(audioEntry), [audioEntry]);

    const initialSelection = useMemo(
        () => resolveInitialMediaLanguage(availableLanguages, preferredLanguage),
        [availableLanguages, preferredLanguage]
    );

    const [selectedLanguage, setSelectedLanguage] = useState(initialSelection.language);
    const [showFallbackNote, setShowFallbackNote] = useState(initialSelection.usedFallback);
    const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [durationSec, setDurationSec] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // const [rate, setRate] = useState(1);   // playback speed (removed from the UI)
    const [isPlaying, setIsPlaying] = useState(false);
    const [diagText, setDiagText] = useState('');
    const [currentTime, setCurrentTime] = useState(0);
    const [metadataDuration, setMetadataDuration] = useState(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const errorRetriesRef = useRef(0);
    const recoveryPendingRef = useRef(false);
    const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Mirrors playbackUrl so mintUrl can tell whether there is a working player to keep.
    const playbackUrlRef = useRef<string | null>(null);
    // Survives the src swap on re-mint, so playback resumes where the student was.
    const resumeRef = useRef<{ time: number; playing: boolean } | null>(null);

    const isOpen = isAudioOpen(audioKey);

    useEffect(() => {
        const next = resolveInitialMediaLanguage(availableLanguages, preferredLanguage);
        setSelectedLanguage(next.language);
        setShowFallbackNote(next.usedFallback);
    }, [availableLanguages, preferredLanguage, audioKey]);

    useEffect(() => {
        playbackUrlRef.current = playbackUrl;
    }, [playbackUrl]);

    // Switching language starts a different recording; do not carry the old position.
    useEffect(() => {
        setCurrentTime(0);
        setMetadataDuration(0);
        setIsPlaying(false);
        errorRetriesRef.current = 0;
    }, [selectedLanguage, audioKey]);

    /**
     * Ask the API for a playback URL. The server re-checks eligibility for this exact
     * track, so a rejection here is authoritative rather than advisory.
     */
    const mintUrl = useCallback(async (language: string, preserveposition: boolean) => {
        if (!pid || !hash) return;
        const element = audioRef.current;
        if (preserveposition && element) {
            resumeRef.current = { time: element.currentTime, playing: !element.paused };
        } else {
            resumeRef.current = null;
        }

        diagRecord('mint-start', { lang: language, preserveposition, ...diagMediaState(element) });
        setLoading(true);
        setError(null);
        try {
            const result = await getAudioPlaybackUrl(
                parentEventAid, subEventName, index, language, pid, hash);
            if (!result || 'redirected' in result) {
                return;
            }
            diagRecord('mint-ok', { expiresAt: result.expiresAt });
            setPlaybackUrl(result.url);
            setExpiresAt(result.expiresAt);
            setDurationSec(result.durationSec || 0);
        } catch (e: any) {
            console.error('[EmbeddedAudio] failed to get playback URL:', e);
            // Clearing playbackUrl unmounts the <audio> element, which stops playback and
            // ends the Now Playing session. Only do that when there is nothing playing to
            // preserve; a failed refresh must leave a working player alone.
            diagRecord('mint-failed', { kept: !!playbackUrlRef.current, message: String(e?.message || e) });
            if (playbackUrlRef.current) {
                console.warn('[EmbeddedAudio] keeping the existing URL after a failed refresh');
                return;
            }
            const notAvailable = promptLookup('audioNotAvailable');
            setError(notAvailable.includes('-unknown')
                ? 'This audio is not available.'
                : notAvailable);
            setPlaybackUrl(null);
        } finally {
            setLoading(false);
        }
    }, [parentEventAid, subEventName, index, pid, hash]);

    // Mint on open and on language change — never while collapsed, so browsing the list
    // does not mint URLs the student never uses.
    useEffect(() => {
        if (!isOpen) return;
        void mintUrl(selectedLanguage, false);
    }, [isOpen, selectedLanguage, mintUrl]);

    // Re-mint before the signature expires. A teaching can outlast the URL's lifetime, and
    // an expired signature turns every seek into a 403.
    useEffect(() => {
        if (!isOpen || !expiresAt) return;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) return;

        let cancelled = false;
        let onVisible: (() => void) | null = null;

        const refresh = () => {
            if (cancelled) return;
            // Assigning src reloads the element, which stops playback outright. Never do
            // that while the phone is locked or the tab is in the background: defer until
            // the student is looking at the page again. The old URL keeps working in the
            // meantime, since the refresh happens well before it expires.
            if (typeof document !== 'undefined' && document.hidden) {
                onVisible = () => {
                    if (document.hidden || cancelled) return;
                    document.removeEventListener('visibilitychange', onVisible!);
                    onVisible = null;
                    void mintUrl(selectedLanguage, true);
                };
                document.addEventListener('visibilitychange', onVisible);
                return;
            }
            void mintUrl(selectedLanguage, true);
        };

        const timer = setTimeout(refresh, Math.max(remaining * REFRESH_AT_FRACTION, 1000));
        return () => {
            cancelled = true;
            clearTimeout(timer);
            if (onVisible) document.removeEventListener('visibilitychange', onVisible);
        };
    }, [isOpen, expiresAt, selectedLanguage, mintUrl]);

    // Restore position after a re-mint swapped the src.
    const handleLoadedMetadata = useCallback(() => {
        const element = audioRef.current;
        const resume = resumeRef.current;
        if (!element || !resume) return;
        resumeRef.current = null;
        try {
            element.currentTime = resume.time;
            setCurrentTime(resume.time);
            // element.playbackRate = rate;   // restore speed if the control returns
            if (resume.playing) {
                // iOS rejects play() outside a user gesture. If that happens, leave the
                // player paused at the right position so one tap resumes, rather than
                // appearing to be playing while silent.
                void element.play().catch(() => setIsPlaying(false));
            }
        } catch {
            // A failed resume is not worth interrupting playback over.
        }
    }, []);

    /*
     * Recovering from a media error means assigning a new src, which reloads the element.
     * That stops playback and ends the Now Playing session, so it must never happen while
     * the screen is locked — which is exactly when iOS raises the error. On lock Safari
     * drops the connection, the element errors, and reacting to it killed the playback the
     * student was listening to. Chrome for iOS keeps its connection alive so the error
     * never fired there, which is why the fault looked browser-specific.
     *
     * An error now only schedules a check. The check runs when the page is visible, after
     * a delay, and does nothing if the element recovered on its own meanwhile.
     */
    const attemptRecovery = useCallback(() => {
        recoveryTimerRef.current = null;
        const element = audioRef.current;
        if (!element || !recoveryPendingRef.current) return;
        recoveryPendingRef.current = false;

        // Recovered without help once the connection came back.
        if (!element.error) return;

        if (errorRetriesRef.current >= MAX_ERROR_RETRIES) {
            setError(promptLookup('audioNotAvailable').includes('-unknown')
                ? 'This audio could not be played.'
                : promptLookup('audioNotAvailable'));
            return;
        }
        diagRecord('recovery-remint', { retries: errorRetriesRef.current + 1 });
        errorRetriesRef.current += 1;
        void mintUrl(selectedLanguage, true);
    }, [selectedLanguage, mintUrl]);

    const scheduleRecovery = useCallback(() => {
        if (typeof document !== 'undefined' && document.hidden) {
            diagRecord('recovery-deferred-hidden');
            return;
        }
        if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = setTimeout(attemptRecovery, ERROR_RECOVERY_DELAY_MS);
    }, [attemptRecovery]);

    const handleError = useCallback(() => {
        if (!isOpen) return;
        const element = audioRef.current;
        // Left in deliberately: if playback still stops on a locked phone, this line in
        // Safari's Web Inspector says whether the element errored at all, and with what.
        // Silence here means iOS suspended the page and no page code can prevent it.
        console.warn('[EmbeddedAudio] media error', {
            code: element?.error?.code,
            message: element?.error?.message,
            readyState: element?.readyState,
            networkState: element?.networkState,
            currentTime: element?.currentTime,
            visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        });
        // MEDIA_ERR_ABORTED is this component swapping src; nothing to recover from.
        if (element?.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
        recoveryPendingRef.current = true;
        scheduleRecovery();
    }, [isOpen, scheduleRecovery]);

    /*
     * Diagnostic recording. Attaches to the element directly rather than going through
     * React props, so it sees events React does not surface and cannot perturb playback.
     */
    useEffect(() => {
        if (!diagEnabled() || !isOpen || !playbackUrl) return;
        const element = audioRef.current;
        if (!element) return;

        diagRecord('track-loaded', {
            lang: selectedLanguage,
            audioSession: (navigator as unknown as { audioSession?: { type?: string } }).audioSession?.type ?? 'unsupported',
            mediaSession: 'mediaSession' in navigator,
            ...diagMediaState(element),
        });

        const listeners: Array<[string, EventListener]> = DIAG_MEDIA_EVENTS.map((name) => [
            name,
            () => diagRecord(name, diagMediaState(audioRef.current)),
        ]);
        for (const [name, handler] of listeners) element.addEventListener(name, handler);

        // Sampled rather than per-timeupdate: a steady heartbeat makes the exact moment
        // playback stalls obvious, without flooding the log.
        const heartbeat = setInterval(() => {
            diagRecord('heartbeat', diagMediaState(audioRef.current));
        }, 5000);

        const onVisibility = () => diagRecord('visibilitychange', diagMediaState(audioRef.current));
        const onPageHide = () => diagRecord('pagehide', diagMediaState(audioRef.current));
        const onPageShow = () => diagRecord('pageshow', diagMediaState(audioRef.current));
        const onFreeze = () => diagRecord('freeze', diagMediaState(audioRef.current));
        const onResume = () => diagRecord('resume', diagMediaState(audioRef.current));
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow);
        document.addEventListener('freeze', onFreeze);
        document.addEventListener('resume', onResume);

        return () => {
            for (const [name, handler] of listeners) element.removeEventListener(name, handler);
            clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow);
            document.removeEventListener('freeze', onFreeze);
            document.removeEventListener('resume', onResume);
        };
    }, [isOpen, playbackUrl, selectedLanguage]);

    // An error raised while the screen was locked waits here until the student is back.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const onVisibilityChange = () => {
            if (document.hidden || !recoveryPendingRef.current) return;
            scheduleRecovery();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (recoveryTimerRef.current) {
                clearTimeout(recoveryTimerRef.current);
                recoveryTimerRef.current = null;
            }
        };
    }, [scheduleRecovery]);

    const togglePlay = useCallback(() => {
        const element = audioRef.current;
        if (!element) return;
        if (element.paused) {
            // Declared inside the user gesture that starts playback, which is when Safari
            // is willing to honour it.
            const sessionType = declarePlaybackAudioSession();
            diagRecord('ui-play', { audioSession: sessionType, ...diagMediaState(element) });
            void element.play();
        } else {
            diagRecord('ui-pause', diagMediaState(element));
            element.pause();
        }
    }, []);

    const seekTo = useCallback((seconds: number) => {
        const element = audioRef.current;
        const next = Math.max(0, seconds);
        diagRecord('seek', { from: element ? Number(element.currentTime.toFixed(1)) : null, to: Number(next.toFixed(1)) });
        setCurrentTime(next);
        if (element) element.currentTime = next;
    }, []);

    const handleSeek = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        seekTo(Number(event.target.value));
    }, [seekTo]);

    // const changeRate = useCallback((nextRate: number) => {
    //     setRate(nextRate);
    //     if (audioRef.current) audioRef.current.playbackRate = nextRate;
    // }, []);

    if (availableLanguages.length === 0) {
        return null;
    }

    /*
     * Media Session is what puts a title, artwork and transport controls on the iOS lock
     * screen and in Control Center. Without it iOS has nothing to display, which is why
     * the lock screen showed no player. It also tells iOS this is a genuine Now Playing
     * session rather than incidental page audio.
     */
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
        const session = navigator.mediaSession;
        if (!isOpen || !playbackUrl) {
            session.metadata = null;
            return;
        }

        try {
            session.metadata = new MediaMetadata({
                title: [eventTitle, sessionLabel].filter(Boolean).join(' — ') || 'Teaching audio',
                artist: languageLabel(selectedLanguage),
                artwork: artworkUrl ? [{ src: artworkUrl }] : undefined,
            });
        } catch {
            // MediaMetadata is unavailable on some engines; controls still work without it.
        }

        const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
            ['play', () => {
                diagRecord('mediasession-play', diagMediaState(audioRef.current));
                void audioRef.current?.play();
            }],
            ['pause', () => {
                // If this appears immediately before a `pause` in the log, iOS asked us to
                // stop rather than stopping the element itself — a different fault with a
                // different fix.
                diagRecord('mediasession-pause', diagMediaState(audioRef.current));
                audioRef.current?.pause();
            }],
            ['seekbackward', (details) => {
                diagRecord('mediasession-seekbackward', { offset: details.seekOffset });
                const element = audioRef.current;
                if (element) seekTo(element.currentTime - (details.seekOffset || 15));
            }],
            ['seekforward', (details) => {
                diagRecord('mediasession-seekforward', { offset: details.seekOffset });
                const element = audioRef.current;
                if (element) seekTo(element.currentTime + (details.seekOffset || 30));
            }],
            ['seekto', (details) => {
                diagRecord('mediasession-seekto', { seekTime: details.seekTime });
                if (typeof details.seekTime === 'number') seekTo(details.seekTime);
            }],
        ];
        for (const [action, handler] of handlers) {
            try {
                session.setActionHandler(action, handler);
            } catch {
                // Unsupported actions simply do not appear on the lock screen.
            }
        }

        return () => {
            for (const [action] of handlers) {
                try {
                    session.setActionHandler(action, null);
                } catch {
                    // ignore
                }
            }
        };
    }, [isOpen, playbackUrl, eventTitle, sessionLabel, artworkUrl, selectedLanguage, seekTo]);

    // Keep the lock screen's play/pause state and scrubber in step with the element.
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }, [isPlaying]);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
        const session = navigator.mediaSession;
        if (typeof session.setPositionState !== 'function') return;
        const total = durationSec > 0 ? durationSec : metadataDuration;
        if (!(total > 0)) return;
        try {
            session.setPositionState({
                duration: total,
                position: Math.min(Math.max(currentTime, 0), total),
                playbackRate: 1,
            });
        } catch {
            // Position reporting is advisory; a rejected value must not break playback.
        }
    }, [currentTime, durationSec, metadataDuration]);

    // The API reports duration up front, so the scrubber is usable before the browser
    // has finished reading metadata over the network.
    const totalSec = durationSec > 0 ? durationSec : metadataDuration;
    const playedPercent = totalSec > 0 ? Math.min((currentTime / totalSec) * 100, 100) : 0;

    const labelOr = (key: string, fallback: string) => {
        const label = promptLookup(key);
        return label.includes('-unknown') ? fallback : label;
    };
    const playLabel = labelOr('audioPlay', 'Play');
    const pauseLabel = labelOr('audioPause', 'Pause');
    const scrubberLabel = labelOr('audioSeek', 'Seek within this recording');

    const languageSelectLabel = (() => {
        const label = promptLookup('audioLanguageSelect');
        if (!label.includes('-unknown')) return label;
        const videoLabel = promptLookup('videoLanguageSelect');
        return videoLabel.includes('-unknown') ? 'Audio language' : videoLabel;
    })();

    const audioControlBubble = () => (
        <div
            className="cursor-pointer w-full max-w-2xl bg-gray-700 border border-gray-600 text-white rounded-lg p-4 mb-4 transition-all duration-200 hover:bg-gray-600 hover:shadow-lg"
            onClick={() => onAudioToggle(audioKey)}
        >
            <div className="flex items-center space-x-2">
                <FontAwesomeIcon icon={isOpen ? faMinus : faPlus} className="text-lg" />
                <h3 className="text-lg font-semibold">
                    {isOpen ? promptLookup('audioClose') : promptLookup('audioOpen')}
                </h3>
                {!isOpen && durationSec > 0 ? (
                    <span className="text-sm text-gray-300">{formatTime(durationSec)}</span>
                ) : null}
            </div>
        </div>
    );

    return (
        <>
            {typeof audioEntry.title === 'string' ? (
                <>
                    <br />
                    <i>
                        {promptLookupAIDSpecific(
                            parentEventAid,
                            parentEventAidAlias ?? parentEventAid,
                            audioEntry.title as string
                        )}
                    </i>
                    <br />
                </>
            ) : null}

            {!isOpen ? (
                audioControlBubble()
            ) : (
                <>
                    {audioControlBubble()}
                    {showFallbackNote ? (
                        <p className="mb-3 text-sm text-gray-300">{getAudioLanguageFallbackNote()}</p>
                    ) : null}

                    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-200">
                        <span className="font-medium">{languageSelectLabel}:</span>
                        {availableLanguages.length > 1 ? (
                            <select
                                value={selectedLanguage}
                                onChange={(e) => {
                                    setSelectedLanguage(e.target.value);
                                    setShowFallbackNote(false);
                                }}
                                className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-white focus:border-gray-500 focus:outline-none"
                                aria-label={languageSelectLabel}
                            >
                                {availableLanguages.map((lang) => (
                                    <option key={lang} value={lang}>
                                        {languageLabel(lang)}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span>{languageLabel(selectedLanguage)}</span>
                        )}
                    </div>

                    {error ? (
                        <p className="mb-3 max-w-2xl text-sm text-red-300">{error}</p>
                    ) : null}

                    {loading && !playbackUrl ? (
                        <p className="mb-3 text-sm text-gray-300">…</p>
                    ) : null}

                    {playbackUrl ? (
                        <div className="mb-4 w-full max-w-2xl">
                            {/*
                              * The native <audio controls> UI is drawn by the browser and
                              * cannot be resized part by part: Firefox ignores the
                              * ::-webkit-media-controls-* pseudo-elements entirely and
                              * Chrome has been narrowing them. On a phone its play button
                              * and scrubber are too small to use for a six-hour teaching.
                              * So the element stays as the engine with its own UI off, and
                              * the transport below is ours — which also means there is no
                              * browser overflow menu, and so no Download item.
                              *
                              * The signed URL is still in the DOM. That is unchanged and
                              * unfixable here; entitlement is enforced at mint time.
                              */}
                            <audio
                                ref={audioRef}
                                key={selectedLanguage}
                                preload="metadata"
                                src={playbackUrl}
                                onLoadedMetadata={(e) => {
                                    const element = e.currentTarget;
                                    if (Number.isFinite(element.duration)) {
                                        setMetadataDuration(element.duration);
                                    }
                                    handleLoadedMetadata();
                                }}
                                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                onPlay={() => {
                                    errorRetriesRef.current = 0;
                                    setIsPlaying(true);
                                }}
                                onPause={() => setIsPlaying(false)}
                                onEnded={() => setIsPlaying(false)}
                                onError={handleError}
                            />

                            <div className="flex items-center gap-4 sm:gap-3">
                                <button
                                    type="button"
                                    onClick={togglePlay}
                                    aria-label={isPlaying ? pauseLabel : playLabel}
                                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-gray-500 bg-gray-700 text-white transition-colors hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 sm:h-11 sm:w-11"
                                >
                                    <FontAwesomeIcon
                                        icon={isPlaying ? faPause : faPlay}
                                        className={`text-2xl sm:text-base ${isPlaying ? '' : 'ml-1'}`}
                                    />
                                </button>

                                <div className="min-w-0 flex-1">
                                    <input
                                        type="range"
                                        className="audio-scrubber w-full"
                                        min={0}
                                        max={totalSec || 0}
                                        step={1}
                                        value={Math.min(currentTime, totalSec || 0)}
                                        onChange={handleSeek}
                                        aria-label={scrubberLabel}
                                        aria-valuetext={formatTime(currentTime)}
                                        style={{ ['--played' as string]: `${playedPercent}%` }}
                                    />
                                    <div className="mt-1 flex justify-between font-medium tabular-nums text-gray-200 text-lg sm:text-sm">
                                        <span>{formatTime(currentTime)}</span>
                                        <span>
                                            {totalSec > 0 ? `-${formatTime(Math.max(totalSec - currentTime, 0))}` : ''}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/*
                             * Range thumb and track need vendor pseudo-elements, which
                             * Tailwind cannot express. Touch targets are deliberately
                             * larger below the sm breakpoint.
                             */}
                            <style jsx>{`
                                .audio-scrubber {
                                    -webkit-appearance: none;
                                    appearance: none;
                                    width: 100%;
                                    height: 14px;
                                    background: transparent;
                                    cursor: pointer;
                                }
                                .audio-scrubber::-webkit-slider-runnable-track {
                                    height: 14px;
                                    border-radius: 9999px;
                                    background: linear-gradient(
                                        to right,
                                        #d1d5db 0%,
                                        #d1d5db var(--played),
                                        #4b5563 var(--played),
                                        #4b5563 100%
                                    );
                                }
                                .audio-scrubber::-webkit-slider-thumb {
                                    -webkit-appearance: none;
                                    appearance: none;
                                    height: 28px;
                                    width: 28px;
                                    margin-top: -7px;
                                    border-radius: 9999px;
                                    background: #ffffff;
                                    border: 1px solid #9ca3af;
                                }
                                .audio-scrubber::-moz-range-track {
                                    height: 14px;
                                    border-radius: 9999px;
                                    background: #4b5563;
                                }
                                .audio-scrubber::-moz-range-progress {
                                    height: 14px;
                                    border-radius: 9999px;
                                    background: #d1d5db;
                                }
                                .audio-scrubber::-moz-range-thumb {
                                    height: 28px;
                                    width: 28px;
                                    border-radius: 9999px;
                                    background: #ffffff;
                                    border: 1px solid #9ca3af;
                                }
                                .audio-scrubber:focus-visible::-webkit-slider-thumb {
                                    box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.6);
                                }
                                /*
                                 * One selector per rule on purpose. A comma-separated
                                 * group containing a vendor pseudo-element the browser
                                 * does not recognise is dropped in its entirety, so
                                 * grouping the -webkit- and -moz- track selectors here
                                 * silently discarded the desktop sizing in every browser.
                                 */
                                @media (min-width: 640px) {
                                    .audio-scrubber {
                                        height: 8px;
                                    }
                                    .audio-scrubber::-webkit-slider-runnable-track {
                                        height: 8px;
                                    }
                                    .audio-scrubber::-moz-range-track {
                                        height: 8px;
                                    }
                                    .audio-scrubber::-moz-range-progress {
                                        height: 8px;
                                    }
                                    .audio-scrubber::-webkit-slider-thumb {
                                        height: 18px;
                                        width: 18px;
                                        margin-top: -5px;
                                    }
                                    .audio-scrubber::-moz-range-thumb {
                                        height: 18px;
                                        width: 18px;
                                    }
                                }
                            `}</style>

                            {diagEnabled() ? (
                                <div className="mt-4 rounded-md border border-amber-700 bg-gray-900 p-3 text-xs text-gray-200">
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                        <span className="font-semibold text-amber-400">Audio diagnostics</span>
                                        <button
                                            type="button"
                                            className="rounded border border-gray-600 px-2 py-1 hover:bg-gray-700"
                                            onClick={() => setDiagText(diagAsText() || '(no events recorded)')}
                                        >
                                            Show log
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded border border-gray-600 px-2 py-1 hover:bg-gray-700"
                                            onClick={() => {
                                                const text = diagAsText();
                                                void navigator.clipboard?.writeText(text);
                                                setDiagText(text || '(no events recorded)');
                                            }}
                                        >
                                            Copy
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded border border-gray-600 px-2 py-1 hover:bg-gray-700"
                                            onClick={() => {
                                                diagClear();
                                                setDiagText('');
                                            }}
                                        >
                                            Clear
                                        </button>
                                    </div>
                                    {diagText ? (
                                        <pre className="max-h-72 overflow-auto whitespace-pre text-[10px] leading-tight">
                                            {diagText}
                                        </pre>
                                    ) : (
                                        <p className="text-gray-400">
                                            Recording. Lock the phone, wait for the audio to stop, unlock,
                                            then tap Show log.
                                        </p>
                                    )}
                                </div>
                            ) : null}

                            {/*
                             * Playback speed control, removed at request. Restore by
                             * un-commenting this together with PLAYBACK_RATES, the rate
                             * state and changeRate above.
                             *
                             * <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-200">
                             *     <span className="font-medium">
                             *         {promptLookup('audioSpeed').includes('-unknown') ? 'Speed' : promptLookup('audioSpeed')}:
                             *     </span>
                             *     {PLAYBACK_RATES.map((value) => (
                             *         <button key={value} type="button" onClick={() => changeRate(value)}
                             *             className={...}>{value}&times;</button>
                             *     ))}
                             * </div>
                             */}
                        </div>
                    ) : null}
                </>
            )}
        </>
    );
}
