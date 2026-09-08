import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
import { getAudioPlaybackUrl, promptLookup, promptLookupAIDSpecific } from 'sharedFrontend';
import { getAvailableLanguages, languageLabel, resolveInitialMediaLanguage } from './mediaLanguage';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

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
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
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
    const [rate, setRate] = useState(1);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    // Survives the src swap on re-mint, so playback resumes where the student was.
    const resumeRef = useRef<{ time: number; playing: boolean } | null>(null);

    const isOpen = isAudioOpen(audioKey);

    useEffect(() => {
        const next = resolveInitialMediaLanguage(availableLanguages, preferredLanguage);
        setSelectedLanguage(next.language);
        setShowFallbackNote(next.usedFallback);
    }, [availableLanguages, preferredLanguage, audioKey]);

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

        setLoading(true);
        setError(null);
        try {
            const result = await getAudioPlaybackUrl(
                parentEventAid, subEventName, index, language, pid, hash);
            if (!result || 'redirected' in result) {
                return;
            }
            setPlaybackUrl(result.url);
            setExpiresAt(result.expiresAt);
            setDurationSec(result.durationSec || 0);
        } catch (e: any) {
            console.error('[EmbeddedAudio] failed to get playback URL:', e);
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
        const timer = setTimeout(() => {
            void mintUrl(selectedLanguage, true);
        }, Math.max(remaining * REFRESH_AT_FRACTION, 1000));
        return () => clearTimeout(timer);
    }, [isOpen, expiresAt, selectedLanguage, mintUrl]);

    // Restore position after a re-mint swapped the src.
    const handleLoadedMetadata = useCallback(() => {
        const element = audioRef.current;
        const resume = resumeRef.current;
        if (!element || !resume) return;
        resumeRef.current = null;
        try {
            element.currentTime = resume.time;
            element.playbackRate = rate;
            if (resume.playing) void element.play();
        } catch {
            // A failed resume is not worth interrupting playback over.
        }
    }, [rate]);

    // A signature that expired early (clock skew, a long pause) surfaces as a media error;
    // re-mint once and pick up where the student was rather than showing a dead player.
    const handleError = useCallback(() => {
        if (!isOpen || !expiresAt) return;
        if (Date.now() < expiresAt - 60_000) {
            setError(promptLookup('audioNotAvailable').includes('-unknown')
                ? 'This audio could not be played.'
                : promptLookup('audioNotAvailable'));
            return;
        }
        void mintUrl(selectedLanguage, true);
    }, [isOpen, expiresAt, selectedLanguage, mintUrl]);

    const changeRate = useCallback((nextRate: number) => {
        setRate(nextRate);
        if (audioRef.current) audioRef.current.playbackRate = nextRate;
    }, []);

    if (availableLanguages.length === 0) {
        return null;
    }

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
                              * controlsList drops Chrome/Edge's Download item from the
                              * media overflow menu, and noplaybackrate drops their speed
                              * control in favour of the buttons below — the native one
                              * changes playbackRate behind this component's back, which
                              * would then be reset on the next re-mint. onContextMenu
                              * suppresses Firefox's "Save Audio As".
                              *
                              * All of this is a convenience barrier, not access control:
                              * the signed URL is in the DOM and anyone willing to open
                              * devtools can fetch it until it expires. Entitlement is
                              * enforced where it can be — at mint time, server-side.
                              */}
                            <audio
                                ref={audioRef}
                                key={selectedLanguage}
                                className="w-full"
                                controls
                                controlsList="nodownload noplaybackrate"
                                preload="metadata"
                                src={playbackUrl}
                                onContextMenu={(e) => e.preventDefault()}
                                onLoadedMetadata={handleLoadedMetadata}
                                onError={handleError}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-200">
                                <span className="font-medium">
                                    {(() => {
                                        const label = promptLookup('audioSpeed');
                                        return label.includes('-unknown') ? 'Speed' : label;
                                    })()}:
                                </span>
                                {PLAYBACK_RATES.map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => changeRate(value)}
                                        className={`rounded-md border px-2 py-1 transition-colors ${value === rate
                                            ? 'border-gray-400 bg-gray-600 text-white'
                                            : 'border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
                                            }`}
                                    >
                                        {value}&times;
                                    </button>
                                ))}
                                {durationSec > 0 ? (
                                    <span className="ml-auto text-gray-400">{formatTime(durationSec)}</span>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                </>
            )}
        </>
    );
}
