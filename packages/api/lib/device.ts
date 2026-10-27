/**
 * @file packages/api/lib/device.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Server-issued device identity. Each browser gets a random device ID in an httpOnly
 *              cookie that only the API reads. Sessions, tokens and logs use a SHA-256 digest of it
 *              (the "device fingerprint"), so a stored or logged value can never be replayed as the cookie.
 */
import crypto from 'crypto';
import { serialize } from 'cookie';

export const DEVICE_COOKIE_NAME = 'did';

// Browsers cap cookie lifetime at 400 days.
const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

// 32 random bytes, base64url-encoded.
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * @function resolveDeviceId
 * @description Returns the device ID from the request cookies, or a new one if it is missing or malformed.
 * @param {Partial<Record<string, string>> | undefined} cookies - Parsed request cookies.
 * @returns {{ deviceId: string, isNew: boolean }} The device ID and whether it still needs to be set as a cookie.
 */
export function resolveDeviceId(cookies: Partial<Record<string, string>> | undefined): { deviceId: string, isNew: boolean } {
    const existing = cookies?.[DEVICE_COOKIE_NAME];
    if (existing && DEVICE_ID_PATTERN.test(existing)) {
        return { deviceId: existing, isNew: false };
    }
    return { deviceId: crypto.randomBytes(32).toString('base64url'), isNew: true };
}

/**
 * @function deviceFingerprintFor
 * @description Derives the device fingerprint used for session keys, token claims and logs.
 * @param {string} deviceId - The raw device ID from the cookie.
 * @returns {string} Hex SHA-256 digest of the device ID.
 */
export function deviceFingerprintFor(deviceId: string): string {
    return crypto.createHash('sha256').update(deviceId).digest('hex');
}

// Readable characters only: no 0/O, 1/I/L.
const BROWSER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const BROWSER_CODE_LENGTH = 4;

/**
 * @function browserCode
 * @description A short code naming a browser, shown on the login page's device-limit screen and next to each
 *              device in the admin sign-in panel so the two can be matched. Derived from the device fingerprint;
 *              not secret, and only meant to tell one participant's browsers apart.
 * @param {string} deviceFingerprint - The device fingerprint (hex).
 * @returns {string} Four readable characters, e.g. 'K7Q2'.
 */
export function browserCode(deviceFingerprint: string): string {
    let n = parseInt((deviceFingerprint || '').slice(0, 8), 16) || 0;
    let code = '';
    for (let i = 0; i < BROWSER_CODE_LENGTH; i++) {
        code += BROWSER_CODE_ALPHABET[n % BROWSER_CODE_ALPHABET.length];
        n = Math.floor(n / BROWSER_CODE_ALPHABET.length);
    }
    return code;
}

/**
 * @function deviceCookie
 * @description Serializes the device ID cookie. Same SameSite/Secure policy as the token cookie, but
 *              scoped to the API domain only since no app reads it.
 * @param {string} deviceId - The device ID to store.
 * @returns {string} The Set-Cookie header value.
 */
export function deviceCookie(deviceId: string): string {
    return serialize(DEVICE_COOKIE_NAME, deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        domain: process.env.NODE_ENV === 'production' ? process.env.API_DOMAIN : undefined,
        path: '/',
        maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    });
}

/**
 * @function appendSetCookie
 * @description Adds a Set-Cookie header without dropping cookies already set on the response (e.g. by csurf).
 * @param {{ getHeader(name: string): unknown, setHeader(name: string, value: string[]): unknown }} res - The response.
 * @param {string} cookie - The serialized cookie.
 */
export function appendSetCookie(res: { getHeader(name: string): unknown, setHeader(name: string, value: string[]): unknown }, cookie: string): void {
    const current = res.getHeader('Set-Cookie');
    const existing = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
    res.setHeader('Set-Cookie', [...existing, cookie]);
}
