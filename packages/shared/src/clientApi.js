/**
 * @file clientApi.js
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Client-side helpers for making authenticated API calls and sending auth requests.
 */
import { publicIpv4 } from 'public-ip';
import { getFingerprint } from './fingerprint';
import { CSRF_HEADER_NAME } from '@dharma/backend-core';

let csrfToken = null;

/** Clear any cached CSRF token */
export const clearCsrfToken = () => { csrfToken = null; };

/**
 * Ensures a CSRF token has been retrieved from the server. Stores the token for
 * subsequent calls.
 * @async
 * @function ensureCsrfToken
 * @returns {Promise<string|null>} The CSRF token or null if no session token.
 */
export const ensureCsrfToken = async () => {
    if (csrfToken) return csrfToken;
    const sessionToken = localStorage.getItem('token');
    if (!sessionToken) {
        console.log('No session token found, skipping CSRF token initialization');
        return null;
    }

    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getCsrfToken' })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errorMsg = `Failed to get CSRF token (${response.status}): ${errData.data?.err || response.statusText}`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }

        const result = await response.json();
        if (!result.data?.csrfToken) {
            const errorMsg = 'CSRF token not found in response from getCsrfToken.';
            console.error(errorMsg);
            throw new Error(errorMsg);
        }

        csrfToken = result.data.csrfToken;
        return csrfToken;
    } catch (error) {
        console.error('Error fetching initial CSRF token:', error);
        throw error;
    }
};

/**
 * Wrapper to POST to /api/db with CSRF token handling.
 * @async
 * @function callDbApi
 * @param {string} action - DB action name
 * @param {object} args - Payload for the action
 * @returns {Promise<object>} API response data
 */
export const callDbApi = async (action, args = {}) => {
    try {
        if (!csrfToken) {
            await ensureCsrfToken();
        }

        const headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers[CSRF_HEADER_NAME] = csrfToken;

        const response = await fetch('/api/db', {
            method: 'POST',
            headers,
            body: JSON.stringify({ action, payload: args })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (errorData.data?.err === 'CSRF_TOKEN_MISSING' || errorData.data?.err === 'CSRF_TOKEN_MISMATCH') {
                clearCsrfToken();
                return callDbApi(action, args);
            }
            throw new Error(errorData.data?.err || `API call failed with status ${response.status}`);
        }

        const result = await response.json();
        return result?.data || result;
    } catch (error) {
        console.error(`Error in callDbApi(${action}):`, error);
        throw error;
    }
};

/**
 * Sends a verification email via the auth API.
 * @async
 * @function sendConfirmationEmail
 * @param {string} pid - Participant id
 * @param {string} aid - App identifier
 * @returns {Promise<object>} API response
 */
export const sendConfirmationEmail = async (pid, aid) => {
    try {
        const ip = await publicIpv4();
        const fingerprint = await getFingerprint();
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'sendConfirmationEmail',
                pid,
                aid,
                ip,
                fingerprint,
                url: window.location.hostname
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.data?.err || `Confirmation email request failed with status ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error sending confirmation email:', error);
        throw error;
    }
};

/**
 * Verifies an access token against the auth API.
 * @async
 * @function verifyAccess
 * @param {string} pid - Participant id
 * @param {string} token - JWT token
 * @returns {Promise<object>} API response
 */
export const verifyAccess = async (pid, token) => {
    try {
        const ip = await publicIpv4();
        const fingerprint = await getFingerprint();
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'verifyAccess',
                pid,
                token,
                ip,
                fingerprint
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.data?.err || `Access verification failed with status ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error verifying access:', error);
        throw error;
    }
};
