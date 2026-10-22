# unsubscribe

The page behind the unsubscribe link in every event email footer: `https://<this app's host>/?pid=<participant id>`.
It asks the participant to confirm, then sets `unsubscribe: true` and `unsubscribeTS` (ISO-8601 UTC) on their
participant record. The same link lets an unsubscribed participant re-subscribe, which sets `unsubscribe: false`
and `resubscribeTS` (`unsubscribeTS` is kept). Each change is logged to the activity log as
`student.unsubscribed` / `student.resubscribed`, with the participant's eligibility for the refuge, oath, psb and
amitayus-lung pools (see [docs/ACTIVITY_LOG.md](../../docs/ACTIVITY_LOG.md)).

Links carry only a pid, so the host is configured without a hash (`secret: "none"`) and with silent sessions.
To keep that safe, the app uses two dedicated API actions rather than the generic table actions. Both act only
on the requesting pid, return nothing beyond the participant's first name and subscription state, and never
create a participant record (`packages/api/lib/unsubscribe.ts`):

- `GET /api/unsubscribe/status`
- `POST /api/unsubscribe/set` with body `{ "unsubscribe": true | false }`

The legacy unsubscribe page only recorded requests in its own table and never updated participant records.
This app does not use that table. Requests made there before the legacy page was redirected here are applied
with `utils/process_unsub_backlog.py`, after which the table is history only.

## Local development

```bash
# apps/unsubscribe/.env (gitignored)
NEXT_PUBLIC_API_URL=<API base URL>
NEXT_PUBLIC_APP_HOST=<this app's production host>   # token scope while running on localhost
NEXT_PUBLIC_CONTACT_EMAIL=<address shown for questions>   # optional

pnpm dev:unsubscribe
```

## One-time setup

1. **Actions profile** `unsubscribe` in the actions-profiles table, with its app role:
   - `GET/unsubscribe/status`
   - `POST/unsubscribe/set`
2. **App role:** create it with `packages/api/utils/createAppRole.ts unsubscribe`. That grants read and update on
   the participants table, Scan on the pools table, and PutItem on the activity log table.
3. **Host mapping:** add an app-actions entry mapping the host to the `unsubscribe` profile.
4. **Permitted hosts:** add the host to every auth record (`utils/add_permitted_host.py --add-host <host>`), since
   a participant's own auth record overrides the default one.
5. **API settings:** add the host to the API's `APP_ACCESS_JSON` with `"secret": "none"` and
   `"sessionMode": "silent"`, and to `CORS_ORIGIN_LIST`, then redeploy the API.
6. **Vercel:** create a project with root directory `apps/unsubscribe` and the domain. Set `NEXT_PUBLIC_API_URL`
   (and optionally `NEXT_PUBLIC_CONTACT_EMAIL`), and expose system environment variables.
