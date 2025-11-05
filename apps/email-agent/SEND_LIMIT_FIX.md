# Send Limit Handling Fix

## Problem

When the email agent hit the 24-hour send limit during a "Send-Continuously" operation, it would continuously retry immediately instead of backing off and waiting. This caused the error message to appear repeatedly:

```
24-hour send limit reached for account 'connect'. Sent 1961/1500 emails in the last 24 hours. Please wait before sending more emails.
```

## Root Cause

In `send_base.py`, when the 24-hour send limit is reached, an exception is raised (line 68):

```python
if emails_sent_in_last_24h >= SMTP_24_HOUR_SEND_LIMIT:
    error_message = f"24-hour send limit reached..."
    raise Exception(error_message)
```

This exception was caught by the generic exception handler in `step_processor.py` (line 170), which marked the step as ERROR. When a step has ERROR status, the work order is picked up again immediately in the next polling cycle, creating a retry loop.

## Solution

Modified `step_processor.py` to detect the send limit exception and handle it specially when `sendContinuously` is enabled:

1. **Detect send limit errors**: Check if the exception message contains "24-hour send limit reached"
2. **Check sendContinuously mode**: Only apply special handling if the work order has `sendContinuously = True`
3. **Put work order to sleep**: Instead of marking as ERROR, mark as SLEEPING with the configured `sendInterval` (default: 600 seconds / 10 minutes)
4. **Add to sleep queue**: Ensure the work order is added to the sleep queue so it will be retried later
5. **Handle sendUntil exceeded**: If the `sendUntil` time has been exceeded when the send limit is hit, mark the work order as COMPLETE instead of sleeping

## Behavior After Fix

### When Send Limit is Hit During sendContinuously:

**Before sendUntil is exceeded:**
- Work order is put to SLEEPING status
- Sleep duration: `sendInterval` (default 10 minutes from `EMAIL_CONTINUOUS_SLEEP_SECS`)
- Status message: "24-hour send limit reached for account 'connect'. Sent X/Y emails in the last 24 hours. Please wait before sending more emails. Sleeping until [timestamp]"
- Work order is added to sleep queue
- Agent will retry after the sleep interval

**After sendUntil is exceeded:**
- Work order is marked as COMPLETE
- Status message shows the send limit was reached
- Work order is unlocked and won't retry

### When Send Limit is Hit (NOT sendContinuously):
- Work order is marked as ERROR (previous behavior)
- User must manually retry or fix the issue

## Configuration

The sleep interval when hitting send limits uses the same configuration as successful sends:

- **Default**: `EMAIL_CONTINUOUS_SLEEP_SECS` environment variable (default: 600 seconds = 10 minutes)
- **Per-work-order override**: `sendInterval` field on the work order

## Code Changes

**File**: `apps/email-agent/src/step_processor.py`

**Location**: Exception handler for "Send" step (lines 170-216)

**Key Logic**:
```python
if "24-hour send limit reached" in error_message and getattr(work_order, 'sendContinuously', False):
    # Put work order to sleep instead of marking as error
    # Uses sendInterval or EMAIL_CONTINUOUS_SLEEP_SECS
    # Adds to sleep queue for automatic retry
```

## Testing

To verify the fix works:

1. Set up a work order with `sendContinuously: true` and `sendUntil` set to a future time
2. Ensure the account hits the 24-hour send limit
3. Observe that the work order:
   - Enters SLEEPING status (not ERROR)
   - Shows the send limit message with sleep time
   - Retries after the configured interval
   - Eventually completes when sendUntil is reached

## Related Files

- `apps/email-agent/src/step_processor.py` - Main fix location
- `apps/email-agent/src/steps/send_base.py` - Where send limit is checked and exception raised
- `apps/email-agent/src/config.py` - Contains `EMAIL_CONTINUOUS_SLEEP_SECS` configuration

