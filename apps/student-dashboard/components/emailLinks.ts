/**
 * @file apps/student-dashboard/components/emailLinks.ts
 * @description Helpers for pulling links out of embedded email HTML.
 */

const ZOOM_URL_RE = /https?:\/\/(?:[\w-]+\.)*zoom(?:gov)?\.(?:us|com)\/[^\s"'<>)]+/gi;

// Paths that identify a meeting/webinar link, as opposed to e.g. a help or recording page
const MEETING_PATH_RE = /^\/(?:j|w|wc\/join|my|s)\//i;

/**
 * Returns the Zoom meeting link found in the email HTML, or null.
 * Prefers a link with a meeting path (/j/, /w/, /my/ ...) over any other Zoom URL.
 */
export const findZoomLinkInEmailHtml = (html: string): string | null => {
    const candidates: string[] = [];
    for (const match of Array.from(html.matchAll(ZOOM_URL_RE))) {
        // hrefs carry HTML-escaped ampersands (query strings such as ?pwd=...&from=...)
        const url = match[0].replace(/&amp;/gi, '&').replace(/[.,;]+$/, '');
        if (!candidates.includes(url)) candidates.push(url);
    }
    if (!candidates.length) return null;

    const isMeeting = (url: string) => {
        try {
            return MEETING_PATH_RE.test(new URL(url).pathname);
        } catch {
            return false;
        }
    };
    return candidates.find(isMeeting) ?? candidates[0];
};
