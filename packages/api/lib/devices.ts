/**
 * @file packages/api/lib/devices.ts
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Admin list and removal of participant devices. Devices are recorded, and limits enforced,
 *              by claimDeviceSlot in authUtils for apps with `maxDevices` set. See docs/passkey-auth-plan.md.
 */
import { tableGetConfig } from './tableConfig';
import { getOne, getOneWithSort, deleteOneWithSort, queryByPartition } from './dynamoClient';
import { assertCanManageParticipant, deviceLimit, parseAccessList, REFUSED_DEVICE_PREFIX, REFUSED_DEVICE_RETENTION_MS } from './authUtils';
import { browserCode } from './device';

/**
 * @async
 * @function deviceList
 * @description Lists a participant's devices, the browsers recently refused by a device limit, and for each
 *              app that limits devices, how many they may use. A refusal is left out once that browser holds
 *              the app it was refused for.
 * @param {string} callerPid - The admin making the request.
 * @param {string} targetPid - The participant.
 * @returns {Promise<{ devices: any[], refused: any[], limits: Record<string, number> }>}
 */
export async function deviceList(callerPid: string, targetPid: string, oidcToken?: string): Promise<{ devices: any[], refused: any[], limits: Record<string, number> }> {
    await assertCanManageParticipant(callerPid, targetPid, oidcToken);

    const devicesCfg = tableGetConfig('devices');
    const records = await queryByPartition(devicesCfg.tableName, devicesCfg.pk, targetPid, process.env.AUTH_ROLE_ARN!, oidcToken);
    const devices = records.filter((d: any) => !d.fingerprint.startsWith(REFUSED_DEVICE_PREFIX));
    const since = Date.now() - REFUSED_DEVICE_RETENTION_MS;
    const refused = records
        .filter((d: any) => d.fingerprint.startsWith(REFUSED_DEVICE_PREFIX) && d.lastRefusedAt > since)
        .filter((d: any) => {
            const fingerprint = d.fingerprint.slice(REFUSED_DEVICE_PREFIX.length);
            return !devices.some((dev: any) => dev.fingerprint === fingerprint && dev.apps?.[d.lastRefusedHost]);
        })
        .sort((a: any, b: any) => b.lastRefusedAt - a.lastRefusedAt);

    const authCfg = tableGetConfig('auth');
    const authData = await getOne(authCfg.tableName, authCfg.pk, targetPid, process.env.AUTH_ROLE_ARN!, oidcToken)
        || await getOne(authCfg.tableName, authCfg.pk, 'default', process.env.AUTH_ROLE_ARN!, oidcToken);
    const permittedHosts: string[] = authData?.['permitted-hosts'] || [];
    const limits: Record<string, number> = {};
    for (const entry of parseAccessList()) {
        if (!permittedHosts.includes(entry.host)) continue;
        const limit = deviceLimit(entry, authData, targetPid, entry.host);
        if (limit !== undefined) limits[entry.host] = limit;
    }

    return {
        devices: devices.map((d: any) => ({
            fingerprint: d.fingerprint,
            browserCode: browserCode(d.fingerprint),
            userAgent: d.userAgent,
            firstSeenAt: d.firstSeenAt,
            lastSeenAt: d.lastSeenAt,
            apps: d.apps || {},
        })),
        refused: refused.map((d: any) => ({
            fingerprint: d.fingerprint,
            browserCode: browserCode(d.fingerprint.slice(REFUSED_DEVICE_PREFIX.length)),
            userAgent: d.userAgent,
            host: d.lastRefusedHost,
            firstRefusedAt: d.firstRefusedAt,
            lastRefusedAt: d.lastRefusedAt,
            attempts: d.attempts || 1,
        })),
        limits,
    };
}

/**
 * @async
 * @function deviceRemove
 * @description Removes a participant's device from every app and signs it out, freeing its slots. The
 *              device can take a slot again only by signing in again while the participant is under the limit.
 *              Removing a device also drops its refusal record; passing a refusal's 'refused#' fingerprint
 *              (from deviceList) dismisses just that record.
 * @param {string} callerPid - The admin making the request.
 * @param {string} targetPid - The participant.
 * @param {string} fingerprint - The device fingerprint (from deviceList).
 * @returns {Promise<{ success: boolean }>}
 * @throws {Error} AUTH_DEVICE_NOT_FOUND
 */
export async function deviceRemove(callerPid: string, targetPid: string, fingerprint: string, oidcToken?: string): Promise<{ success: boolean }> {
    await assertCanManageParticipant(callerPid, targetPid, oidcToken);

    const devicesCfg = tableGetConfig('devices');
    const device = await getOneWithSort(devicesCfg.tableName, devicesCfg.pk, targetPid, devicesCfg.sk, fingerprint, process.env.AUTH_ROLE_ARN!, oidcToken);
    if (!device) throw new Error('AUTH_DEVICE_NOT_FOUND');
    await deleteOneWithSort(devicesCfg.tableName, devicesCfg.pk, targetPid, devicesCfg.sk, fingerprint, process.env.AUTH_ROLE_ARN!, oidcToken);
    if (!fingerprint.startsWith(REFUSED_DEVICE_PREFIX)) {
        await deleteOneWithSort(devicesCfg.tableName, devicesCfg.pk, targetPid, devicesCfg.sk, REFUSED_DEVICE_PREFIX + fingerprint, process.env.AUTH_ROLE_ARN!, oidcToken);
    }

    // End the device's session so it can't quietly take its slot back on the next token refresh.
    const sessionsCfg = tableGetConfig('sessions');
    await deleteOneWithSort(sessionsCfg.tableName, sessionsCfg.pk, targetPid, sessionsCfg.sk, fingerprint, process.env.AUTH_ROLE_ARN!, oidcToken);

    console.log(`deviceRemove: device removed for ${targetPid} by ${callerPid}`);
    return { success: true };
}
