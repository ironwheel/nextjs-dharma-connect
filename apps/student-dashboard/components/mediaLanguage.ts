/**
 * Language handling shared by the video and audio players.
 *
 * Video and audio express availability the same way: an entry in the sub-event's media
 * list is a map keyed by English language name, plus a small set of reserved metadata
 * keys. A language is available iff its key is present with a usable value. Only the
 * shape of that value differs — a Vimeo id string for video, an asset object for audio.
 */

/** Keys on a media entry that are metadata, not languages. */
export const MEDIA_ENTRY_METADATA_KEYS = new Set(['title', 'password']);

/** Native-language display names, so the picker reads correctly to each student. */
export const MEDIA_LANGUAGE_LABELS: Record<string, string> = {
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

export function languageLabel(language: string): string {
    return MEDIA_LANGUAGE_LABELS[language] ?? language;
}

/**
 * List the languages present on a media entry, sorted for a stable picker order.
 * `isPresent` decides what counts as a usable value for this media type.
 */
export function getAvailableLanguages(
    entry: Record<string, unknown>,
    isPresent: (value: unknown) => boolean
): string[] {
    return Object.keys(entry)
        .filter((key) => !MEDIA_ENTRY_METADATA_KEYS.has(key))
        .filter((key) => isPresent(entry[key]))
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Choose which language to show first: the student's preference, else English, else
 * whatever exists. `usedFallback` drives the "not available in your language" note.
 */
export function resolveInitialMediaLanguage(
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
