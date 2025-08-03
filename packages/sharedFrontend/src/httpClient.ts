// packages/sharedFrontend/src/httpClient.ts
import Router from 'next/router';
import { getFingerprint } from './fingerprint';

// Check if NEXT_PUBLIC_API_URL is defined
if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL environment variable is not defined. Please set this environment variable to the base URL of your API.');
}

// needs to be set to the root of the internal hosting domain for production
const API_BASE = process.env.NEXT_PUBLIC_API_URL;

// at module scope
let cachedCsrfToken: string | null = null;

// Ensure we have a valid CSRF token
async function ensureCsrfToken(): Promise<string> {
  if (cachedCsrfToken) {
    return cachedCsrfToken
  }
  const resp = await fetch(`${API_BASE}/api/csrf`, {
    credentials: 'include',
  });
  const body = await resp.json();
  let token = body.csrfToken;
  cachedCsrfToken = token;
  return token!;
}

async function apiFetch(
  path: string,
  pid: string,
  hash: string,
  opts: RequestInit = {}
): Promise<any> {
  const url = `${API_BASE}${path}`;
  const fingerprint = await getFingerprint();
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const csrfToken = await ensureCsrfToken();

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

  // Handle 204 No Content by redirecting to the root page
  if (res.status === 204) {
    Router.replace(`/?pid=${pid}&hash=${hash}`);
    return Promise.resolve({ redirected: true });
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