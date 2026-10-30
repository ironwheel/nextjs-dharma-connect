/**
 * @file packages/api/lib/signInSettings.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Admin view and editing of a participant's sign-in setup: passkeys, devices, and the per-user
 *              sign-in limits and exceptions (maxPasskeys, config[host].maxDevices, config[host].emailFallback).
 *              See docs/passkey-auth-plan.md.
 */
import { tableGetConfig } from './tableConfig';
import { getOne, putOne } from './dynamoClient';
import { noteAdminAction } from './activity';
import {
    assertCanManageParticipant,
    deviceLimit,
    getRestrictedHosts,
    isSysAdmin,
    parseAccessList,
    passkeysEnabled,
} from './authUtils';
import { passkeyList } from './passkeys';
import { deviceList } from './devices';

const DEFAULT_MAX_PASSKEYS = 1;
const MAX_LIMIT = 20;

async function authRecords(targetPid: string, oidcToken?: string): Promise<{ own: any, effective: any }> {
    const authCfg = tableGetConfig('auth');
    const own = await getOne(authCfg.tableName, authCfg.pk, targetPid, process.env.AUTH_ROLE_ARN!, oidcToken);
    const effective = own || await getOne(authCfg.tableName, authCfg.pk, 'default', process.env.AUTH_ROLE_ARN!, oidcToken);
    return { own, effective };
}

/**
 * @async
 * @function signInSummary
 * @description Everything the admin sign-in panel shows for a participant: passkeys, devices, browsers recently
 *              refused by a device limit, and for each app they may use, its passkey mode, device limit (default
 *              and override) and email fallback.
 * @param {string} callerPid - The admin making the request.
 * @param {string} targetPid - The participant.
 */
export async function signInSummary(callerPid: string, targetPid: string, oidcToken?: string): Promise<any> {
    await assertCanManageParticipant(callerPid, targetPid, oidcToken);
    const [{ own, effective }, passkeys, devices] = await Promise.all([
        authRecords(targetPid, oidcToken),
        passkeyList(callerPid, targetPid, oidcToken),
        deviceList(callerPid, targetPid, oidcToken),
    ]);

    const permitted: string[] = effective?.['permitted-hosts'] || [];
    const restricted = getRestrictedHosts();
    const sysAdmin = isSysAdmin(callerPid);
    const apps = parseAccessList()
        .filter((e: any) => permitted.includes(e.host) && e.sessionMode !== 'silent')
        .filter((e: any) => sysAdmin || !restricted.includes(e.host))
        .map((e: any) => ({
            host: e.host,
            authMode: e.authMode || 'email',
            passkeysEnabled: passkeysEnabled(e),
            userVerification: e.userVerification === 'required' ? 'required' : 'preferred',
            deviceLimit: deviceLimit(e, effective, targetPid, e.host) ?? null,
            deviceLimitDefault: typeof e.maxDevices === 'number' ? e.maxDevices : null,
            deviceLimitOverride: typeof own?.config?.[e.host]?.maxDevices === 'number' ? own.config[e.host].maxDevices : null,
            emailFallbackAllowed: e.allowEmailFallback === true,
            emailFallback: own?.config?.[e.host]?.emailFallback === true,
        }));

    return {
        passkeys,
        devices: devices.devices,
        refusedBrowsers: devices.refused,
        apps,
        maxPasskeys: typeof own?.maxPasskeys === 'number' ? own.maxPasskeys : DEFAULT_MAX_PASSKEYS,
        maxPasskeysOverride: typeof own?.maxPasskeys === 'number' ? own.maxPasskeys : null,
        canEditLimits: sysAdmin || callerPid !== targetPid,
        callerIsSysAdmin: sysAdmin,
    };
}

function validLimit(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_LIMIT;
}

/**
 * @function limitChanges
 * @description What changed between two auth records, in words, for the activity log. Compares the values that
 *              apply, so clearing an override reads as a change to the default. Restricted apps are left out.
 */
function limitChanges(before: any, after: any): string[] {
    const changes: string[] = [];
    const passkeys = (r: any) => r.maxPasskeys ?? DEFAULT_MAX_PASSKEYS;
    if (passkeys(before) !== passkeys(after)) changes.push(`max passkeys from ${passkeys(before)} to ${passkeys(after)}`);

    const restricted = getRestrictedHosts();
    for (const entry of parseAccessList().filter((e: any) => !restricted.includes(e.host))) {
        const app = entry.host.split('.')[0];
        const browsers = (r: any) => r.config?.[entry.host]?.maxDevices ?? entry.maxDevices ?? 'no limit';
        const fallback = (r: any) => r.config?.[entry.host]?.emailFallback === true;
        if (browsers(before) !== browsers(after)) changes.push(`${app} browsers from ${browsers(before)} to ${browsers(after)}`);
        if (fallback(before) !== fallback(after)) changes.push(`${app} email fallback ${fallback(after) ? 'on' : 'off'}`);
    }
    return changes;
}

/**
 * @async
 * @function setSignInLimits
 * @description Sets or clears a participant's sign-in limits and exceptions. `null` clears an override.
 *              Admins other than sys admins can't change their own. A participant without their own auth
 *              record gets one copied from 'default' first, so their app access doesn't change.
 *              Changes are logged to the activity log.
 * @param {string} callerPid - The admin making the request.
 * @param {string} targetPid - The participant.
 * @param {object} changes - { maxPasskeys?: number | null, maxDevices?: { [host]: number | null },
 *                           emailFallback?: { [host]: boolean | null } }
 * @param {string} host - The host of the calling app.
 * @throws {Error} AUTH_CANT_CHANGE_OWN_LIMITS, AUTH_INVALID_LIMIT, UNKNOWN_HOST, AUTH_RESTRICTED_HOST_SYS_ADMIN_ONLY
 */
export async function setSignInLimits(callerPid: string, targetPid: string, changes: any, host: string, oidcToken?: string): Promise<{ success: boolean }> {
    await assertCanManageParticipant(callerPid, targetPid, oidcToken);
    if (callerPid === targetPid && !isSysAdmin(callerPid)) throw new Error('AUTH_CANT_CHANGE_OWN_LIMITS');

    const knownHosts: string[] = parseAccessList().map((e: any) => e.host);
    const restricted = getRestrictedHosts();
    const checkHost = (limitHost: string) => {
        if (!knownHosts.includes(limitHost)) throw new Error('UNKNOWN_HOST');
        if (restricted.includes(limitHost) && !isSysAdmin(callerPid)) throw new Error('AUTH_RESTRICTED_HOST_SYS_ADMIN_ONLY');
    };

    const { own } = await authRecords(targetPid, oidcToken);
    let record: any;
    if (own) {
        record = { ...own, config: { ...(own.config || {}) } };
    } else {
        const authCfg = tableGetConfig('auth');
        const fallback = await getOne(authCfg.tableName, authCfg.pk, 'default', process.env.AUTH_ROLE_ARN!, oidcToken);
        if (!fallback) throw new Error('AUTH_CANT_FIND_DEFAULT_PERMITTED_HOSTS');
        record = { id: targetPid, 'permitted-hosts': [...(fallback['permitted-hosts'] || [])], config: JSON.parse(JSON.stringify(fallback.config || {})) };
    }
    const before = JSON.parse(JSON.stringify(record));

    if ('maxPasskeys' in (changes || {})) {
        if (changes.maxPasskeys === null) delete record.maxPasskeys;
        else if (validLimit(changes.maxPasskeys)) record.maxPasskeys = changes.maxPasskeys;
        else throw new Error('AUTH_INVALID_LIMIT');
    }
    for (const [limitHost, value] of Object.entries(changes?.maxDevices || {})) {
        checkHost(limitHost);
        if (value === null) {
            if (record.config[limitHost]) delete record.config[limitHost].maxDevices;
        } else if (validLimit(value)) {
            record.config[limitHost] = { ...(record.config[limitHost] || {}), maxDevices: value };
        } else {
            throw new Error('AUTH_INVALID_LIMIT');
        }
    }
    for (const [limitHost, value] of Object.entries(changes?.emailFallback || {})) {
        checkHost(limitHost);
        if (value === true) record.config[limitHost] = { ...(record.config[limitHost] || {}), emailFallback: true };
        else if (record.config[limitHost]) delete record.config[limitHost].emailFallback;
    }

    const authCfg = tableGetConfig('auth');
    await putOne(authCfg.tableName, record, process.env.AUTH_ROLE_ARN!, oidcToken);
    console.log(`setSignInLimits: ${targetPid} updated by ${callerPid}: ${JSON.stringify(changes)}`);
    noteAdminAction(callerPid, targetPid, host, () => {
        const described = limitChanges(before, record);
        return described.length ? { type: 'auth.signInLimitsChanged', summary: `changed ${described.join(', ')}` } : null;
    }, oidcToken);
    return { success: true };
}
