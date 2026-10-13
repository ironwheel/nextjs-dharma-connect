# neon-sync

Keeps the participant (student) DynamoDB table in step with Neon CRM. It replaces
the `-neonsync` and `-mailNeonToDDBSync` jobs of the legacy Python `lem.py` utility.

Each run loads every Neon individual account (API v2 account search, about 20
requests) and the whole participant table, works out the changes in a pure
planning step ([src/reconcile.ts](src/reconcile.ts)), then applies them.

## What it changes

**Accounts.** Neon accounts flagged *Do Not Contact* or *Deceased* are ignored. Every
other account is matched to a participant by `neonId`:

- **Matched, subscribed participants** get any missing flags from the Neon custom
  fields listed in [src/programs.ts](src/programs.ts): `programs.<program>.<flag> = true`,
  and `vajrayana` set to the Neon dropdown value. An existing `vajrayana` value is
  never overwritten.
- **Unmatched accounts** become new participants. Exceptions:
  - If a participant already has the same first and last name, or the same email,
    the account is reported as a `possibleDuplicate` and someone has to link it by hand.
  - Accounts whose names match `NEON_SYNC_EXCLUDE_*` are skipped.
  - Accounts with no email are skipped.

**Emails.** When a participant's email (compared trimmed and case-insensitively)
differs from their Neon account's *Email 1*, the participant takes the Neon address.
Any `emails.<campaign>` send markers from the last `NEON_SYNC_RESEND_WINDOW_DAYS`
are removed, so those campaigns go out again to the corrected address. The update
is skipped if another participant already uses the address.

Every write is conditioned on the state it was planned from. A record edited
during the run is reported as a conflict and left untouched.

**Safety limits.** A run that plans more than `NEON_SYNC_MAX_CREATES` creates or
`NEON_SYNC_MAX_EMAIL_UPDATES` email updates writes nothing and exits with status 2.
Review it with `--dry-run`, then rerun with `--force`.

## Running locally

Requires Node.js 24, which runs the TypeScript directly with no build step.

```bash
cp .env.example .env    # then fill in; .env is gitignored
pnpm install
pnpm dry-run            # plan only
pnpm start              # apply
pnpm start -- --help    # all options (--only, --participant, --force, --verbose)
pnpm test && pnpm typecheck
```

Logs list participant and Neon account ids only. `--verbose` adds names and
email addresses.

## Deploying to EC2 (Amazon Linux 2023)

From a checkout on your workstation:

```bash
apps/neon-sync/deploy/install.sh -i path/to/key.pem ec2-user@HOST
```

The script packages the app with its locked production dependencies and copies it
to `/opt/neon-sync`. It also installs Node.js 24 if needed, and sets up the
`neon-sync.service` (oneshot) and `neon-sync.timer` (every 30 minutes) units.

The first install creates `/etc/neon-sync/neon-sync.env` (root, mode 600) from
`.env.example`. Fill it in, dry-run, then enable the timer:

```bash
# on the host
sudo systemd-run --uid=ec2-user --pipe --wait -p EnvironmentFile=/etc/neon-sync/neon-sync.env /opt/neon-sync/bin/run.sh --dry-run
# from your workstation
apps/neon-sync/deploy/install.sh -i path/to/key.pem --enable ec2-user@HOST
```

To upgrade, rerun the install script. `/opt/neon-sync/REVISION` records the
deployed commit.

Logs: `journalctl -u neon-sync`. Schedule: `systemctl list-timers neon-sync.timer`.
To report runs to Cronitor, set `CRONITOR_MONITOR` in the env file.
