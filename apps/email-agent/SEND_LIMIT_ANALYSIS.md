# Analysis: Why 1961 Emails Were Sent with a 1500 Limit

## Summary

The email agent was able to send **1961 emails** despite having a **1500 email limit** because the limit check only happens **once at the start** of each send operation, not during the email sending loop. This allows a single batch to exceed the limit by hundreds of emails.

## Root Cause

### The Limit Check Location

The 24-hour send limit check occurs in `send_base.py` at lines 60-71:

```python
# For actual sends (not dry-runs), check the 24-hour send limit for this account
if not self.dryrun and work_order.account:
    await self._update_progress(work_order, f"Checking 24-hour send limit...")
    emails_sent_in_last_24h = self.aws_client.count_emails_sent_by_account_in_last_24_hours(work_order.account)
    
    if emails_sent_in_last_24h >= SMTP_24_HOUR_SEND_LIMIT:
        error_message = f"24-hour send limit reached..."
        raise Exception(error_message)
    
    remaining = SMTP_24_HOUR_SEND_LIMIT - emails_sent_in_last_24h
```

**This check happens ONLY ONCE** - at the very beginning of the `process()` method, before any emails are sent.

### The Email Sending Loop

After the limit check passes, the code proceeds to send emails in a loop (lines 135-168):

```python
for i, student in enumerate(eligible_students):
    # ... send email to student ...
    if success:
        emails_sent += 1
        total_emails_sent += 1
        # Record the sent email
        self.aws_client.append_send_recipient(campaign_string, entry, work_order.account)
```

**No limit checking occurs during this loop.** The loop processes ALL eligible students for the current language, which could be hundreds of emails.

### Why the Limit Was Exceeded by 461 Emails

Here's the likely scenario:

1. **Work order wakes up** (in sendContinuously mode)
2. **Initial check:** Count shows 1400 emails sent in last 24 hours
3. **Check passes:** 1400 < 1500, so proceed with sending
4. **Eligible students found:** Let's say 500+ students are eligible for this batch
5. **All emails sent:** Agent sends ALL 500+ emails without rechecking the limit
6. **Total sent:** 1400 + 500+ = 1900+ emails
7. **Next wake-up:** Count shows 1961 emails sent
8. **Check fails:** 1961 >= 1500, raises exception

The overage of **461 emails** (1961 - 1500) represents the size of the batch that was processed after passing the initial limit check.

## Additional Contributing Factors

### 1. Multiple Languages

The send loop processes each language sequentially (line 104):

```python
for lang in work_order.languages.keys():
    # ... find eligible students for this language ...
    # ... send ALL emails for this language ...
```

If multiple languages are enabled, the overage can be multiplied. For example:
- English: 200 eligible students
- French: 150 eligible students  
- Spanish: 111 eligible students
- **Total batch: 461 emails**

### 2. Burst Control Doesn't Help

There is burst control code (lines 180-182):

```python
if (i + 1) % EMAIL_BURST_SIZE == 0 and i + 1 < len(eligible_students):
    # Sleep for EMAIL_RECOVERY_SLEEP_SECS
```

However, this only adds delays between bursts of emails (default: sleep after every 10 emails). It does **not** recheck the send limit.

### 3. sendContinuously Mode Exacerbates the Issue

In `sendContinuously` mode:
- Work order sleeps for `sendInterval` (default: 10 minutes)
- Wakes up and checks limit again
- If under limit, sends another full batch
- This can happen multiple times before the 24-hour rolling window causes old emails to age out

So the pattern might be:
- **Wake 1:** 1000 sent → passes check → sends 300 more → 1300 total
- **Wake 2:** 1300 sent → passes check → sends 250 more → 1550 total (exceeds!)
- **Wake 3:** 1550 sent → **fails check** → exception raised

But you're already over the limit from Wake 2.

### 4. DynamoDB Count Performance

The `count_emails_sent_by_account_in_last_24_hours()` method (lines 848-905 in `aws_client.py`) does a full table scan:

```python
response = table.scan()  # Scans entire send_recipients table
```

While this is happening (could take seconds for a large table):
- The count represents emails sent BEFORE the scan started
- New emails are being added to the table as they're sent
- The count becomes stale immediately after the check

However, this is a minor factor compared to the main issue.

## Mathematical Example

Let's walk through a concrete example:

**Scenario:**
- SMTP_24_HOUR_SEND_LIMIT: 1500
- Current emails sent: 1400
- Languages enabled: English, French, Spanish
- Eligible students per language: ~154

**What Happens:**

1. **Limit check:** 1400 < 1500 ✓ (passes, remaining = 100)
2. **Send English emails:** 1400 + 154 = 1554 emails
3. **Send French emails:** 1554 + 154 = 1708 emails  
4. **Send Spanish emails:** 1708 + 154 = 1862 emails
5. **Final count:** 1862 emails sent
6. **Overage:** 1862 - 1500 = **362 emails over the limit**

If there were a few more eligible students or additional languages, you'd easily reach the 461 overage you observed (1961 - 1500 = 461).

## Why This Design Exists

The current design likely assumes:
- Most send operations are one-time sends with predictable batch sizes
- The burst control would naturally limit the rate
- The check at the start provides "good enough" protection

However, with `sendContinuously` mode and large eligible student lists, this assumption breaks down.

## Implications

### When the Limit is Actually Enforced

The limit is enforced on the **next wake-up** of a sendContinuously work order, not during the current batch. So:

- **First batch that exceeds:** Sends all emails (no interruption)
- **Next batch:** Fails the initial check, raises exception
- **With the recent fix:** Work order goes to sleep instead of error

### Gmail/SMTP Provider Impact

If the SMTP provider (Gmail) has a hard limit of 1500 emails per day:
- Sending 1961 emails could result in:
  - Last 461 emails being rejected by the SMTP server
  - Account being temporarily blocked or flagged
  - Rate limiting errors (like the 421 error code handled in `email_sender.py`)

However, your error message suggests all 1961 emails were successfully sent and recorded in DynamoDB, which means:
- Either the SMTP provider's limit is higher than 1500
- Or there's a soft limit that wasn't enforced
- Or the emails were sent over a period where some 24-hour-old emails aged out

## Key Finding

**The 24-hour send limit is a "soft limit" that prevents starting a new batch, but does NOT limit the size of the current batch being sent.**

## Recommendations for Future Fixes

Without making code changes now, here are the issues that would need to be addressed:

1. **Periodic limit checking during send loop**
   - Check limit every N emails (e.g., every 50 emails)
   - Stop sending immediately when limit is reached
   - Save progress and put work order to sleep

2. **Pre-calculate batch size**
   - Before sending, calculate: `emails_to_send = len(eligible_students)`
   - Check: `current_count + emails_to_send <= limit`
   - Only proceed if the entire batch will fit under the limit

3. **Account for multi-language batches**
   - Calculate total eligible students across ALL enabled languages
   - Use that total for the limit check

4. **Reserve capacity**
   - Check: `current_count + emails_to_send <= (limit - safety_margin)`
   - Safety margin could be 10% or 100 emails

5. **Per-language limit checking**
   - Check limit before starting each language
   - Stop between languages if limit reached

The most robust solution would be #1 (periodic checking during the loop) combined with #2 (pre-calculation), as this handles both planned and unplanned overages.

