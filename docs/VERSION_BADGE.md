# Version badge

Every admin app, and the student dashboard's top bar, shows a "Version …" badge (`VersionBadge` in
`sharedFrontend`). Clicking it opens the version history. Everything it shows is read from git, so there is
no record of versions to keep in step by hand.

## How it works

1. **The build knows only its commit.** Each badge app's `next.config.js` maps Vercel's build-time
   `VERCEL_GIT_COMMIT_SHA` to `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, falling back to `localhost`. A value that is
   not a 40-character SHA (a local build) renders "Version localhost" and makes no request.
2. **The API answers the rest:** `GET /api/deploy/version?sha=<40 hex>` (`packages/api/lib/versionInfo.ts`),
   behind the usual session check. It refuses a malformed `sha` with 400 and otherwise always answers 200,
   putting anything it could not resolve into `reason` (shown as an amber notice).
3. **Label:** the release tag when the build's commit is exactly a release, otherwise the short SHA
   (`dev · abc1234` when `VERSION_ENVIRONMENT=dev`).
4. **History:**
   - **No release tags (today):** the pull requests most recently merged on the tracked branch, newest first
     and grouped by day. They come from the branch's first-parent line, so each pull request appears once, as
     the merge or squash commit that landed it. The one this build is marked "Current".
   - **With `release-YYYY-MM-DD[.N]` annotated tags:** the newest 20 releases, each with its tag message
     (`Promoted to release by …`, `Run: …`, then a reason) and the pull requests since the previous release.
     Nothing in the code changes when the first such tag appears.
5. **Caching** (per API instance): the tag list and the branch's recent merges for five minutes; tag
   annotations, release comparisons and commit details for the life of the instance.

Tests: `pnpm --filter api test` (stubbed GitHub; no network).

## Configuration (API project)

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | none | Read-only *Contents* access to the repository. Without it the badge shows its label and the reason, and no history. |
| `VERSION_GITHUB_REPO` | `ironwheel/nextjs-dharma-connect` | `owner/name` to read |
| `VERSION_GITHUB_BRANCH` | `main` | The branch deployments are built from |
| `VERSION_ENVIRONMENT` | `production` | `dev` prefixes non-release labels with `dev ·` |

## Access

Each app's actions profile needs `GET/deploy/version`. To add it to every profile that already has the old
badge grant (`GET/table/versions`), from `packages/api`:

```bash
node utils/addProfileAction.ts GET/deploy/version --like GET/table/versions          # dry run
node utils/addProfileAction.ts GET/deploy/version --like GET/table/versions --apply
```

The route reads only GitHub, so app roles need no new AWS permissions.

## Retiring the `versions` table

The badge no longer reads the `versions` table. Once the new badge is live everywhere, the
`GET/table/versions` grants, the table's `tableConfig` entry and its read access in `createAppRole.ts` can go.
Its hand-written `headline`/`features`/`fixes` notes have no equivalent in git; keep the table if they are
wanted, or carry them into release tag messages if releases are adopted.
