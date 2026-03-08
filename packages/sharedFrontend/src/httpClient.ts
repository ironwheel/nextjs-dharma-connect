/**
 * @file packages/sharedFrontend/src/httpClient.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Defines an HTTP client for making API requests.
 */

import Router from 'next/router';
import { getFingerprint } from './fingerprint';

// Check if NEXT_PUBLIC_API_URL is defined
if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL environment variable is not defined. Please set this environment variable to the base URL of your API.');
}

// needs to be set to the root of the internal hosting domain for production
const API_BASE = process.env.NEXT_PUBLIC_API_URL;

// at module scope: cache token and in-flight promise so concurrent callers share one CSRF fetch
let cachedCsrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

/**
 * @async
 * @function ensureCsrfToken
 * @description Ensures that a valid CSRF token is available. Deduplicates concurrent calls so only one /api/csrf request is made (avoids 403s when multiple POSTs run in parallel on first load).
 * @returns {Promise<string>} A promise that resolves to the CSRF token.
 */
async function ensureCsrfToken(): Promise<string> {
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }
  if (csrfTokenPromise) {
    return csrfTokenPromise;
  }
  csrfTokenPromise = (async () => {
    const resp = await fetch(`${API_BASE}/api/csrf`, {
      credentials: 'include',
    });
    const body = await resp.json();
    const token = body.csrfToken as string;
    cachedCsrfToken = token;
    csrfTokenPromise = null;
    return token;
  })();
  return csrfTokenPromise;
}

/**
 * @async
 * @function apiFetch
 * @description Makes an API request.
 * @param {string} path - The path to make the request to.
 * @param {string} pid - The participant ID.
 * @param {string} hash - The verification hash.
 * @param {RequestInit} opts - The options for the request.
 * @returns {Promise<any>} A promise that resolves to the response from the API.
 */
async function apiFetch(
  path: string,
  pid: string,
  hash: string,
  opts: RequestInit = {}
): Promise<any> {
  const url = `${API_BASE}${path}`;
  const fingerprint = await getFingerprint();
  let hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const csrfToken = await ensureCsrfToken();

  // In development, override hostname to strict scope tokens even on localhost
  if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_APP_HOST) {
    hostname = process.env.NEXT_PUBLIC_APP_HOST;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': fingerprint,
    'X-Host': hostname,
    'X-User-Id': pid,
    'X-Verification-Hash': hash,
    'X-CSRF-Token': csrfToken,
    ...(opts.headers as Record<string, string> || {}),
  };

  const res = await fetch(url, {
    credentials: 'include',
    headers,
    ...opts,
  });

  if (res.status === 401) {
    console.log("Front end middleware detects 401, checking for expired auth flow", res.status, res.statusText);

    // Try to parse the response to check if it's an expired auth flow
    try {
      const errorResponse = await res.json();
      console.log("401 Error Response:", errorResponse);

      // Check if this is an expired auth flow response
      if (errorResponse.status === 'expired-auth-flow') {
        console.log("Detected expired auth flow, returning special status");
        return Promise.resolve({ expiredAuthFlow: true, accessToken: errorResponse.accessToken });
      }
    } catch (parseError) {
      console.log("Failed to parse 401 response as JSON:", parseError);
    }

    // Default 401 handling - redirect to login
    Router.replace(`/login?pid=${pid}&hash=${hash}`);
    return Promise.resolve({ redirected: true });
  }
  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    let errorDetails = null;

    try {
      const errorResponse = await res.json();
      console.log("API Error Response:", errorResponse);

      // Try to extract error message from various possible response formats
      errorMessage = errorResponse.error ||
        errorResponse.message ||
        errorResponse.err ||
        errorResponse.data?.error ||
        errorResponse.data?.err ||
        `HTTP ${res.status}`;
      errorDetails = errorResponse;
    } catch (parseError) {
      console.log("Failed to parse error response as JSON:", parseError);
      // If we can't parse JSON, use the status text
      errorMessage = res.statusText || `HTTP ${res.status}`;
    }

    console.log("Throwing error:", errorMessage, "with details:", errorDetails);

    // Create a more detailed error with the original status and details
    const error = new Error(errorMessage);
    (error as any).status = res.status;
    (error as any).details = errorDetails;
    console.log("About to throw error:", error);
    throw error;
  }

  // 204 No Content is a normal success response (e.g. DELETE, delete-one); do not redirect
  if (res.status === 204) {
    return Promise.resolve(null);
  }
  const text = await res.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

export const api = {
  get: (path: string, pid: string, hash: string) => apiFetch(path, pid, hash, { method: 'GET' }),
  post: (path: string, pid: string, hash: string, body: any) => apiFetch(path, pid, hash, { method: 'POST', body: JSON.stringify(body) }),
  put: (path: string, pid: string, hash: string, body: any) => apiFetch(path, pid, hash, { method: 'PUT', body: JSON.stringify(body) }),
  del: (path: string, pid: string, hash: string) => apiFetch(path, pid, hash, { method: 'DELETE' }),
};