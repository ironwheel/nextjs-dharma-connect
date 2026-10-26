# Passkey Authentication Plan

Replaces emailed sign-in codes with passkeys (WebAuthn), adds per-app device limits, and makes
auditors and sys-admin-only apps first-class. The permissions framework is unchanged: per-app actions
profiles, AWS role limits, and app- and action-scoped access tokens. Session timeout handling is unchanged.

## Goals

- Stop approved users from sharing a sign-in with unapproved people.
- Limit how many devices a user can sign in on, per app; admins raise the limit per user.
- Require biometric/PIN verification on high-risk apps.
- Keep auditors visible only in the sys-admin console.

## What passkeys can and can't enforce

- **"Biometric" means user verification (UV).** WebAuthn reports only that the user was verified, by
  biometric or device PIN. `userVerification: 'required'` is the strongest available check.
- **Synced passkeys cover several devices.** iCloud Keychain and Google Password Manager sync one passkey
  across a user's devices, and Apple lets users share passkeys with contacts. Limiting passkeys therefore
  doesn't limit devices; the device registry does that.

## Policy

App defaults live in `APP_ACCESS_JSON` (changed by deploy). Per-user overrides live in the auth record's
`config[host]` and are read with `getConfigValue`.

| Apps | `authMode` | Minimum trust | `maxDevices` | `allowEmailFallback` |
|---|---|---|---|---|
| register, unsubscribe | `silent` (unchanged) | silent | not enforced | n/a |
| event-manager, event-dashboard, email-manager, student-manager, offering-dashboard, refund-request, refund-approve | passkey | `passkey-uv` | 1 | no |
| student-dashboard | passkey | `passkey` | 2 | yes |
| translation-manager, activity-log, auth-test | passkey | `passkey` | 1 | no |
| sys-admin console | passkey | `passkey-uv` | 1 | no |

- Per-user overrides: `maxDevices` (per app), `maxPasskeys` (global, default 1), `emailFallback` (needs the
  app flag *and* an admin grant). Admins can't raise their own limits.
- Trust levels, high to low: `passkey-uv` > `passkey` > `email-verified` > `silent`. One session covers every
  app; an app that needs a higher level asks for the passkey again and raises the session's level.
- Sessions with no `trustLevel` (from before this change) count as the lowest level once an app requires passkeys.
- Email-fallback sessions are `email-verified`, bound to the device, and counted against `maxDevices`.
  Fallback users should get `maxDevices` 1.

## Enrollment: admin invites only

There is no self-service code request. Every user, staff and students alike, enrolls from an admin invite.

1. An admin issues an invite from student-manager, to one user or a batch. A `passkey-invites` record holds a
   hashed random token, the pid, the issuing admin, an expiry (about 72 hours), and a used flag.
2. The user opens the emailed link on an enrollment page served by the shared frontend. Every app is under
   one parent domain (the WebAuthn RP ID), so one passkey works in every app.
3. The server checks that the invite is valid and that the user is under `maxPasskeys`. It then registers
   the passkey, marks the invite used, creates a session on that device, and sends a "passkey added" email.
4. Recovery: an admin clears the user's passkeys and issues a new invite.

The first sys admin enrolls with a one-off invite script, then invites the other student-manager admins.
Student invites go out in batches because SMTP sending is rate-limited.

## Device registry

- Each browser holds a random device ID in an httpOnly cookie that only the API reads (Phase 0). Sessions,
  tokens and logs use its SHA-256 digest, never the raw value.
- A `devices` table records pid, device digest, apps used, first and last seen, user agent, and approximate location.
- A device takes a slot for an app the first time it authenticates there. The slot stays taken until an
  admin removes it. Over the limit, the passkey check succeeds but no token is issued, and the page says to
  contact an admin.

## Auditors and restricted apps

Auditors are people kept in a separate participants table and a separate auth table. Only the sys admin
can see them.

**Confidentiality rule:** auditor names and emails must never appear outside the sys-admin console. That
covers other apps, API responses to non-sys-admins, logs, the activity log, docs and commit messages.

- **Sys admins** are listed in the `SYS_ADMIN_PIDS` env var (comma-separated). This is never stored in a
  table that other admins can write.
- **Restricted apps** are marked `"restricted": true` in `APP_ACCESS_JSON` (today: offering-dashboard).
  Only sys admins can grant them, see who holds them, or send links to them.
- **`auditors-auth`** is a new table resource, pointed at the existing auditors auth table by env var. It
  uses the same record shape as the main auth table.
- **One permission lookup**, used by `checkAccess`, `getConfigValue`, invites and device limits:
  - Normal app: the main auth record, then the main `default`; if the pid isn't there, the `auditors-auth`
    record, then the `auditors-auth` `default`.
  - Restricted app: an explicit `auditors-auth` record for that pid, and nothing else. This holds for
    regular students too, so a grant written to the main auth table is ignored.
- A person lives in `students` or in `auditors`, never both. That's enforced when a record is created. A
  student can still have an `auditors-auth` record, for restricted grants.
- List and search endpoints read only the main tables. Auditor tables are reachable only through sys-admin actions.
- **The sys-admin console** is a second deployment of student-manager, built in auditors mode on its own
  subdomain. It is a restricted app with its own actions profile and AWS role, and only that role can write
  the auditor tables. It replaces running student-manager locally with swapped table env vars.
- Activity entries for auditors are tagged and hidden from everyone except sys admins. Logs show auditor pids,
  never emails.

## Phases

### Phase 0: device binding and hygiene (done in this change)

- A server-issued device cookie (`did`) replaces the client's placeholder fingerprint. It's set by
  `/api/csrf` and by the API middleware if missing. The middleware overwrites `X-Device-Fingerprint` with
  the cookie's digest, so no code path can use a value from the client. This closes the hole where a shared
  `pid`+`hash` link could sign in on any device while the owner's session was live.
- Emailed codes use `crypto.randomInt` and are keyed per participant (`<pid>#<code>`). Send limits and
  failed-attempt limits apply per participant.
- The SMTP password is no longer logged, and auditor emails are no longer logged.
- `SYS_ADMIN_PIDS` and `"restricted": true` take effect:
  - `getAuthList` hides restricted hosts from non-sys-admins.
  - `putAuthItem` refuses restricted grants from non-sys-admins and keeps any stored restricted grants.
  - `linkEmailSend` to a restricted host is sys-admin only.

Deploy notes:
- After deploy, every user signs in once more, because old sessions were keyed on the placeholder. Silent apps
  re-create their session without a 401.
- Add `"restricted": true` to the offering-dashboard entry in `APP_ACCESS_JSON` and set `SYS_ADMIN_PIDS`.
  Do this in production and in any local env used to manage auditors. Without the flag, the guard does nothing.

### Phase 1a: passkey core (done in this change)

- `@simplewebauthn/server` (pinned 13.3.x), in `packages/api/lib/passkeys.ts`. The relying party ID is
  `MONOREPO_PARENT_DOMAIN` without its leading dot (`localhost` in development; `WEBAUTHN_RP_ID` overrides).
  Allowed origins come from `CORS_ORIGIN_LIST`.
- **Invites:** `POST/auth/passkeyInviteSend` (body: `targetUserPid`, `linkHost`) emails a single-use link:
  `https://<linkHost>/?pid=…&hash=…&invite=<token>`. Only a SHA-256 hash of the token is stored. Invites expire
  after `PASSKEY_INVITE_DURATION` seconds (default 72 hours). Invites are refused when:
  - `linkHost` doesn't have passkeys turned on
  - the participant is at `maxPasskeys`
  - the target is an auditor or `linkHost` is restricted and the caller isn't a sys admin
- **Enrollment:** `POST/auth/passkeyRegisterOptions` (`invite`) and `POST/auth/passkeyRegisterVerify`
  (`invite`, `challengeId`, `response`).
  - Enrollment always requires user verification. The invite is used up with a conditional write.
  - The user is signed in on that device, and a "passkey added" email goes out after the response is sent.
  - Both actions are open to anyone with access to the host, like the email-code actions. They also run
    while the user is already signed in.
- **Sign-in:** `POST/auth/passkeyAuthOptions` and `POST/auth/passkeyAuthVerify` (`challengeId`, `response`).
  The session gets `passkey-uv` or `passkey` and records the credential used. A non-UV sign-in never lowers a
  valid `passkey-uv` session on the same device.
- **Challenges** are single-use and bound to participant, device, host and ceremony. They expire after 5 minutes.
- **Admin:** `POST/auth/passkeyList` (`targetUserPid`; public keys are never returned) and `POST/auth/passkeyRevoke`
  (`targetUserPid`, `credentialId`). Revoking deletes the passkey and ends every session opened with it. Access
  tokens already issued stay valid until they expire (`ACCESS_TOKEN_DURATION`). Auditors are invisible to
  non-sys-admins here too.
- **Trust levels** in `checkAccess` and `verificationCheck`, per app, from `APP_ACCESS_JSON`:
  - `authMode`: `email` (default) | `passkey-optional` | `passkey-required`
  - `userVerification`: `preferred` (default) | `required`
  - `allowEmailFallback`
  On `passkey-required` apps, emailed codes are refused (`AUTH_EMAIL_SIGNIN_DISABLED`) unless the app allows a
  fallback and the participant's own record has `config[host].emailFallback: true`.
- **`verificationCheck`** also returns `authMode`, `userVerification`, `emailSignIn` and `hasPasskey` for the
  login page. Apps on `email` never touch the passkey tables.
- **Fix:** a silent app no longer revives an expired verified session as verified. Any session it creates is `silent`.
- **`putAuthItem`:**
  - keeps stored fields the caller didn't send (e.g. `maxPasskeys`)
  - stops non-sys-admins changing their own `maxPasskeys`, `config[host].maxDevices` or `config[host].emailFallback`

Deploy notes:
- Safe to deploy before the tables exist. Until an app's `authMode` changes, only the silent-session fix
  changes behavior.
- Create the tables below and set their env vars. Give the auth role (`AUTH_ROLE_ARN`) read/write on them.
  - `passkeys` (`DYNAMODB_TABLE_PASSKEYS`): pk `pid`, sk `credentialId`
  - `webauthn-challenges` (`DYNAMODB_TABLE_WEBAUTHN_CHALLENGES`): pk `challengeId`, TTL `ttl`
  - `passkey-invites` (`DYNAMODB_TABLE_PASSKEY_INVITES`): pk `inviteHash`, TTL `ttl`
- The auth role also needs Query and DeleteItem on the sessions table (for revoke).
- Add `POST/auth/passkeyInviteSend`, `POST/auth/passkeyList` and `POST/auth/passkeyRevoke` to the student-manager
  actions profile at least one `ACCESS_TOKEN_DURATION` before the admin UI that calls them ships.
- Email text uses `passkey`-aid prompts (`passkey-inviteSubject`, `passkey-inviteEmail` with `||name||`,
  `||link||`, `||expires||`; `passkey-addedSubject`, `passkey-addedEmail` with `||name||`, `||time||`,
  `||location||`). Built-in English text is used until those prompt records exist.
- Optional: `PASSKEY_INVITE_DURATION`, `WEBAUTHN_RP_NAME` (shown in passkey prompts), `WEBAUTHN_RP_ID`.

### Phase 1b: device registry

- Add the `devices` table and `maxDevices` checks wherever tokens are created.

### Phase 1c: auditors

- Add the `auditors-auth` resource, the shared permission lookup, the restricted-app rule, sys-admin actions,
  and auditor filtering of activity.

### Phase 2: shared frontend

Replace the code-entry flow in `AuthVerification` with:
- passkey sign-in
- the enroll-from-invite page
- the device-limit-reached and passkey-limit-reached screens
- the email-fallback path

This needs new multilingual prompts. Invite links open the app root (`/?pid=…&hash=…&invite=…`), so each
app's redirect to `/login` must carry the `invite` parameter through. Pilot on auth-test.

### Phase 3: admin UI

- **Student-manager:**
  - issue invites (single and batch)
  - list and revoke passkeys
  - list and remove devices
  - per-user `maxDevices` / `maxPasskeys` overrides and the email-fallback grant
- **Sys-admin console deployment:** auditor records, restricted grants, auditor invites (auditor SMTP
  sender), and auditor passkey and device management.
- **One-off sys-admin invite script.**

### Phase 4: rollout

1. The sys admin enrolls with the script and invites the other student-manager admins. Staff apps move to
   `passkey-required`.
2. The sys admin invites auditors from the console, and the local env-swap workflow is retired.
3. Students are invited in batches. Student-dashboard goes `passkey-optional`, then `passkey-required`, with
   fallback grants for users who can't use a passkey.
4. The self-service code endpoints are retired.

## Risks to test

- **Register's offering flow:** register stays `silent`. Device binding must never produce a 401 or extra
  token refresh there, and no new actions are added on that path.
- **Safari cookie lifetime:** Safari may cap cookie lifetime at 7 days in some hosting setups. Check during
  the pilot that the device cookie survives longer than 7 days. If it doesn't, admin-only device slots will
  generate support load.
- **Synced and shared passkeys:** an accepted limitation, bounded by the device limit.
