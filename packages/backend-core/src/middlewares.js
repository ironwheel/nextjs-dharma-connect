/**
 * @file packages/backend-core/src/middlewares.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Middleware functions for API routes, including CORS and CSRF protection.
 */
import { serialize, parse } from 'cookie';
import { v4 as uuidv4 } from 'uuid';

export const CSRF_COOKIE_NAME_SECURE = '__Host-csrf-token';
export const CSRF_COOKIE_NAME_INSECURE = 'csrf-token';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
const MAX_AGE_CSRF_TOKEN = 60 * 60 * 24 * 1; // 1 day

/**
 * Normalizes a URL origin by removing trailing slashes.
 * @param {string | undefined} urlString - The URL string.
 * @returns {string | undefined} The normalized URL string or undefined.
 */
function normalizeOrigin(urlString) {
    if (!urlString) return undefined;
    try {
        const url = new URL(urlString);
        return `${url.protocol}//${url.host}`; // Reconstruct without path or trailing slash
    } catch (e) {
        return urlString.replace(/\/$/, ""); // Fallback for simple strings
    }
}

/**
 * CORS Middleware.
 * Sets appropriate CORS headers based on allowed origins.
 * @param {import('next').NextApiRequest} req - The request object.
 * @param {import('next').NextApiResponse} res - The response object.
 * @param {string[]} allowedOriginsFromEnv - Array of allowed origins from process.env.CORS_ALLOWED_ORIGINS.
 * @returns {boolean} True if the request is a preflight and has been handled, false otherwise.
 */
export function corsMiddleware(req, res, allowedOriginsFromEnv = []) {
    const requestOrigin = normalizeOrigin(req.headers.origin);

    const defaultAllowedOrigin = normalizeOrigin(
        process.env.NEXT_PUBLIC_VERCEL_URL
            ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL.replace(/^https?:\/\//, '')}`
            : (process.env.APP_DOMAIN_DEV || 'http://localhost:3000')
    );

    const allAllowed = [...new Set([defaultAllowedOrigin, ...allowedOriginsFromEnv.map(normalizeOrigin).filter(Boolean)])];

    let originAllowed = false;
    if (requestOrigin && allAllowed.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin); // Use original origin header value
        originAllowed = true;
    } else if (!requestOrigin && req.headers.host && allAllowed.some(allowed => allowed && new URL(allowed).host === req.headers.host)) {
        originAllowed = true;
    }

    if (requestOrigin && !originAllowed) {
        console.warn(`CORS: Origin ${req.headers.origin} (normalized: ${requestOrigin}) is not in the allowed list: ${allAllowed.join(', ')}`);
    } else if (requestOrigin && originAllowed) {
        console.log(`CORS: Origin ${req.headers.origin} allowed.`);
    }


    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `Content-Type,Authorization,${CSRF_HEADER_NAME}`);
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        console.log(`CORS: Handling OPTIONS preflight request for origin: ${req.headers.origin}`);
        res.status(204).end();
        return true;
    }
    return false;
}

/**
 * Determines the appropriate CSRF cookie name based on the request context (secure or not).
 * @param {import('next').NextApiRequest} req - The request object.
 * @returns {string} The CSRF cookie name.
 */
function getDynamicCsrfCookieName(req) {
    const isSecure = req.headers['x-forwarded-proto'] === 'https' ||
        (process.env.NODE_ENV === 'production' && !req.headers.host?.startsWith('localhost'));
    return isSecure ? CSRF_COOKIE_NAME_SECURE : CSRF_COOKIE_NAME_INSECURE;
}

/**
 * Generates a CSRF token, sets it as an HttpOnly cookie, and returns the token.
 * @param {import('next').NextApiRequest} req - The request object.
 * @param {import('next').NextApiResponse} res - The response object.
 * @returns {string} The generated CSRF token.
 */
export function setCsrfTokenCookie(req, res) {
    const csrfToken = uuidv4();
    const cookieName = getDynamicCsrfCookieName(req);
    const isSecure = cookieName === CSRF_COOKIE_NAME_SECURE;

    const cookieOptions = {
        httpOnly: true,
        secure: isSecure,
        path: '/',
        sameSite: 'Lax',
        maxAge: MAX_AGE_CSRF_TOKEN,
    };

    console.log(`Setting CSRF cookie: Name='${cookieName}', Secure=${isSecure}, Token=${csrfToken.substring(0, 6)}...`);
    res.setHeader('Set-Cookie', serialize(cookieName, csrfToken, cookieOptions));
    return csrfToken;
}

/**
 * CSRF Protection Middleware (Double Submit Cookie Pattern).
 * Verifies that the CSRF token from the header matches the token in the cookie.
 * @param {import('next').NextApiRequest} req - The request object.
 * @param {import('next').NextApiResponse} res - The response object.
 * @returns {Promise<void>} Resolves if CSRF check passes, otherwise sends a 403 response and throws an error.
 * @throws {Error} If CSRF validation fails, to halt further execution in the API route.
 */
export async function csrfMiddleware(req, res) {
    // This middleware is now only for state-changing requests.
    // Read-only GET requests or initial setup calls might not need this.
    // The decision to apply it is made in the API route handler.

    const cookies = parse(req.headers.cookie || '');
    const cookieName = getDynamicCsrfCookieName(req);
    const tokenFromCookie = cookies[cookieName];
    const tokenFromHeader = req.headers[CSRF_HEADER_NAME.toLowerCase()] || req.headers[CSRF_HEADER_NAME];

    if (!tokenFromCookie || !tokenFromHeader) {
        console.warn(`CSRF Validation Failed: Missing token. Cookie (${cookieName}) present: ${!!tokenFromCookie}, Header (${CSRF_HEADER_NAME}) present: ${!!tokenFromHeader}`);
        res.status(403).json({ data: { err: 'CSRF_TOKEN_MISSING', message: 'CSRF token missing or mismatched.' } });
        throw new Error('CSRF_TOKEN_MISSING');
    }

    if (tokenFromCookie !== tokenFromHeader) {
        console.warn('CSRF Validation Failed: Token mismatch.');
        res.status(403).json({ data: { err: 'CSRF_TOKEN_MISMATCH', message: 'CSRF token missing or mismatched.' } });
        throw new Error('CSRF_TOKEN_MISMATCH');
    }

    console.log('CSRF Validation Passed.');
}
