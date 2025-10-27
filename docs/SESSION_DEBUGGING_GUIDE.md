# Session Debugging Guide

## Overview

Enhanced logging has been added to the authentication system to help diagnose why sessions might be expiring prematurely. This guide explains what to look for in the logs.

## Configuration Values

Your current configuration should be:
- `ACCESS_TOKEN_DURATION`: 900 seconds (15 minutes)
- `SESSION_DURATION`: 86400 seconds (24 hours)
- `VERIFICATION_DURATION`: 900 seconds (15 minutes)

## Log Patterns to Monitor

### 1. Session Creation (During Login)

When a user successfully verifies via email, you'll see:

```
SESSION CREATION [pid=<user-id>]:
  - Creating new session after email verification
  - Created at: 2025-10-27T15:30:00.000Z (1730044200000)
  - TTL set to: 1730130600 (expires: 2025-10-28T15:30:00.000Z)
  - SESSION_DURATION_MS: 86400000 ms
  - Session duration: 86400 seconds (24.00 hours)
  - Device fingerprint: <fingerprint>
SESSION CREATION [pid=<user-id>]: Successfully created session in DynamoDB
```

**What to check:**
- Verify the TTL expiration is exactly 24 hours in the future
- Verify `SESSION_DURATION_MS` is 86400000 (24 hours in milliseconds)
- Confirm the session was successfully created in DynamoDB

### 2. Token Check (On Every API Request)

When a request comes in with an access token:

```
TOKEN CHECK [pid=<user-id>]: Access token provided, attempting verification for operation: GET/table/students
TOKEN CHECK [pid=<user-id>]: Verification result: VERIFY_OK
TOKEN CHECK [pid=<user-id>]: Token valid and operation permitted, user authenticated
```

**OR if token is expired:**

```
TOKEN CHECK [pid=<user-id>]: Access token provided, attempting verification for operation: GET/table/students
TOKEN VERIFICATION [pid=<user-id>]: Token expired
  - Error: jwt expired
  - Expired at: 2025-10-27T15:45:00.000Z
  - Current time: 2025-10-27T15:46:00.000Z
  - Expected ACCESS_TOKEN_DURATION: 900 seconds (15.00 minutes)
TOKEN CHECK [pid=<user-id>]: Verification result: VERIFY_ERR_EXPIRED
TOKEN CHECK [pid=<user-id>]: Token verification failed (VERIFY_ERR_EXPIRED), checking session for token refresh
```

**What to check:**
- Token expiration should be approximately 15 minutes after issue
- If tokens are expiring at unexpected intervals, this indicates ACCESS_TOKEN_DURATION misconfiguration

### 3. Session Check (When Token Needs Refresh)

When the access token expires or is missing, the system checks for a valid session:

```
SESSION CHECK [pid=<user-id>]:
  - Session found: YES
  - Session created: 2025-10-27T15:30:00.000Z (1730044200000)
  - Session age: 3600 seconds (1.00 hours)
  - Session TTL: 1730130600 (expires: 2025-10-28T15:30:00.000Z)
  - Current time: 1730047800 (2025-10-27T16:30:00.000Z)
  - Time until expiry: 82800 seconds (23.00 hours)
  - Expected SESSION_DURATION: 86400 seconds (24.00 hours)
  - Is expired: false
SESSION VALID [pid=<user-id>]: Refreshing access token
  - 82800 seconds remaining on session
```

**What to check:**
- **Session age** vs **Expected SESSION_DURATION**: If session age is close to 24 hours and still valid, system is working correctly
- **Time until expiry**: Should gradually decrease from 24 hours
- **Is expired**: Should be `false` until session truly reaches 24 hours

### 4. Session Expired (The Problem Case)

If sessions are expiring prematurely, you'll see:

```
SESSION CHECK [pid=<user-id>]:
  - Session found: YES
  - Session created: 2025-10-27T15:30:00.000Z (1730044200000)
  - Session age: 7200 seconds (2.00 hours)
  - Session TTL: 1730051400 (expires: 2025-10-27T17:30:00.000Z)
  - Current time: 1730051400 (2025-10-27T17:30:00.000Z)
  - Time until expiry: 0 seconds (0.00 hours)
  - Expected SESSION_DURATION: 86400 seconds (24.00 hours)
  - Is expired: true
SESSION EXPIRED [pid=<user-id>]: Deleting session and requiring re-verification
  - Reason: TTL (1730051400) <= current time (1730051400)
  - Session was valid for: 7200 seconds instead of expected 86400 seconds
```

**What to check:**
- **Session age** vs **Expected SESSION_DURATION**: If "Session was valid for: X seconds instead of expected 86400 seconds" shows a much smaller number, the TTL was set incorrectly at creation
- **Session TTL expiration time**: Calculate backwards from the TTL to see when the session should have been created
- Compare the calculated creation time with the actual "Session created" timestamp
- The difference between these times should equal SESSION_DURATION

### 5. No Session Found

If no session exists:

```
SESSION CHECK [pid=<user-id>]:
  - Session found: NO
  - Reason: No session record exists for pid=<user-id> with fingerprint=<fingerprint>
  - User will need to complete email verification to create a new session
```

**What to check:**
- This is normal for first-time access or after session truly expires
- If this happens frequently for the same user, check if:
  - Device fingerprint is changing between requests
  - DynamoDB is actually storing the session records
  - Network issues are preventing session lookup

## Debugging Scenarios

### Scenario A: Sessions Expire After Short Time (e.g., 2-3 hours)

**Look for:** Session creation logs showing incorrect TTL calculation

**Expected pattern:**
```
TTL set to: X (expires: Y)
Session duration: 86400 seconds (24.00 hours)
```

**Problem pattern:**
```
TTL set to: X (expires: Y)
Session duration: 7200 seconds (2.00 hours)  ⚠️ WRONG!
```

**Root cause:** `SESSION_DURATION` environment variable is not set to 86400 in the environment where the session was created.

### Scenario B: Sessions Not Found

**Look for:** Consistent "Session found: NO" messages

**Check:**
1. Is the session being created at all? Look for SESSION CREATION logs
2. Is the device fingerprint consistent? Compare fingerprints in creation vs lookup logs
3. Query DynamoDB directly to see if records exist

### Scenario C: Access Tokens Expire Too Quickly or Too Slowly

**Look for:** TOKEN VERIFICATION logs showing unexpected expiration times

**Expected pattern:**
```
Expected ACCESS_TOKEN_DURATION: 900 seconds (15.00 minutes)
```

**Problem pattern:**
```
Expected ACCESS_TOKEN_DURATION: 300 seconds (5.00 minutes)  ⚠️ Too short!
```
or
```
Expected ACCESS_TOKEN_DURATION: 86400 seconds (1440.00 minutes)  ⚠️ Too long!
```

**Root cause:** `ACCESS_TOKEN_DURATION` environment variable misconfigured

### Scenario D: Clock Skew Issues

**Look for:** TTL and current time being very close but causing unexpected expiration

**Check:**
- Compare timestamps in session creation vs session check
- Look for timezone inconsistencies (all times should be in UTC/ISO format)
- Check if server time matches actual time

## How to Collect Logs

### Vercel Deployment
1. Go to your Vercel dashboard
2. Select the API project
3. Go to "Logs" or "Functions" → "Real-time logs"
4. Reproduce the authentication issue
5. Search for "SESSION CHECK", "SESSION CREATION", or "TOKEN" keywords

### Local Development
1. Start your API with `pnpm dev` or similar
2. Watch the console output
3. Reproduce the issue
4. Console logs will show all authentication flows

## Next Steps After Collecting Logs

Once you see the logs, determine:

1. **Is SESSION_DURATION_MS correct at creation?** → If not, environment variable issue
2. **Is the TTL calculation correct?** → Compare (TTL - createdAt) against expected duration
3. **Are sessions being found?** → If not, check DynamoDB or fingerprint consistency
4. **Are tokens expiring at the expected 15-minute interval?** → If not, check ACCESS_TOKEN_DURATION

## Environment Variables Checklist

Verify in both local `.env` and Vercel settings:

- [ ] `ACCESS_TOKEN_DURATION=900`
- [ ] `SESSION_DURATION=86400`
- [ ] `VERIFICATION_DURATION=900`
- [ ] All three are set in the same environment
- [ ] No typos in variable names
- [ ] No spaces or quotes around numbers (should be: `VAR=900` not `VAR=" 900 "`)

