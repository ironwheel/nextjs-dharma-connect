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

/**
 * A link that reopens the current page in Chrome for iOS. Chrome registers googlechrome://
 * and googlechromes:// for http and https. Returns null when there is nothing sensible to
 * offer, so the caller can omit the button rather than render a dead one.
 */
export function chromeIosUrl(href?: string): string | null {
    const current = href ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (current.startsWith('https://')) return `googlechromes://${current.slice('https://'.length)}`;
    if (current.startsWith('http://')) return `googlechrome://${current.slice('http://'.length)}`;
    return null;
}
