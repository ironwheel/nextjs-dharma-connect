# Video access sync: plan (parked)

Status: **parked**. Nothing is built yet. This captures the analysis so the work can
resume without the legacy code, which lived only on a retired host.

The sync grants and revokes video access on the media WordPress site, which runs the
Restrict Content Pro (RCP) plugin. Students who are entitled to an event's recordings get
an RCP membership at that video's RCP level. Students who are no longer entitled lose it.

## What the legacy job did

The legacy job was a daily cron run of a Python utility with `-vaccesssync -lookForNewKMAccounts`.

For every event, it took the sub-events (or `config.whichRetreatsConfig` entries, when
present) that have an `rcpLevel`. For each subscribed participant, it decided whether they
were entitled to that video:

1. If the sub-event had a `videoAccessPool`, entitlement meant eligibility for that pool.
2. Otherwise, if the event had `config.eligibleOnlyMediaAccess`, entitlement meant
   eligibility for `config.pool`.
3. Otherwise, entitlement meant an offering for the sub-event:
   - **whichRetreats events:** the participant selected the retreat
     (`programs.<aid>.whichRetreats.<subEvent>`) and has
     `programs.<aid>.offeringHistory.retreat`. Installments events
     (`config.offeringPresentation == 'installments'`) require its `offeringSKU`.
   - **other events:** `programs.<aid>.offeringHistory.<subEvent>` exists (any value; the SKU is not required).
   - **companion events:** `subEvents.<subEvent>.offeringCompanionAID` / `offeringCompanionSubEvent`
     name another event's sub-event whose offering also counts.

Each participant's RCP state is mirrored on the participant record as `kmCache`:
`{ cid: <RCP customer id, string>, levels: [<RCP level numbers>] }`. The student dashboard reads it.

What it did with each decision:

- **Entitled, level not in `kmCache.levels`:** create an RCP membership (`customer_id`,
  `object_id` = level, `status` active), then append the level to `kmCache.levels`.
- **Not entitled, level in `kmCache.levels`:** delete every RCP membership the customer has
  at that level, then remove the level from `kmCache.levels`.
- **Entitled, but no `kmCache`:** look up the RCP customer by the participant's email (each
  participant at most once per run). If found, build `kmCache` from the customer's memberships,
  then create the membership if needed.

RCP REST endpoints used (all under `<host>/wp-json/rcp/v1/`, HTTP Basic auth with a WordPress application password):

| Purpose | Request |
|---|---|
| Find customer by email | `GET customers?user_email=<email>` (legacy treated the response as one customer with `id` and `memberships`) |
| One membership | `GET memberships/<id>`: `object_id` is the level |
| A customer's memberships | `GET memberships?customer_id=<cid>&number=1000` |
| Grant | `POST memberships/new?customer_id=&object_id=&status=active&notes=` |
| Revoke | `DELETE memberships/delete/<membership id>` |

## Why it stopped working

- It crashed on startup: its participant loader required `unsubscribe` on every record.
- The WordPress user it authenticated as no longer exists on the media site (`401 invalid_username`).
  The API's `KM_RCP_API_KEY` is the same credential. `packages/api/lib/rcp.ts` has no callers, so nothing live depends on it.
- Its pool checker supported only `true`, `pool`, `offering`, `oath` and `join`, and exited on
  anything else. Current video pools also use `offeringwhich` and `specifiedAIDBool`.

## Configuration at time of analysis

- 151 video sub-events with an `rcpLevel`, using 122 distinct levels. 20 levels are shared by
  more than one sub-event (up to 5).
- Entitlement: offering 98 (6 via companion events), whichRetreats offering 43, event pool 8, video pool 2.
  10 of the video events use installments.
- About 1,400 participants have a `kmCache`, and about 1,600 subscribed participants do not.

## Proposed design

`apps/video-access-sync`, built the same way as `apps/neon-sync`: Node.js 24 TypeScript with no build step, a pure
planning step with unit tests, `--dry-run`, per-run safety limits with `--force`, activity log entries,
and a systemd service and timer installed by `deploy/install.sh`.

1. **Decide per participant per level, not per sub-event.** A participant is entitled to a
   level if *any* sub-event with that level entitles them. The legacy per-sub-event loop revoked
   and re-granted shared levels depending on processing order.
2. **Use the current pool rules.** Use the same rules as `packages/sharedFrontend/src/eligible.ts`
   (`checkEligibility`). Node cannot import it from `sharedFrontend`: the package pulls in front-end
   dependencies, and Node does not strip types under `node_modules`. So keep a copy in the service,
   with a test that runs both implementations over the same fixtures and fails if they disagree.
3. **Read actual RCP state** (bulk membership listing, if the API supports it) instead of trusting
   `kmCache` alone, so memberships granted or removed by hand are seen. Keep `kmCache` updated for the dashboard.
4. **Revoke what is no longer earned**, as the legacy job did, but only memberships at levels the
   sync manages (levels configured on some video sub-event).
5. **Link unlinked participants** by email lookup each run, as the legacy `-lookForNewKMAccounts` did.
6. **Write activity log entries** (`docs/ACTIVITY_LOG.md`):
   - `access.rcpLevel` for grants, with `details: { level, eventCode, subEvent }`
   - `access.rcpLevelRemoved` for revocations
   - `access.accountLinked` when a `kmCache` is created
   - `sync.run`, `sync.blocked` and `sync.failed`, as in neon-sync

Configuration: `STUDENT_TABLE`, `EVENTS_TABLE`, `POOLS_TABLE`, `KM_RCP_API_HOST`, `KM_RCP_API_KEY`
(base64 `user:application-password`, the API's format), `ACTIVITY_LOG_TABLE`, and safety limits.

## Before resuming

1. Create a WordPress application password on the media site for a user who can manage RCP customers and memberships.
2. Verify the RCP response shapes read-only: customer lookup by email, bulk membership listing and its pagination, and membership `status` values.
3. Decide the schedule (the legacy job ran daily; hourly would grant access the same day) and the safety limits.
4. Dry-run first. The first run will carry a backlog of grants and revocations; review the counts, then do a forced first run, as with neon-sync.
