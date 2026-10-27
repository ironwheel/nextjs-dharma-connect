/**
 * @file packages/sharedFrontend/src/passkeyClient.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Client calls for passkey sign-in and enrollment, and mapping of their errors to what the
 *              login page shows. See docs/passkey-auth-plan.md.
 */
import { api } from './httpClient';

/** What verificationCheck reports about this participant, device and app. */
export interface SignInOptions {
    status: 'authenticated' | 'device-limit-reached' | 'needs-verification' | 'pending-verification' | string;
    authMode?: 'email' | 'passkey-optional' | 'passkey-required';
    userVerification?: 'required' | 'preferred';
    emailSignIn?: boolean;
    hasPasskey?: boolean;
    /** Short code naming this browser, matched against the admin sign-in panel. */
    browserCode?: string;
}

/** Why a sign-in or enrollment attempt didn't work, as the login page explains it. */
export type PasskeyProblem =
    | 'cancelled'
    | 'unsupported'
    | 'already-on-device'
    | 'device-limit'
    | 'invite-used'
    | 'invite-expired'
    | 'invite-invalid'
    | 'passkey-limit'
    | 'not-enabled'
    | 'no-passkey'
    | 'verification-failed'
    | 'email-disabled'
    | 'other';

/**
 * @async
 * @function post
 * @description POSTs an auth call, retrying once when the API first hands out a sign-in flow token.
 *              Returns null when the API says the participant is already signed in (204).
 */
async function post(path: string, pid: string, hash: string, body: any): Promise<any> {
    let result = await api.post(path, pid, hash, body);
    if (result && typeof result === 'object' && result.expiredAuthFlow) {
        result = await api.post(path, pid, hash, body);
    }
    if (result && typeof result === 'object' && (result.expiredAuthFlow || result.redirected)) {
        throw new Error('AUTH_FLOW_EXPIRED');
    }
    return result;
}

/**
 * @async
 * @function checkSignIn
 * @description Asks the API what this login page should offer.
 * @returns {Promise<SignInOptions | null>} The options, or null if they couldn't be loaded.
 */
export async function checkSignIn(pid: string, hash: string): Promise<SignInOptions | null> {
    try {
        const result = await post('/api/auth/verificationCheck', pid, hash, {});
        return result && typeof result === 'object' && typeof result.status === 'string' ? result as SignInOptions : null;
    } catch (err) {
        console.warn('[passkey] verificationCheck failed:', err);
        return null;
    }
}

/**
 * @async
 * @function signInWithPasskey
 * @description Signs in with a passkey on this device (or a nearby phone, if the browser offers it).
 * @returns {Promise<'authenticated'>}
 * @throws {Error} Anything passkeyProblem can classify.
 */
export async function signInWithPasskey(pid: string, hash: string): Promise<'authenticated'> {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const started = await post('/api/auth/passkeyAuthOptions', pid, hash, {});
    if (started === null) return 'authenticated';
    const response = await startAuthentication({ optionsJSON: started.options });
    const result = await post('/api/auth/passkeyAuthVerify', pid, hash, { challengeId: started.challengeId, response });
    if (result !== null && result?.status !== 'authenticated') throw new Error('AUTH_PASSKEY_VERIFICATION_FAILED');
    return 'authenticated';
}

/**
 * @async
 * @function enrollPasskey
 * @description Creates a passkey from an invite and signs in with it on this device.
 * @returns {Promise<'authenticated'>}
 * @throws {Error} Anything passkeyProblem can classify.
 */
export async function enrollPasskey(pid: string, hash: string, invite: string): Promise<'authenticated'> {
    const { startRegistration } = await import('@simplewebauthn/browser');
    const started = await post('/api/auth/passkeyRegisterOptions', pid, hash, { invite });
    const response = await startRegistration({ optionsJSON: started.options });
    const result = await post('/api/auth/passkeyRegisterVerify', pid, hash, { invite, challengeId: started.challengeId, response });
    if (result?.status !== 'authenticated') throw new Error('AUTH_PASSKEY_VERIFICATION_FAILED');
    return 'authenticated';
}

/**
 * @async
 * @function passkeysSupported
 * @description Whether this browser can use passkeys at all.
 */
export async function passkeysSupported(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const { browserSupportsWebAuthn } = await import('@simplewebauthn/browser');
    return browserSupportsWebAuthn();
}

/**
 * @function passkeyProblem
 * @description Classifies an error from the browser or the API.
 */
export function passkeyProblem(err: unknown): PasskeyProblem {
    const e = err as { name?: string, message?: string, cause?: { name?: string } } | null;
    const name = e?.name || e?.cause?.name || '';
    const message = e?.message || '';
    if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
    if (name === 'InvalidStateError') return 'already-on-device';
    if (name === 'NotSupportedError' || name === 'SecurityError') return 'unsupported';
    const codes: [string, PasskeyProblem][] = [
        ['AUTH_DEVICE_LIMIT_REACHED', 'device-limit'],
        ['AUTH_INVITE_USED', 'invite-used'],
        ['AUTH_INVITE_EXPIRED', 'invite-expired'],
        ['AUTH_INVITE_INVALID', 'invite-invalid'],
        ['AUTH_PASSKEY_LIMIT_REACHED', 'passkey-limit'],
        ['AUTH_PASSKEYS_NOT_ENABLED', 'not-enabled'],
        ['AUTH_NO_PASSKEY', 'no-passkey'],
        ['AUTH_PASSKEY_NOT_FOUND', 'no-passkey'],
        ['AUTH_PASSKEY_VERIFICATION_FAILED', 'verification-failed'],
        ['AUTH_CHALLENGE_INVALID', 'verification-failed'],
        ['AUTH_EMAIL_SIGNIN_DISABLED', 'email-disabled'],
    ];
    const match = codes.find(([code]) => message.includes(code));
    return match ? match[1] : 'other';
}
