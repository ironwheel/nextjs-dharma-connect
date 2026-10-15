# activity-log

A stand-alone, read-only view of the shared activity log (see [docs/ACTIVITY_LOG.md](../../docs/ACTIVITY_LOG.md)),
for admins who troubleshoot student inquiries and check that services are working, without access to
student-manager. It uses the same `ActivityLog` component (from `sharedFrontend`) as student-manager's panel.

Access is granted per user like any other app: add this app's host to the user's permitted hosts in
student-manager. Email addresses are shown only to users whose auth config for this host sets `emailDisplay`.

## Local development

```bash
# apps/activity-log/.env (gitignored)
NEXT_PUBLIC_API_URL=<API base URL>
NEXT_PUBLIC_APP_HOST=<this app's production host>   # token scope while running on localhost

pnpm dev:activity-log
```

## One-time setup

1. **Actions profile** `activity-log` in the actions-profiles table, with its app role:
   - `GET/table/activity-log`: the log
   - `POST/auth/getConfigValue`: the per-user `emailDisplay` setting
   - `GET/table/versions`: the version badge
2. **App role:** create it with `packages/api/utils/createAppRole.ts activity-log`. That grants Query on
   the activity table and its index, and read access to the versions table.
3. **Host mapping:** add an app-actions entry mapping the host to the `activity-log` profile.
4. **API settings:** add the host to the API's `APP_ACCESS_JSON` (default email-verification sessions) and
   `CORS_ORIGIN_LIST`, then redeploy the API.
5. **Vercel:** create a project with root directory `apps/activity-log` and the domain. Set
   `NEXT_PUBLIC_API_URL`, and expose system environment variables (the version badge reads
   `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`).
6. **student-manager:** add the host to the default auth record's config, so student-manager offers it
   when editing a user's permitted hosts.
