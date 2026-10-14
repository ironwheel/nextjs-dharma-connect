# Activity log

A single DynamoDB table where backend services record notable system activity. Operators
browse and search it in the student-manager app, below the student list.

Services write to the table directly with their own credentials. The API exposes it
**read-only** through the `activity-log` resource.

## Table

| | |
|---|---|
| Partition key | `day` (S): UTC date of the event, `YYYY-MM-DD` |
| Sort key | `id` (S): `<ISO-8601 UTC timestamp>#<6 hex chars>`, e.g. `2026-10-13T19:48:21.403Z#a1b2c3` |
| GSI `studentId-id-index` | partition `studentId` (S), sort `id` (S), projection ALL |
| TTL attribute | `expiresAt` (N, epoch seconds) |
| Billing | on demand |

The UI reads newest-first one day partition at a time, and polls today's partition for
ids greater than the newest one it already has. The GSI powers the per-student view.

Create it (replace `<table>` with the real name, which is configured through env vars and never committed):

```bash
aws dynamodb create-table --table-name <table> --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=day,AttributeType=S AttributeName=id,AttributeType=S AttributeName=studentId,AttributeType=S \
  --key-schema AttributeName=day,KeyType=HASH AttributeName=id,KeyType=RANGE \
  --global-secondary-indexes 'IndexName=studentId-id-index,KeySchema=[{AttributeName=studentId,KeyType=HASH},{AttributeName=id,KeyType=RANGE}],Projection={ProjectionType=ALL}'
aws dynamodb wait table-exists --table-name <table>
aws dynamodb update-time-to-live --table-name <table> \
  --time-to-live-specification Enabled=true,AttributeName=expiresAt
```

## Record format

| Attribute | Required | Notes |
|---|---|---|
| `day`, `id` | yes | Keys, as above. Derive both from one timestamp. |
| `ts` | yes | The same ISO timestamp, for display. |
| `type` | yes | Event type; see below. |
| `source` | yes | Writer: `neon-sync`, `email-agent`, `register`, `video-access-sync`, … |
| `summary` | yes | One human-readable line. **Never include email addresses.** |
| `studentId` | when about a student | Participant id. Required for the per-student view. |
| `studentName` | when about a student | `first last` at the time of the event. |
| `details` | no | Map of structured context. Email addresses go only in the keys `email`, `previousEmail`, `to` or `recipient`. |
| `searchText` | yes | Lowercased `type`, `source`, `studentName`, `studentId`, `summary`, and string/number `details` values, **excluding** the email keys. |
| `expiresAt` | yes | Epoch seconds. Default retention is 365 days. |

Email addresses are kept out of `summary` and `searchText`. The student-manager shows them
(and matches searches against them) only for operators with the `emailDisplay` permission.

Writes are best effort. A failed activity write must never fail the operation it describes.

## Event types

| `type` | Source | Meaning | Typical `details` |
|---|---|---|---|
| `student.created` | neon-sync | New participant created from a Neon account | `neonId`, `email`, `programs`, `vajrayana` |
| `student.emailChanged` | neon-sync | Participant email replaced with the Neon address | `neonId`, `previousEmail`, `email`, `clearedSends` |
| `student.updated` | neon-sync | Program flag or vajrayana level copied from Neon | `neonId`, `field`, `value` |
| `email.sent` | email-agent | A campaign email was sent to a participant | `campaign`, `account`, `language`, `to` |
| `registration.submitted` | register (via API) | Participant completed registration for an event | `eventCode`, `eventName`, `submitCount`, `retreats`, `joinMY`, `joinVY` |
| `auth.signIn` | api | Participant signed in to an app listed in `ACTIVITY_LOG_SIGNIN_APPS`: a new email-verified session, or a fresh access token on a new visit with an existing session. Logged once per participant, device and app per 10 minutes. | `app` (actions profile), `method` (`email-verification`, `session`, `silent-session`) |
| `access.rcpLevel` | video-access-sync | Participant gained a new video access level | `level`, `previousLevel` |
| `sync.run` | any service | Summary of a run that changed something | counts |
| `sync.blocked` | any service | A run refused to write (safety limit) | counts |
| `sync.failed` | any service | A run failed | — |

New types need no schema change. The UI shows unknown types under their raw name, and
labels for new types can be added in `apps/student-manager/components/ActivityLog.tsx`.

## Access

- **Student-manager:** the `student-manager` actions profile needs `GET/table/activity-log`.
  Its app role needs `dynamodb:Query` on the table and `<table>/index/*`.
  `packages/api/utils/createAppRole.ts` derives this from the profile.
  Do not grant `POST/table/activity-log`: generic POST table operations include writes.
- **API:** `DYNAMODB_TABLE_ACTIVITY_LOG` names the table.
- **Writers:** need `dynamodb:PutItem` on the table. neon-sync and email-agent both read the table name from `ACTIVITY_LOG_TABLE`.
- **Sign-ins:** set `ACTIVITY_LOG_SIGNIN_APPS` on the API to a comma-separated list of actions profiles
  (e.g. `student-dashboard`). Nothing is logged for apps not listed. The API writes the entry after
  responding (`waitUntil`) with the app's role, which needs `dynamodb:PutItem` on the activity table and
  `GetItem` on participants. Concurrent requests from one page load are deduplicated with short-lived
  marker items in the `_dedupe` partition, which the UI never reads.
- **Register app:** browsers never write to the table. After saving a registration, the register app calls
  `POST /api/activity/registration` with `{ eventCode }`. The API logs the event for the authenticated
  participant only if their record shows `programs.<eventCode>.join` with a `submitTime` from the last
  15 minutes. The sort key is derived from that submission, so repeat calls are ignored. The `register`
  actions profile needs `POST/activity/registration`, and its app role needs `dynamodb:PutItem` on the
  activity table, plus `GetItem` on participants and events. `createAppRole.ts` maps this.
