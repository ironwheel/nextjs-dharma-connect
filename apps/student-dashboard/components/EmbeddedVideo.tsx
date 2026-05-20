import React, { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
import { promptLookup, promptLookupAIDSpecific } from 'sharedFrontend';

const VIDEO_ENTRY_METADATA_KEYS = new Set(['title', 'password']);

const VIDEO_LANGUAGE_LABELS: Record<string, string> = {
    Chinese: '中文',
    Czech: 'čeština',
    Dutch: 'Nederlands',
    English: 'English',
    French: 'Français',
    German: 'Deutsch',
    Italian: 'Italiano',
    Portuguese: 'Português',
    Russian: 'русский',
    Spanish: 'Español',
};

export function getVideoAvailableLanguages(videoEntry: Record<string, unknown>): string[] {
    return Object.keys(videoEntry)
        .filter((key) => !VIDEO_ENTRY_METADATA_KEYS.has(key))
        .filter((key) => typeof videoEntry[key] === 'string' && Boolean(videoEntry[key]))
        .sort((a, b) => a.localeCompare(b));
}

export function resolveInitialVideoLanguage(
    available: string[],
    preferred: string
): { language: string; usedFallback: boolean } {
    if (available.length === 0) {
        return { language: preferred, usedFallback: false };
    }
    if (available.includes(preferred)) {
        return { language: preferred, usedFallback: false };
    }
    if (available.includes('English')) {
        return { language: 'English', usedFallback: preferred !== 'English' };
    }
    return { language: available[0], usedFallback: true };
}

function getVideoLanguageFallbackNote(): string {
    const videoLangNote = promptLookup('videoLanguageNotAvailable');
    if (!videoLangNote.includes('-unknown')) {
        return videoLangNote;
    }
    const emailLangNote = promptLookup('emailLanguageNotAvailable');
    if (!emailLangNote.includes('-unknown')) {
        return emailLangNote.replace(/email/gi, 'video');
    }
    return 'This video is unavailable in your language. Displaying English instead.';
}

function languageLabel(language: string): string {
    return VIDEO_LANGUAGE_LABELS[language] ?? language;
}

type EmbeddedVideoProps = {
    videoKey: string;
    videoEntry: Record<string, unknown>;
    preferredLanguage: string;
    parentEventAid: string;
    parentEventAidAlias?: string;
    isVideoOpen: (videoKey: string) => boolean;
    onVideoToggle: (videoKey: string) => void;
};

export default function EmbeddedVideo({
    videoKey,
    videoEntry,
    preferredLanguage,
    parentEventAid,
    parentEventAidAlias,
    isVideoOpen,
    onVideoToggle,
}: EmbeddedVideoProps) {
    const availableLanguages = useMemo(() => getVideoAvailableLanguages(videoEntry), [videoEntry]);

    const initialSelection = useMemo(
        () => resolveInitialVideoLanguage(availableLanguages, preferredLanguage),
        [availableLanguages, preferredLanguage]
    );

    const [selectedLanguage, setSelectedLanguage] = useState(initialSelection.language);
    const [showFallbackNote, setShowFallbackNote] = useState(initialSelection.usedFallback);

    useEffect(() => {
        const next = resolveInitialVideoLanguage(availableLanguages, preferredLanguage);
        setSelectedLanguage(next.language);
        setShowFallbackNote(next.usedFallback);
    }, [availableLanguages, preferredLanguage, videoKey]);

    const embeddedLink =
        typeof videoEntry[selectedLanguage] === 'string'
            ? (videoEntry[selectedLanguage] as string)
            : undefined;

    if (!embeddedLink || availableLanguages.length === 0) {
        return null;
    }

    const videoFrame =
        '<iframe src="https://player.vimeo.com/video/videoid?h=431770e871&amp;badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=181544" width="640" height="360" frameborder="0" allowfullscreen></iframe>'.replace(
            'videoid',
            embeddedLink
        );

    const languageSelectLabel = (() => {
        const label = promptLookup('videoLanguageSelect');
        return label.includes('-unknown') ? 'Audio language' : label;
    })();

    const videoControlBubble = () => (
        <div
            className="cursor-pointer w-full max-w-2xl bg-gray-700 border border-gray-600 text-white rounded-lg p-4 mb-4 transition-all duration-200 hover:bg-gray-600 hover:shadow-lg"
            onClick={() => onVideoToggle(videoKey)}
        >
            <div className="flex items-center space-x-2">
                <FontAwesomeIcon icon={isVideoOpen(videoKey) ? faMinus : faPlus} className="text-lg" />
                <h3 className="text-lg font-semibold">
                    {isVideoOpen(videoKey) ? promptLookup('videoClose') : promptLookup('videoOpen')}
                </h3>
            </div>
        </div>
    );

    return (
        <>
            {typeof videoEntry.title === 'string' ? (
                <>
                    <br />
                    <i>
                        {promptLookupAIDSpecific(
                            parentEventAid,
                            parentEventAidAlias ?? parentEventAid,
                            videoEntry.title as string
                        )}
                    </i>
                    <br />
                </>
            ) : null}

            {!isVideoOpen(videoKey) ? (
                videoControlBubble()
            ) : (
                <>
                    {videoControlBubble()}
                    {showFallbackNote ? (
                        <p className="mb-3 text-sm text-gray-300">{getVideoLanguageFallbackNote()}</p>
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
                    <div key={selectedLanguage} dangerouslySetInnerHTML={{ __html: videoFrame }} />
                </>
            )}
        </>
    );
}
