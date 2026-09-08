/**
 * @file packages/api/lib/audio.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Teaching audio entitlement and playback URL signing.
 *
 * Unlike video — where the dashboard decides what to display and the Vimeo embed trusts
 * that decision — every audio playback URL is authorized here, server-side, against the
 * authoritative event/student/pool records. The signature is bound to one exact object
 * key, so mutating the aid, sub-event, index or language in a minted URL invalidates it.
 */

import * as crypto from 'crypto';
import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
// Subpath import: the package root re-exports React components, which must not be pulled
// into a serverless function. Mirrors packages/api/lib/offering.ts.
import { checkEligibility } from 'sharedFrontend/eligible';
import { tableGetConfig } from './tableConfig';
import { getOne, listAll } from './dynamoClient';

/** Language keys are English language names, matching embeddedVideoList and writtenLangPref. */
const LANGUAGE_PATTERN = /^[A-Za-z]{1,32}$/;
/** aid and sub-event names as they appear as DynamoDB keys and map keys. */
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const DEFAULT_URL_TTL_SECONDS = 21600; // 6h — covers a single sitting; the client re-mints.
const POOLS_CACHE_TTL_MS = 60_000;

export interface AudioAssetMetadata {
    key: string;
    durationSec: number;
    bytes: number;
    uploadedAt?: string;
    sha256?: string;
}

export interface AudioPlaybackRequest {
    pid: string;
    aid: string;
    subEvent: string;
    index: number;
    language: string;
    appRole: string;
    oidcToken?: string;
}

export type AudioEntitlement =
    | { allowed: true; asset: AudioAssetMetadata }
    | { allowed: false; reason: AudioDenialReason };

/**
 * Denial reasons are for server-side logs only. They are never returned to the caller:
 * distinguishing "you are not eligible" from "that does not exist" would turn this
 * endpoint into an oracle for probing which events and languages exist.
 */
export type AudioDenialReason =
    | 'BAD_REQUEST'
    | 'NO_SUCH_EVENT'
    | 'NO_SUCH_STUDENT'
    | 'NO_SUCH_SUBEVENT'
    | 'SUBEVENT_NOT_RELEASED'
    | 'NOT_ELIGIBLE'
    | 'NO_SUCH_AUDIO';

// The pools table is small (~142 rows) but is a full scan, and it is the only such read on
// this path. Vercel reuses warm function instances, so a short cache removes almost all of
// them without letting a pool edit go unnoticed for long. Keyed by role so a role that
// cannot read pools never gets an answer cached by one that can.
const poolsCache = new Map<string, { items: any[]; fetchedAt: number }>();

async function loadPools(appRole: string, oidcToken?: string): Promise<any[]> {
    const now = Date.now();
    const cached = poolsCache.get(appRole);
    if (cached && now - cached.fetchedAt < POOLS_CACHE_TTL_MS) {
        return cached.items;
    }
    const cfg = tableGetConfig('pools');
    const items = await listAll(cfg.tableName, appRole, oidcToken);
    poolsCache.set(appRole, { items, fetchedAt: now });
    return items;
}

/**
 * @function isAudioAsset
 * @description Type guard for an embeddedAudioList language value.
 */
function isAudioAsset(value: any): value is AudioAssetMetadata {
    return !!value && typeof value === 'object'
        && typeof value.key === 'string' && value.key.length > 0;
}

/**
 * @function studentMayReachEvent
 * @description Whether this student can reach this event's media at all. Pure.
 *
 * Mirrors the two paths the dashboard uses in apps/student-dashboard/pages/index.tsx:
 *   1. direct — the student passes the event's own pool (index.tsx:1001), and
 *   2. showcase — some other event the student *does* pass carries a showcaseVideoList
 *      entry pointing at this {aid, subevent} (index.tsx:1042).
 * Omitting the second path would 403 legitimate showcase content.
 *
 * @param allEvents - Every event, needed only for the showcase path. Pass null to check
 *                    the direct path alone.
 */
export function studentMayReachEvent(
    event: any, subEvent: string, student: any, pools: any[], allEvents: any[] | null,
): boolean {
    if (event?.config?.pool
        && checkEligibility(event.config.pool, student, event.aid, pools, event)) {
        return true;
    }
    if (!allEvents) return false;
    for (const candidate of allEvents) {
        const showcase = candidate?.showcaseVideoList;
        if (!Array.isArray(showcase) || !candidate?.config?.pool) continue;
        const references = showcase.some(
            (entry: any) => entry?.aid === event.aid && entry?.subevent === subEvent);
        if (!references) continue;
        if (checkEligibility(candidate.config.pool, student, candidate.aid, pools, candidate)) {
            return true;
        }
    }
    return false;
}

/**
 * @function checkAudioStructuralGate
 * @description Whether this audio object exists and has been released. Pure.
 *
 * The release conditions are the ones the dashboard applies to video — on deck, and the
 * teaching complete — enforced here so a client cannot reach media for an unreleased
 * sub-event by asking for it directly.
 */
export function checkAudioStructuralGate(
    event: any, subEvent: string, index: number, language: string,
): { ok: true; asset: AudioAssetMetadata } | { ok: false; reason: AudioDenialReason } {
    const subEventRecord = event?.subEvents?.[subEvent];
    if (!subEventRecord) return { ok: false, reason: 'NO_SUCH_SUBEVENT' };

    if (!subEventRecord.eventOnDeck || !subEventRecord.eventComplete) {
        return { ok: false, reason: 'SUBEVENT_NOT_RELEASED' };
    }

    const audioList = subEventRecord.embeddedAudioList;
    if (!Array.isArray(audioList) || index >= audioList.length) {
        return { ok: false, reason: 'NO_SUCH_AUDIO' };
    }
    const asset = audioList[index]?.[language];
    if (!isAudioAsset(asset)) return { ok: false, reason: 'NO_SUCH_AUDIO' };

    return {
        ok: true,
        asset: {
            key: asset.key,
            durationSec: Number(asset.durationSec) || 0,
            bytes: Number(asset.bytes) || 0,
            uploadedAt: asset.uploadedAt,
        },
    };
}

/**
 * @function validateAudioRequest
 * @description Reject malformed identifiers before they reach a key or map path. Pure.
 */
export function validateAudioRequest(aid: string, subEvent: string, index: number, language: string): boolean {
    return NAME_PATTERN.test(aid)
        && NAME_PATTERN.test(subEvent)
        && LANGUAGE_PATTERN.test(language)
        && Number.isInteger(index) && index >= 0 && index <= 999;
}

/**
 * @async
 * @function resolveAudioEntitlement
 * @description Decide whether this student may stream this exact audio object.
 *
 * Orchestration only: the decisions live in the pure functions above.
 * @returns {Promise<AudioEntitlement>} The asset metadata when allowed, else a reason.
 */
export async function resolveAudioEntitlement(
    request: AudioPlaybackRequest,
): Promise<AudioEntitlement> {
    const { pid, aid, subEvent, index, language, appRole, oidcToken } = request;

    if (!validateAudioRequest(aid, subEvent, index, language)) {
        return { allowed: false, reason: 'BAD_REQUEST' };
    }

    const eventsCfg = tableGetConfig('events');
    const studentsCfg = tableGetConfig('students');

    const [event, student, pools] = await Promise.all([
        getOne(eventsCfg.tableName, eventsCfg.pk, aid, appRole, oidcToken),
        getOne(studentsCfg.tableName, studentsCfg.pk, pid, appRole, oidcToken),
        loadPools(appRole, oidcToken),
    ]);

    if (!event) return { allowed: false, reason: 'NO_SUCH_EVENT' };
    if (!student) return { allowed: false, reason: 'NO_SUCH_STUDENT' };

    const structural = checkAudioStructuralGate(event, subEvent, index, language);
    if (!structural.ok) return { allowed: false, reason: structural.reason };

    // Try the direct pool first; only scan the events table when it fails, so the common
    // case stays at two GetItems plus a cached pool list.
    if (!studentMayReachEvent(event, subEvent, student, pools, null)) {
        const allEvents = await listAll(eventsCfg.tableName, appRole, oidcToken);
        if (!studentMayReachEvent(event, subEvent, student, pools, allEvents)) {
            return { allowed: false, reason: 'NOT_ELIGIBLE' };
        }
    }

    return { allowed: true, asset: structural.asset };
}

/**
 * @function auditTag
 * @description Short, non-reversible per-student tag carried in the signed URL.
 *
 * It rides in the query string so every CloudFront access log line attributes its bytes to
 * a student, without putting the pid itself in a URL that ends up in logs and history.
 * Excluded from the cache key by the distribution's cache policy.
 */
function auditTag(pid: string): string {
    const secret = process.env.AUDIO_AUDIT_HMAC_SECRET;
    if (!secret) return '';
    return crypto.createHmac('sha256', secret).update(pid).digest('hex').slice(0, 16);
}

export interface SignedAudioUrl {
    url: string;
    /** Epoch milliseconds. The client re-mints before this and on a playback error. */
    expiresAt: number;
}

/**
 * @function signAudioUrl
 * @description Mint a CloudFront signed URL for one audio object.
 *
 * Pure RSA signing — no AWS API call and no IAM permission on the request path. The
 * signature covers the whole URL including the path, which is what makes a swapped
 * aid/subEvent/index/language fail at the edge.
 */
export function signAudioUrl(assetKey: string, pid: string): SignedAudioUrl {
    const domain = process.env.CLOUDFRONT_AUDIO_DOMAIN;
    const keyPairId = process.env.CLOUDFRONT_AUDIO_KEY_PAIR_ID;
    const privateKeyRaw = process.env.CLOUDFRONT_AUDIO_PRIVATE_KEY;
    if (!domain || !keyPairId || !privateKeyRaw) {
        throw new Error('AUDIO_SIGNING_NOT_CONFIGURED: CLOUDFRONT_AUDIO_DOMAIN, '
            + 'CLOUDFRONT_AUDIO_KEY_PAIR_ID and CLOUDFRONT_AUDIO_PRIVATE_KEY must be set');
    }

    // Base64 PEM, matching the existing API_RSA_PRIVATE convention; accept a raw PEM too.
    const privateKey = privateKeyRaw.includes('-----BEGIN')
        ? privateKeyRaw
        : Buffer.from(privateKeyRaw, 'base64').toString('utf8');

    const ttlSeconds = Number(process.env.AUDIO_URL_TTL_SECONDS) || DEFAULT_URL_TTL_SECONDS;
    const expiresAt = Date.now() + ttlSeconds * 1000;

    const tag = auditTag(pid);
    const path = assetKey.split('/').map(encodeURIComponent).join('/');
    const resource = `https://${domain}/${path}${tag ? `?u=${tag}` : ''}`;

    const url = getSignedUrl({
        url: resource,
        keyPairId,
        privateKey,
        dateLessThan: new Date(expiresAt).toISOString(),
    });

    return { url, expiresAt };
}
