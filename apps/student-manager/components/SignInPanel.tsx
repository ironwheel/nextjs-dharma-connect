/**
 * @file apps/student-manager/components/SignInPanel.tsx
 * @copyright Robert E. Taylor, Extropic Systems, 2025
 * @license MIT
 * @description Admin panel for a student's sign-in setup: passkeys (invite, revoke), browsers (remove), browsers
 *              recently refused by a browser limit, and per-user limits and exceptions (max passkeys, per-app
 *              browser limit, email fallback). The API and its records call browsers "devices".
 *              See docs/passkey-auth-plan.md.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Form, Spinner, Table } from 'react-bootstrap';
import { toast } from 'react-toastify';
import {
    authSignInSummary,
    authSetSignInLimits,
    authPasskeyInviteSend,
    authPasskeyRevoke,
    authDeviceRemove,
} from 'sharedFrontend';

interface SignInApp {
    host: string;
    authMode: 'email' | 'passkey-optional' | 'passkey-required';
    passkeysEnabled: boolean;
    userVerification: 'required' | 'preferred';
    deviceLimit: number | null;
    deviceLimitDefault: number | null;
    deviceLimitOverride: number | null;
    emailFallbackAllowed: boolean;
    emailFallback: boolean;
}

interface SignInSummary {
    passkeys: Array<{ credentialId: string, aaguid?: string, deviceType?: string, backedUp?: boolean, createdAt?: number, createdHost?: string, lastUsedAt?: number, lastUsedHost?: string }>;
    devices: Array<{ fingerprint: string, browserCode: string, userAgent?: string, firstSeenAt?: number, lastSeenAt?: number, apps: Record<string, { firstSeenAt: number, lastSeenAt: number }> }>;
    refusedBrowsers?: Array<{ fingerprint: string, browserCode: string, userAgent?: string, host: string, firstRefusedAt?: number, lastRefusedAt: number, attempts: number }>;
    apps: SignInApp[];
    maxPasskeys: number;
    maxPasskeysOverride: number | null;
    canEditLimits: boolean;
    callerIsSysAdmin?: boolean;
}

interface SignInPanelProps {
    onCallerIsSysAdmin?: (isSysAdmin: boolean) => void;
    studentId: string;
    pid: string;
    hash: string;
}

// Well-known passkey provider AAGUIDs, for telling passkeys apart
const PROVIDERS: Record<string, string> = {
    'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
    'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
    'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
    '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
    '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
    '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
    'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
    'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
};

const ERROR_TEXT: Record<string, string> = {
    AUTH_PASSKEYS_NOT_ENABLED: "Passkeys aren't turned on for that app yet.",
    AUTH_PASSKEY_LIMIT_REACHED: 'This student already has the most passkeys allowed. Raise Max passkeys or revoke one first.',
    AUTH_CANT_CHANGE_OWN_LIMITS: "You can't change your own sign-in limits. Ask another admin.",
    AUTH_RESTRICTED_HOST_SYS_ADMIN_ONLY: 'Only a sys admin can do that for this app.',
    AUTH_INVITE_EMAIL_SEND_FAILED: "The invitation couldn't be emailed. Please try again later.",
    AUTH_INVALID_LIMIT: 'Limits must be whole numbers from 0 to 20.',
    AUTH_OPERATION_NOT_ALLOWED: "Your student-manager permissions don't include this action yet.",
    AUTH_PID_NOT_FOUND: 'Student not found.',
};

const appName = (host: string) => host.split('.')[0];

const formatDate = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '—');

const errorText = (err: unknown) => {
    const message = (err as Error)?.message || '';
    const code = Object.keys(ERROR_TEXT).find(c => message.includes(c));
    return code ? ERROR_TEXT[code] : message || 'Something went wrong.';
};

/**
 * @function describeDevice
 * @description A short "iPhone · Safari" style label from a user agent.
 */
const describeDevice = (userAgent?: string) => {
    const ua = userAgent || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
        : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
        : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return browser ? `${os} · ${browser}` : os;
};

/**
 * @function refusalHint
 * @description Why a browser was probably refused. Two profiles of one browser, a private window, or the same
 *              browser after its cookies were cleared look like different browsers of the same kind.
 */
const refusalHint = (userAgent: string | undefined, devices: SignInSummary['devices']) => {
    const kind = describeDevice(userAgent);
    const same = devices.filter(d => describeDevice(d.userAgent) === kind).map(d => d.browserCode);
    return same.length
        ? `Same kind of browser as ${same.join(', ')}: probably another profile of that browser, a private window, or cleared cookies.`
        : 'A different browser or device from the ones above.';
};

const browserCodeStyle: React.CSSProperties = { fontFamily: 'monospace', letterSpacing: '0.1em', marginRight: '8px' };

const signInLabel = (app: SignInApp) => {
    if (app.authMode === 'email') return 'Emailed code';
    const mode = app.authMode === 'passkey-required' ? 'Passkey required' : 'Passkey optional';
    return app.userVerification === 'required' ? `${mode} (Face ID/fingerprint/PIN)` : mode;
};

const sectionStyle: React.CSSProperties = {
    border: '1px solid #555',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '30px',
    backgroundColor: '#1a1a1a'
};

/**
 * @component SignInPanel
 * @description Shows and edits a student's passkeys, devices and sign-in limits. Changes save immediately,
 *              separately from the edit form's Save.
 */
export const SignInPanel: React.FC<SignInPanelProps> = ({ studentId, pid, hash, onCallerIsSysAdmin }) => {
    const [summary, setSummary] = useState<SignInSummary | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [inviteHost, setInviteHost] = useState('');
    const [maxPasskeysInput, setMaxPasskeysInput] = useState('');
    const [deviceLimitInputs, setDeviceLimitInputs] = useState<Record<string, string>>({});
    const [fallbackInputs, setFallbackInputs] = useState<Record<string, boolean>>({});

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const result = await authSignInSummary(studentId, pid, hash);
            if (!result || result.redirected) return;
            const s = result as SignInSummary;
            setSummary(s);
            onCallerIsSysAdmin?.(s.callerIsSysAdmin === true);
            setMaxPasskeysInput(s.maxPasskeysOverride === null ? '' : String(s.maxPasskeysOverride));
            setDeviceLimitInputs(Object.fromEntries(s.apps.map(a => [a.host, a.deviceLimitOverride === null ? '' : String(a.deviceLimitOverride)])));
            setFallbackInputs(Object.fromEntries(s.apps.map(a => [a.host, a.emailFallback])));
            setInviteHost(prev => prev || s.apps.find(a => a.passkeysEnabled)?.host || '');
        } catch (err) {
            setLoadError(errorText(err));
        }
    }, [studentId, pid, hash, onCallerIsSysAdmin]);

    useEffect(() => { load(); }, [load]);

    const run = async (action: () => Promise<any>, success: string) => {
        setBusy(true);
        try {
            const result = await action();
            if (result?.redirected) return;
            toast.success(success);
            await load();
        } catch (err) {
            toast.error(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    const sendInvite = () => run(() => authPasskeyInviteSend(studentId, inviteHost, pid, hash), `Passkey invitation emailed (opens ${appName(inviteHost)})`);

    const revokePasskey = (credentialId: string) => {
        if (!window.confirm("Revoke this passkey? The student will be signed out wherever they used it and will need a new invitation to set one up again.")) return;
        run(() => authPasskeyRevoke(studentId, credentialId, pid, hash), 'Passkey revoked');
    };

    const removeDevice = (fingerprint: string) => {
        if (!window.confirm('Remove this browser? It will be signed out and lose its place in every app. It can take a place again only by signing in while the student is under the limit.')) return;
        run(() => authDeviceRemove(studentId, fingerprint, pid, hash), 'Browser removed');
    };

    const dismissRefusal = (fingerprint: string) => run(() => authDeviceRemove(studentId, fingerprint, pid, hash), 'Refused browser dismissed');

    const saveLimits = () => {
        if (!summary) return;
        const parse = (v: string) => (v.trim() === '' ? null : Number(v));
        const changes: any = {};
        if (parse(maxPasskeysInput) !== summary.maxPasskeysOverride) changes.maxPasskeys = parse(maxPasskeysInput);
        for (const app of summary.apps) {
            const limit = parse(deviceLimitInputs[app.host] || '');
            if (limit !== app.deviceLimitOverride) changes.maxDevices = { ...(changes.maxDevices || {}), [app.host]: limit };
            if (app.emailFallbackAllowed && !!fallbackInputs[app.host] !== app.emailFallback) {
                changes.emailFallback = { ...(changes.emailFallback || {}), [app.host]: fallbackInputs[app.host] ? true : null };
            }
        }
        if (Object.keys(changes).length === 0) {
            toast.info('No changes to save');
            return;
        }
        run(() => authSetSignInLimits(studentId, changes, pid, hash), 'Sign-in limits saved');
    };

    if (loadError) {
        return (
            <div style={sectionStyle}>
                <h5>Sign-in</h5>
                <p style={{ color: '#f88' }}>{loadError}</p>
                <Button size="sm" variant="outline-light" onClick={load}>Retry</Button>
            </div>
        );
    }
    if (!summary) {
        return (
            <div style={sectionStyle}>
                <h5>Sign-in</h5>
                <Spinner animation="border" size="sm" /> Loading passkeys and browsers...
            </div>
        );
    }

    const passkeyApps = summary.apps.filter(a => a.passkeysEnabled);
    const editable = summary.canEditLimits && !busy;

    return (
        <div style={sectionStyle}>
            <h5 style={{ marginBottom: '20px' }}>Sign-in</h5>
            {!summary.canEditLimits && (
                <p style={{ color: '#aaa', fontSize: '0.9em' }}>This is your own account: another admin has to change your limits or remove your passkeys and browsers.</p>
            )}

            <h6>Passkeys ({summary.passkeys.length} of {summary.maxPasskeys} allowed)</h6>
            {summary.passkeys.length === 0 ? (
                <p style={{ color: '#aaa' }}>No passkey yet.</p>
            ) : (
                <Table size="sm" variant="dark" responsive>
                    <thead><tr><th>Passkey</th><th>Added</th><th>Last used</th><th /></tr></thead>
                    <tbody>
                        {summary.passkeys.map(p => (
                            <tr key={p.credentialId}>
                                <td>
                                    {PROVIDERS[p.aaguid || ''] || (p.deviceType === 'singleDevice' ? 'Security key or device-bound passkey' : 'Passkey')}
                                    {p.backedUp ? ' · synced' : ' · this device only'}
                                </td>
                                <td>{formatDate(p.createdAt)}{p.createdHost ? ` on ${appName(p.createdHost)}` : ''}</td>
                                <td>{formatDate(p.lastUsedAt)}{p.lastUsedHost ? ` on ${appName(p.lastUsedHost)}` : ''}</td>
                                <td><Button size="sm" variant="outline-danger" disabled={!editable} onClick={() => revokePasskey(p.credentialId)}>Revoke</Button></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {passkeyApps.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: '0.9em' }}>Passkeys aren't turned on for any of this student's apps yet.</p>
            ) : (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <Form.Select size="sm" style={{ maxWidth: '260px' }} value={inviteHost} onChange={e => setInviteHost(e.target.value)} aria-label="App the invitation opens">
                        {passkeyApps.map(a => <option key={a.host} value={a.host}>{appName(a.host)}</option>)}
                    </Form.Select>
                    <Button size="sm" variant="primary" disabled={busy || !inviteHost} onClick={sendInvite}>Email passkey invitation</Button>
                </div>
            )}

            <h6>Browsers</h6>
            <p style={{ color: '#aaa', fontSize: '0.85em' }}>
                Each browser on each computer or phone counts separately, and so does each Chrome or Edge profile and each private window.
                The code matches the one the student sees when a browser is refused.
            </p>
            {summary.devices.length === 0 ? (
                <p style={{ color: '#aaa' }}>No browsers recorded. Browsers are recorded for apps with a browser limit.</p>
            ) : (
                <Table size="sm" variant="dark" responsive>
                    <thead><tr><th>Browser</th><th>Apps</th><th>First seen</th><th>Last seen</th><th /></tr></thead>
                    <tbody>
                        {summary.devices.map(d => (
                            <tr key={d.fingerprint}>
                                <td title={d.userAgent}><span style={browserCodeStyle}>{d.browserCode}</span>{describeDevice(d.userAgent)}</td>
                                <td>{Object.keys(d.apps).map(appName).join(', ')}</td>
                                <td>{formatDate(d.firstSeenAt)}</td>
                                <td>{formatDate(d.lastSeenAt)}</td>
                                <td><Button size="sm" variant="outline-danger" disabled={!editable} onClick={() => removeDevice(d.fingerprint)}>Remove</Button></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            {!!summary.refusedBrowsers?.length && (
                <>
                    <h6 style={{ marginTop: '10px' }}>Recently refused</h6>
                    <Table size="sm" variant="dark" responsive>
                        <thead><tr><th>Browser</th><th>App</th><th>Last refused</th><th>Likely reason</th><th /></tr></thead>
                        <tbody>
                            {summary.refusedBrowsers.map(r => (
                                <tr key={r.fingerprint}>
                                    <td title={r.userAgent}><span style={browserCodeStyle}>{r.browserCode}</span>{describeDevice(r.userAgent)}</td>
                                    <td>{appName(r.host)}</td>
                                    <td>{formatDate(r.lastRefusedAt)}{r.attempts > 1 ? ` (${r.attempts} tries)` : ''}</td>
                                    <td style={{ fontSize: '0.9em' }}>{refusalHint(r.userAgent, summary.devices)}</td>
                                    <td><Button size="sm" variant="outline-light" disabled={!editable} onClick={() => dismissRefusal(r.fingerprint)}>Dismiss</Button></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </>
            )}

            <h6 style={{ marginTop: '10px' }}>Limits and exceptions</h6>
            <Table size="sm" variant="dark" responsive>
                <thead><tr><th>App</th><th>Sign-in</th><th>Browser limit</th><th>Email fallback</th></tr></thead>
                <tbody>
                    {summary.apps.map(app => (
                        <tr key={app.host}>
                            <td>{appName(app.host)}</td>
                            <td>{signInLabel(app)}</td>
                            <td>
                                {app.deviceLimitDefault === null && app.deviceLimitOverride === null ? (
                                    <span style={{ color: '#aaa' }}>No limit</span>
                                ) : (
                                    <Form.Control
                                        size="sm"
                                        type="number"
                                        min={0}
                                        max={20}
                                        style={{ maxWidth: '90px' }}
                                        placeholder={app.deviceLimitDefault === null ? '' : `${app.deviceLimitDefault}`}
                                        value={deviceLimitInputs[app.host] || ''}
                                        disabled={!editable}
                                        aria-label={`Browser limit override for ${appName(app.host)}`}
                                        onChange={e => setDeviceLimitInputs(prev => ({ ...prev, [app.host]: e.target.value }))}
                                    />
                                )}
                            </td>
                            <td>
                                {app.emailFallbackAllowed ? (
                                    <Form.Check
                                        type="checkbox"
                                        checked={!!fallbackInputs[app.host]}
                                        disabled={!editable}
                                        aria-label={`Allow emailed codes on ${appName(app.host)}`}
                                        onChange={e => setFallbackInputs(prev => ({ ...prev, [app.host]: e.target.checked }))}
                                    />
                                ) : (
                                    <span style={{ color: '#aaa' }}>—</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Form.Label style={{ marginBottom: 0 }}>Max passkeys</Form.Label>
                <Form.Control
                    size="sm"
                    type="number"
                    min={0}
                    max={20}
                    style={{ maxWidth: '90px' }}
                    placeholder="1"
                    value={maxPasskeysInput}
                    disabled={!editable}
                    aria-label="Max passkeys override"
                    onChange={e => setMaxPasskeysInput(e.target.value)}
                />
                <Button size="sm" variant="outline-light" disabled={!editable} onClick={saveLimits}>Save limits</Button>
            </div>
            <p style={{ color: '#aaa', fontSize: '0.85em', marginTop: '10px' }}>
                Leave a limit blank to use the app's default (shown in grey). Email fallback lets a student without a passkey keep using emailed codes on apps that allow it. Changes in this section save on their own.
            </p>
        </div>
    );
};

export default SignInPanel;
