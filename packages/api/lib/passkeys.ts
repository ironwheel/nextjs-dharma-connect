/**
 * @file packages/api/lib/passkeys.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Passkey (WebAuthn) enrollment from admin invites, passkey sign-in, and admin list/revoke.
 *              See docs/passkey-auth-plan.md. Every app shares one relying party ID (the parent domain),
 *              so one passkey works in every app.
 */
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { tableGetConfig } from './tableConfig';
import { getOne, putOne, putOneWithCondition, getOneWithSort, deleteOneWithSort, queryByPartition } from './dynamoClient';
import { noteAdminAction, noteSignIn } from './activity';
import {
    SessionTrustLevel,
    assertHostAccess,
    passkeysEnabled,
    createSession,
    createToken,
    getAppActions,
    getPromptsForAid,
    findParticipantForAuth,
    lookupLocation,
    sendAuthEmail,
    authGetLink,
    getRestrictedHosts,
    isSysAdmin,
    parseAccessList,
    claimDeviceSlot,
    assertCanManageParticipant,
} from './authUtils';

const CHALLENGE_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_INVITE_DURATION_SECONDS = 72 * 60 * 60;
const DEFAULT_MAX_PASSKEYS = 1;
// Keep used and expired invites around briefly for troubleshooting before DynamoDB TTL removes them.
const INVITE_RETENTION_SECONDS = 7 * 24 * 60 * 60;

type ChallengeType = 'registration' | 'authentication';

// --- Configuration ---

/**
 * @function relyingParty
 * @description The WebAuthn relying party: one ID for every app (the parent domain) and the app origins
 *              allowed to run ceremonies (CORS_ORIGIN_LIST).
 * @returns {{ rpID: string, rpName: string, origins: string[] }}
 * @throws {Error} If the relying party ID or origins can't be determined.
 */
function relyingParty(): { rpID: string, rpName: string, origins: string[] } {
    const rpID = process.env.WEBAUTHN_RP_ID
        || (process.env.NODE_ENV === 'production'
            ? (process.env.MONOREPO_PARENT_DOMAIN || '').replace(/^\./, '')
            : 'localhost');
    if (!rpID) throw new Error('AUTH_PASSKEY_CONFIG_ERROR: No relying party ID (MONOREPO_PARENT_DOMAIN)');

    let origins: string[] = [];
    try {
        origins = JSON.parse(process.env.CORS_ORIGIN_LIST || '[]');
    } catch (e) {
        throw new Error('AUTH_PASSKEY_CONFIG_ERROR: CORS_ORIGIN_LIST is not valid JSON');
    }
    if (process.env.NODE_ENV !== 'production' && origins.length === 0) origins = ['http://localhost:3000'];
    if (origins.length === 0) throw new Error('AUTH_PASSKEY_CONFIG_ERROR: CORS_ORIGIN_LIST is empty');

    return { rpID, rpName: process.env.WEBAUTHN_RP_NAME || 'Dharma Connect', origins };
}

function inviteDurationSeconds(): number {
    const configured = parseInt(process.env.PASSKEY_INVITE_DURATION || '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INVITE_DURATION_SECONDS;
}

function hashInviteToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(Buffer.from(value, 'base64url'));
}

// --- Records ---

async function listPasskeys(pid: string, oidcToken?: string): Promise<any[]> {
    const tableCfg = tableGetConfig('passkeys');
    return await queryByPartition(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN!, oidcToken);
}

/**
 * @async
 * @function maxPasskeysFor
 * @description How many passkeys a participant may register: `maxPasskeys` on their own auth record, else 1.
 */
async function maxPasskeysFor(pid: string, oidcToken?: string): Promise<number> {
    const tableCfg = tableGetConfig('auth');
    const record = await getOne(tableCfg.tableName, tableCfg.pk, pid, process.env.AUTH_ROLE_ARN!, oidcToken);
    const max = record?.maxPasskeys;
    return typeof max === 'number' && max >= 0 ? max : DEFAULT_MAX_PASSKEYS;
}

/**
 * @async
 * @function loadInvite
 * @description Finds a participant's unused, unexpired invite by its emailed token.
 * @throws {Error} AUTH_INVITE_INVALID, AUTH_INVITE_USED, AUTH_INVITE_EXPIRED
 */
async function loadInvite(token: string, pid: string, oidcToken?: string): Promise<any> {
    if (!token || typeof token !== 'string') throw new Error('AUTH_INVITE_INVALID');
    const tableCfg = tableGetConfig('passkey-invites');
    const invite = await getOne(tableCfg.tableName, tableCfg.pk, hashInviteToken(token), process.env.AUTH_ROLE_ARN!, oidcToken);
    if (!invite || invite.pid !== pid) throw new Error('AUTH_INVITE_INVALID');
    if (invite.usedAt) throw new Error('AUTH_INVITE_USED');
    if (invite.expiresAt <= Date.now()) throw new Error('AUTH_INVITE_EXPIRED');
    return invite;
}

/**
 * @async
 * @function storeChallenge
 * @description Stores a single-use ceremony challenge bound to the participant, device and host.
 * @returns {Promise<string>} The challenge ID the client sends back with its response.
 */
async function storeChallenge(type: ChallengeType, pid: string, deviceFingerprint: string, host: string, challenge: string, extra: Record<string, any>, oidcToken?: string): Promise<string> {
    const tableCfg = tableGetConfig('webauthn-challenges');
    const challengeId = crypto.randomBytes(16).toString('hex');
    const createdAt = Date.now();
    await putOne(tableCfg.tableName, {
        ...extra,
        challengeId,
        type,
        pid,
        fingerprint: deviceFingerprint,
        host,
        challenge,
        createdAt,
        expiresAt: createdAt + CHALLENGE_DURATION_MS,
        ttl: Math.floor((createdAt + CHALLENGE_DURATION_MS) / 1000) + 3600,
    }, process.env.AUTH_ROLE_ARN!, oidcToken);
    return challengeId;
}

/**
 * @async
 * @function consumeChallenge
 * @description Loads a challenge and marks it used. Fails if it belongs to another participant, device,
 *              host or ceremony, has expired, or was already used.
 * @throws {Error} AUTH_CHALLENGE_INVALID
 */
async function consumeChallenge(challengeId: string, type: ChallengeType, pid: string, deviceFingerprint: string, host: string, oidcToken?: string): Promise<any> {
    if (!challengeId || typeof challengeId !== 'string') throw new Error('AUTH_CHALLENGE_INVALID');
    const tableCfg = tableGetConfig('webauthn-challenges');
    const record = await getOne(tableCfg.tableName, tableCfg.pk, challengeId, process.env.AUTH_ROLE_ARN!, oidcToken);
    if (!record || record.type !== type || record.pid !== pid || record.fingerprint !== deviceFingerprint
        || record.host !== host || record.usedAt || record.expiresAt <= Date.now()) {
        throw new Error('AUTH_CHALLENGE_INVALID');
    }
    try {
        await putOneWithCondition(tableCfg.tableName, { ...record, usedAt: Date.now() }, 'attribute_not_exists(usedAt)', undefined, process.env.AUTH_ROLE_ARN!, oidcToken);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Condition check failed')) throw new Error('AUTH_CHALLENGE_INVALID');
        throw err;
    }
    return record;
}

/**
 * @async
 * @function signInWithSession
 * @description Creates the session for a passkey sign-in and mints the app's access token.
 */
async function signInWithSession(pid: string, deviceFingerprint: string, host: string, trustLevel: SessionTrustLevel, credentialId: string, oidcToken?: string): Promise<{ status: string, accessToken: string }> {
    await createSession(pid, deviceFingerprint, trustLevel, { credentialId }, oidcToken);
    const { actions, role, profile } = await getAppActions(host, oidcToken);
    const accessToken = createToken(pid, deviceFingerprint, actions, role, host);
    noteSignIn(pid, deviceFingerprint, profile, 'passkey', role, oidcToken);
    return { status: 'authenticated', accessToken };
}

// --- Email ---

const DEFAULT_PROMPTS: Record<string, string> = {
    'passkey-inviteSubject': 'Set up your passkey',
    'passkey-inviteEmail': '<p>Dear ||name||,</p><p>You have been invited to set up a passkey. A passkey lets you sign in with Face ID, Touch ID, your fingerprint, or your device PIN instead of an emailed code.</p><p>Please open the link in the browser you use for this app. Your sign-in will work in that browser only, so if you use more than one browser, or more than one Chrome or Edge profile, copy the link into the right one.</p><p><a href="||link||">Set up your passkey</a></p><p>This link is personal and works once. It expires ||expires||. Please do not forward it.</p>',
    'passkey-addedSubject': 'A passkey was added to your account',
    'passkey-addedEmail': '<p>Dear ||name||,</p><p>A passkey was added to your account on ||time|| from ||location||.</p><p>If this was not you, please contact us right away.</p>',
};

async function authPrompts(language: string, oidcToken?: string): Promise<(key: string) => string> {
    let prompts: any[] = [];
    try {
        prompts = await getPromptsForAid('passkey', oidcToken);
    } catch (err) {
        console.warn('passkeys: prompt lookup failed, using defaults:', err);
    }
    return (key: string) => {
        const found = prompts.find((p: any) => p.prompt === key && p.language === language)
            || prompts.find((p: any) => p.prompt === key && p.language === 'English');
        return found ? found.text : DEFAULT_PROMPTS[key];
    };
}

function formatUtc(ms: number): string {
    return new Date(ms).toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
}

/**
 * @function notePasskeyAdded
 * @description Emails the participant that a passkey was added. Runs after the response is sent; failures are only logged.
 */
function notePasskeyAdded(pid: string, clientIp: string | null, oidcToken?: string): void {
    waitUntil((async () => {
        const result = await findParticipantForAuth(pid, oidcToken);
        if (!result) return;
        const { participant, auditor } = result;
        const prompt = await authPrompts(participant.writtenLangPref || 'English', oidcToken);
        const location = await lookupLocation(clientIp);
        const html = prompt('passkey-addedEmail')
            .replace(/\|\|name\|\|/g, `${participant.first} ${participant.last}`)
            .replace(/\|\|time\|\|/g, formatUtc(Date.now()))
            .replace(/\|\|location\|\|/g, location);
        await sendAuthEmail(participant, pid, auditor, prompt('passkey-addedSubject'), html);
    })().catch((err) => console.warn('notePasskeyAdded: failed:', err)));
}

// --- Admin: invites ---

/**
 * @async
 * @function passkeyInviteSend
 * @description Issues a single-use passkey enrollment invite and emails it to the participant. The link opens
 *              `linkHost`; the passkey it creates works in every app.
 * @param {string} callerPid - The admin issuing the invite.
 * @param {string} targetPid - The participant to invite.
 * @param {string} linkHost - The app the invite link opens.
 * @param {string} host - The host of the calling app.
 * @returns {Promise<{ success: boolean, expiresAt: number }>}
 * @throws {Error} AUTH_PASSKEYS_NOT_ENABLED, AUTH_RESTRICTED_HOST_SYS_ADMIN_ONLY, AUTH_PID_NOT_FOUND,
 *                 AUTH_PASSKEY_LIMIT_REACHED, or a link/permission error.
 */
export async function passkeyInviteSend(callerPid: string, targetPid: string, linkHost: string, host: string, oidcToken?: string): Promise<{ success: boolean, expiresAt: number }> {
    const entry = parseAccessList().find((e: any) => e.host === linkHost);
    if (!entry) throw new Error('UNKNOWN_HOST');
    if (!passkeysEnabled(entry)) throw new Error('AUTH_PASSKEYS_NOT_ENABLED');
    const restricted = getRestrictedHosts().includes(linkHost);
    if (restricted && !isSysAdmin(callerPid)) throw new Error('AUTH_RESTRICTED_HOST_SYS_ADMIN_ONLY');

    const result = await findParticipantForAuth(targetPid, oidcToken);
    // Auditors are managed by sys admins only; to anyone else they don't exist.
    if (!result || (result.auditor && !isSysAdmin(callerPid))) throw new Error('AUTH_PID_NOT_FOUND');
    const { participant, auditor } = result;

    const [passkeys, maxPasskeys] = await Promise.all([listPasskeys(targetPid, oidcToken), maxPasskeysFor(targetPid, oidcToken)]);
    if (passkeys.length >= maxPasskeys) throw new Error('AUTH_PASSKEY_LIMIT_REACHED');

    // Throws if the participant isn't permitted on linkHost. The invite opens the login page directly, so it
    // works even when the participant is already signed in to the app.
    const appLink = (await authGetLink(targetPid, linkHost, oidcToken)).replace(`https://${linkHost}/?`, `https://${linkHost}/login?`);

    const token = crypto.randomBytes(32).toString('base64url');
    const createdAt = Date.now();
    const expiresAt = createdAt + inviteDurationSeconds() * 1000;
    const tableCfg = tableGetConfig('passkey-invites');
    await putOne(tableCfg.tableName, {
        inviteHash: hashInviteToken(token),
        pid: targetPid,
        issuedBy: callerPid,
        linkHost,
        createdAt,
        expiresAt,
        ttl: Math.floor(expiresAt / 1000) + INVITE_RETENTION_SECONDS,
    }, process.env.AUTH_ROLE_ARN!, oidcToken);

    const prompt = await authPrompts(participant.writtenLangPref || 'English', oidcToken);
    const html = prompt('passkey-inviteEmail')
        .replace(/\|\|name\|\|/g, `${participant.first} ${participant.last}`)
        .replace(/\|\|link\|\|/g, `${appLink}&invite=${token}`)
        .replace(/\|\|expires\|\|/g, formatUtc(expiresAt));
    try {
        await sendAuthEmail(participant, targetPid, auditor, prompt('passkey-inviteSubject'), html);
    } catch (err) {
        console.error('passkeyInviteSend: failed to send invite email:', err);
        throw new Error('AUTH_INVITE_EMAIL_SEND_FAILED');
    }
    console.log(`passkeyInviteSend: invite issued for ${targetPid} by ${callerPid}, expires ${formatUtc(expiresAt)}`);
    noteAdminAction(callerPid, targetPid, host, () => ({
        type: 'auth.passkeyInvited',
        summary: 'sent a passkey invite',
        // The log is read by admins who can't see who holds a restricted app.
        details: restricted ? undefined : { app: linkHost.split('.')[0] },
    }), oidcToken);
    return { success: true, expiresAt };
}

// --- Enrollment ---

/**
 * @async
 * @function passkeyRegisterOptions
 * @description Starts enrolling a passkey from an invite. Returns the WebAuthn creation options and the challenge ID.
 * @throws {Error} AUTH_PASSKEYS_NOT_ENABLED, AUTH_INVITE_*, AUTH_PASSKEY_LIMIT_REACHED, AUTH_PID_NOT_FOUND
 */
export async function passkeyRegisterOptions(pid: string, hash: string, host: string, deviceFingerprint: string, inviteToken: string, oidcToken?: string, userAgent?: string): Promise<{ challengeId: string, options: any }> {
    const { entry, authData } = await assertHostAccess(pid, hash, host, oidcToken);
    if (!passkeysEnabled(entry)) throw new Error('AUTH_PASSKEYS_NOT_ENABLED');

    const invite = await loadInvite(inviteToken, pid, oidcToken);
    // Enrolling signs the participant in on this device, so it has to fit the device limit. The slot is
    // taken in passkeyRegisterVerify.
    if (!(await claimDeviceSlot(entry, authData, pid, host, deviceFingerprint, userAgent, oidcToken, true))) throw new Error('AUTH_DEVICE_LIMIT_REACHED');
    const [passkeys, maxPasskeys, result] = await Promise.all([
        listPasskeys(pid, oidcToken),
        maxPasskeysFor(pid, oidcToken),
        findParticipantForAuth(pid, oidcToken),
    ]);
    if (passkeys.length >= maxPasskeys) throw new Error('AUTH_PASSKEY_LIMIT_REACHED');
    if (!result) throw new Error('AUTH_PID_NOT_FOUND');
    const { participant } = result;

    const { rpID, rpName } = relyingParty();
    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new Uint8Array(Buffer.from(pid, 'utf8')),
        userName: participant.email || pid,
        userDisplayName: `${participant.first || ''} ${participant.last || ''}`.trim() || pid,
        attestationType: 'none',
        excludeCredentials: passkeys.map((p: any) => ({ id: p.credentialId, transports: p.transports })),
        authenticatorSelection: {
            residentKey: 'preferred',
            // Passkeys are used on apps that require user verification, so verify at enrollment too.
            userVerification: 'required',
        },
    });

    const challengeId = await storeChallenge('registration', pid, deviceFingerprint, host, options.challenge, { inviteHash: invite.inviteHash }, oidcToken);
    return { challengeId, options };
}

/**
 * @async
 * @function passkeyRegisterVerify
 * @description Finishes enrolling: verifies the authenticator's response, uses up the invite, stores the
 *              passkey and signs the participant in on this device.
 * @throws {Error} AUTH_PASSKEYS_NOT_ENABLED, AUTH_INVITE_*, AUTH_CHALLENGE_INVALID, AUTH_PASSKEY_VERIFICATION_FAILED,
 *                 AUTH_PASSKEY_LIMIT_REACHED
 */
export async function passkeyRegisterVerify(pid: string, hash: string, host: string, deviceFingerprint: string, challengeId: string, inviteToken: string, response: any, clientIp: string | null, oidcToken?: string, userAgent?: string): Promise<{ status: string, accessToken: string }> {
    const { entry, authData } = await assertHostAccess(pid, hash, host, oidcToken);
    if (!passkeysEnabled(entry)) throw new Error('AUTH_PASSKEYS_NOT_ENABLED');

    const invite = await loadInvite(inviteToken, pid, oidcToken);
    const challenge = await consumeChallenge(challengeId, 'registration', pid, deviceFingerprint, host, oidcToken);
    if (challenge.inviteHash !== invite.inviteHash) throw new Error('AUTH_CHALLENGE_INVALID');

    const { rpID, origins } = relyingParty();
    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            requireUserVerification: true,
        });
    } catch (err) {
        console.warn(`passkeyRegisterVerify [pid=${pid}]: verification error:`, err);
        throw new Error('AUTH_PASSKEY_VERIFICATION_FAILED');
    }
    if (!verification.verified) throw new Error('AUTH_PASSKEY_VERIFICATION_FAILED');
    const info = verification.registrationInfo;

    const [passkeys, maxPasskeys] = await Promise.all([listPasskeys(pid, oidcToken), maxPasskeysFor(pid, oidcToken)]);
    if (passkeys.length >= maxPasskeys) throw new Error('AUTH_PASSKEY_LIMIT_REACHED');
    // Checked before the invite is used up, so a refused device leaves the invite usable.
    if (!(await claimDeviceSlot(entry, authData, pid, host, deviceFingerprint, userAgent, oidcToken))) throw new Error('AUTH_DEVICE_LIMIT_REACHED');

    // Use up the invite. The condition makes this single-use even with concurrent requests.
    const invitesCfg = tableGetConfig('passkey-invites');
    try {
        await putOneWithCondition(invitesCfg.tableName, { ...invite, usedAt: Date.now(), usedHost: host }, 'attribute_not_exists(usedAt)', undefined, process.env.AUTH_ROLE_ARN!, oidcToken);
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Condition check failed')) throw new Error('AUTH_INVITE_USED');
        throw err;
    }

    const now = Date.now();
    const passkeysCfg = tableGetConfig('passkeys');
    await putOne(passkeysCfg.tableName, {
        pid,
        credentialId: info.credential.id,
        publicKey: toBase64Url(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports || [],
        aaguid: info.aaguid,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: now,
        createdHost: host,
        createdFingerprint: deviceFingerprint,
        inviteHash: invite.inviteHash,
        lastUsedAt: now,
    }, process.env.AUTH_ROLE_ARN!, oidcToken);
    console.log(`passkeyRegisterVerify [pid=${pid}]: passkey registered on ${host} (${info.credentialDeviceType}, backedUp=${info.credentialBackedUp})`);

    notePasskeyAdded(pid, clientIp, oidcToken);
    return await signInWithSession(pid, deviceFingerprint, host, info.userVerified ? 'passkey-uv' : 'passkey', info.credential.id, oidcToken);
}

// --- Sign-in ---

/**
 * @async
 * @function passkeyAuthOptions
 * @description Starts a passkey sign-in. Returns the WebAuthn request options and the challenge ID.
 * @throws {Error} AUTH_PASSKEYS_NOT_ENABLED, AUTH_NO_PASSKEY
 */
export async function passkeyAuthOptions(pid: string, hash: string, host: string, deviceFingerprint: string, oidcToken?: string): Promise<{ challengeId: string, options: any }> {
    const { entry } = await assertHostAccess(pid, hash, host, oidcToken);
    if (!passkeysEnabled(entry)) throw new Error('AUTH_PASSKEYS_NOT_ENABLED');

    const passkeys = await listPasskeys(pid, oidcToken);
    if (passkeys.length === 0) throw new Error('AUTH_NO_PASSKEY');

    const { rpID } = relyingParty();
    const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: passkeys.map((p: any) => ({ id: p.credentialId, transports: p.transports })),
        userVerification: entry.userVerification === 'required' ? 'required' : 'preferred',
    });

    const challengeId = await storeChallenge('authentication', pid, deviceFingerprint, host, options.challenge, {}, oidcToken);
    return { challengeId, options };
}

/**
 * @async
 * @function passkeyAuthVerify
 * @description Finishes a passkey sign-in and creates the session on this device. A sign-in never lowers
 *              the trust level of a still-valid session on the same device.
 * @throws {Error} AUTH_PASSKEYS_NOT_ENABLED, AUTH_CHALLENGE_INVALID, AUTH_PASSKEY_NOT_FOUND, AUTH_PASSKEY_VERIFICATION_FAILED
 */
export async function passkeyAuthVerify(pid: string, hash: string, host: string, deviceFingerprint: string, challengeId: string, response: any, oidcToken?: string, userAgent?: string): Promise<{ status: string, accessToken: string }> {
    const { entry, authData } = await assertHostAccess(pid, hash, host, oidcToken);
    if (!passkeysEnabled(entry)) throw new Error('AUTH_PASSKEYS_NOT_ENABLED');

    const challenge = await consumeChallenge(challengeId, 'authentication', pid, deviceFingerprint, host, oidcToken);

    const passkeysCfg = tableGetConfig('passkeys');
    const credentialId = typeof response?.id === 'string' ? response.id : '';
    const passkey = credentialId
        ? await getOneWithSort(passkeysCfg.tableName, passkeysCfg.pk, pid, passkeysCfg.sk, credentialId, process.env.AUTH_ROLE_ARN!, oidcToken)
        : undefined;
    if (!passkey) throw new Error('AUTH_PASSKEY_NOT_FOUND');

    const { rpID, origins } = relyingParty();
    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            credential: {
                id: passkey.credentialId,
                publicKey: fromBase64Url(passkey.publicKey),
                counter: passkey.counter || 0,
                transports: passkey.transports,
            },
            requireUserVerification: entry.userVerification === 'required',
        });
    } catch (err) {
        console.warn(`passkeyAuthVerify [pid=${pid}]: verification error:`, err);
        throw new Error('AUTH_PASSKEY_VERIFICATION_FAILED');
    }
    if (!verification.verified) throw new Error('AUTH_PASSKEY_VERIFICATION_FAILED');
    const info = verification.authenticationInfo;

    if (!(await claimDeviceSlot(entry, authData, pid, host, deviceFingerprint, userAgent, oidcToken))) throw new Error('AUTH_DEVICE_LIMIT_REACHED');

    await putOne(passkeysCfg.tableName, {
        ...passkey,
        counter: info.newCounter,
        backedUp: info.credentialBackedUp,
        lastUsedAt: Date.now(),
        lastUsedHost: host,
    }, process.env.AUTH_ROLE_ARN!, oidcToken);

    let trustLevel: SessionTrustLevel = info.userVerified ? 'passkey-uv' : 'passkey';
    if (trustLevel === 'passkey') {
        const sessionsCfg = tableGetConfig('sessions');
        const existing = await getOneWithSort(sessionsCfg.tableName, sessionsCfg.pk, pid, sessionsCfg.sk, deviceFingerprint, process.env.AUTH_ROLE_ARN!, oidcToken);
        if (existing?.trustLevel === 'passkey-uv' && existing.ttl > Math.floor(Date.now() / 1000)) trustLevel = 'passkey-uv';
    }

    return await signInWithSession(pid, deviceFingerprint, host, trustLevel, passkey.credentialId, oidcToken);
}

// --- Admin: list and revoke ---

/**
 * @async
 * @function passkeyList
 * @description Lists a participant's passkeys for admins. Public keys are never returned.
 */
export async function passkeyList(callerPid: string, targetPid: string, oidcToken?: string): Promise<any[]> {
    await assertCanManageParticipant(callerPid, targetPid, oidcToken);
    const passkeys = await listPasskeys(targetPid, oidcToken);
    return passkeys.map((p: any) => ({
        credentialId: p.credentialId,
        aaguid: p.aaguid,
        deviceType: p.deviceType,
        backedUp: p.backedUp,
        transports: p.transports,
        createdAt: p.createdAt,
        createdHost: p.createdHost,
        lastUsedAt: p.lastUsedAt,
        lastUsedHost: p.lastUsedHost,
    }));
}

/**
 * @async
 * @function passkeyRevoke
 * @description Deletes a participant's passkey and signs out every session that was opened with it.
 */
export async function passkeyRevoke(callerPid: string, targetPid: string, credentialId: string, oidcToken?: string): Promise<{ success: boolean, sessionsEnded: number }> {
    await assertCanManageParticipant(callerPid, targetPid, oidcToken);
    const passkeysCfg = tableGetConfig('passkeys');
    const passkey = await getOneWithSort(passkeysCfg.tableName, passkeysCfg.pk, targetPid, passkeysCfg.sk, credentialId, process.env.AUTH_ROLE_ARN!, oidcToken);
    if (!passkey) throw new Error('AUTH_PASSKEY_NOT_FOUND');
    await deleteOneWithSort(passkeysCfg.tableName, passkeysCfg.pk, targetPid, passkeysCfg.sk, credentialId, process.env.AUTH_ROLE_ARN!, oidcToken);

    const sessionsCfg = tableGetConfig('sessions');
    const sessions = await queryByPartition(sessionsCfg.tableName, sessionsCfg.pk, targetPid, process.env.AUTH_ROLE_ARN!, oidcToken);
    const opened = sessions.filter((s: any) => s.credentialId === credentialId);
    for (const s of opened) {
        await deleteOneWithSort(sessionsCfg.tableName, sessionsCfg.pk, targetPid, sessionsCfg.sk, s.fingerprint, process.env.AUTH_ROLE_ARN!, oidcToken);
    }
    console.log(`passkeyRevoke: passkey revoked for ${targetPid} by ${callerPid}, ${opened.length} session(s) ended`);
    return { success: true, sessionsEnded: opened.length };
}
