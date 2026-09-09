/**
 * Browser identification, kept to the one case that actually changes what we show.
 *
 * Every browser on iOS is WebKit, so "is this WebKit" says nothing useful. What matters is
 * which *app* is hosting it: Safari pauses audio when the screen locks, while Chrome for
 * iOS keeps playing because its WKWebView host declares a background audio session of its
 * own. That difference is observed, not inferred — see the diagnostics behind
 * ?audioDebug=1 and the two-player control page.
 *
 * Arguments are injectable so this can be tested against real user-agent strings.
 */

/** Browsers on iOS that identify themselves in the user agent. Safari does not. */
const NON_SAFARI_IOS_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|Brave/i;

export interface PlatformProbe {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
}

function probe(overrides?: PlatformProbe): Required<PlatformProbe> {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    return {
        userAgent: overrides?.userAgent ?? nav?.userAgent ?? '',
        platform: overrides?.platform ?? nav?.platform ?? '',
        maxTouchPoints: overrides?.maxTouchPoints ?? nav?.maxTouchPoints ?? 0,
    };
}

export function isIosDevice(overrides?: PlatformProbe): boolean {
    const { userAgent, platform, maxTouchPoints } = probe(overrides);
    if (/iPad|iPhone|iPod/.test(userAgent)) return true;
    // iPadOS 13+ reports itself as a Mac; touch support is what separates the two.
    return platform === 'MacIntel' && maxTouchPoints > 1;
}

/**
 * True only for Safari proper on iOS.
 *
 * In-app web views (Facebook, Instagram, X) are deliberately excluded even though they
 * likely share the problem: they omit "Safari/" from the user agent, and telling someone
 * inside another app's browser to switch to Chrome is advice they cannot easily act on.
 */
export function isIosSafari(overrides?: PlatformProbe): boolean {
    if (!isIosDevice(overrides)) return false;
    const { userAgent } = probe(overrides);
    if (NON_SAFARI_IOS_BROWSERS.test(userAgent)) return false;
    return /Safari\//.test(userAgent);
}

export interface AlternateBrowser {
    name: string;
    url: string;
}

/**
 * Links that reopen the current page in an iOS browser that keeps playing audio when the
 * screen locks. Chrome, Firefox and Edge were all confirmed to keep playing on the device;
 * only Safari stops.
 *
 * Confidence in these schemes is not equal. Chrome's googlechrome:// and googlechromes://
 * are documented by Google, and Firefox's firefox://open-url comes from Firefox iOS
 * itself. Edge's microsoft-edge-https:// is widely used but poorly documented, so it is
 * the one to check on a real device; a scheme that is not registered simply does nothing
 * when tapped, which is why the notice also tells people they can switch browsers by hand.
 *
 * Returns an empty list for anything that is not http(s) — a file:// page has nothing
 * meaningful to hand over — so callers can omit the buttons rather than render dead ones.
 */
export function alternateBrowserUrls(href?: string): AlternateBrowser[] {
    const current = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    const https = current.startsWith('https://');
    if (!https && !current.startsWith('http://')) return [];
    const withoutScheme = current.replace(/^https?:\/\//, '');

    const browsers: AlternateBrowser[] = [
        { name: 'Chrome', url: `${https ? 'googlechromes' : 'googlechrome'}://${withoutScheme}` },
        { name: 'Firefox', url: `firefox://open-url?url=${encodeURIComponent(current)}` },
    ];
    // Edge only publishes the https form, so do not invent an http one for local testing.
    if (https) {
        browsers.push({ name: 'Edge', url: `microsoft-edge-https://${withoutScheme}` });
    }
    return browsers;
}
