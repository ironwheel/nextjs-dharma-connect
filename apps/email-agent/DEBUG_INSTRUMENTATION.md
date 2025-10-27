# Email-Agent Debug Instrumentation

This document describes the debugging instrumentation added to help debug why student `4080c768-1936-46dd-a7b3-a182eaf18191` is not receiving the welcome email for event `vr20251001`.

## What Was Added

### 1. Student Eligibility Tracking (`apps/email-agent/src/steps/shared.py`)
- Added detailed logging in `find_eligible_students()` function
- Tracks the target student through each eligibility check step
- Logs reasons for skipping the student at each stage
- Provides a summary of the student's eligibility status

### 2. Pool Eligibility Debugging (`apps/email-agent/src/eligible.py`)
- Added detailed logging in `check_eligibility()` function for `currenteventoffering` pool
- Logs the student's program data, offering history, and eligibility calculation
- Shows exactly why the student passes or fails the currenteventoffering check

### 3. Stage Filter Debugging (`apps/email-agent/src/steps/shared.py`)
- Added logging in `passes_stage_filter()` function
- Shows which pools are being checked and their results
- Helps identify if the student fails at the stage filtering level

### 4. Continuous Send Process Debugging (`apps/email-agent/src/steps/send_base.py`)
- Added logging in the continuous send process
- Shows work order details, campaign string, and stage record
- Tracks whether the target student is found in eligible students
- Logs the email sending process for the target student

## How to Use

### Option 1: Run the Debug Test Script
```bash
cd apps/email-agent
python debug_test.py
```

### Option 2: Run the Email Agent as a Module
```bash
cd apps/email-agent/src
python -m agent
```

### Option 3: Run from the Root Directory
```bash
cd apps/email-agent
python -m src.agent
```

### Option 4: Run with Python Path
```bash
cd apps/email-agent
PYTHONPATH=src python -c "import asyncio; from agent import EmailAgent; asyncio.run(EmailAgent().start())"
```

## What to Look For

When you run the email-agent, look for debug messages with the pattern `[DEBUG]` that include the student ID `4080c768-1936-46dd-a7b3-a182eaf18191`. The debug output will show:

1. **Student Data**: The complete student record from the database
2. **Eligibility Checks**: Step-by-step eligibility checking process
3. **Pool Results**: Detailed currenteventoffering pool evaluation
4. **Stage Filtering**: Stage-specific pool filtering results
5. **Email Sending**: Whether the student is processed for email sending

## Expected Debug Output

The debug output will help identify exactly where the student is being filtered out:

- If the student is not found in student data
- If the student is unsubscribed
- If the student has an empty email
- If the student already received the email
- If the student fails language eligibility
- If the student fails pool eligibility (currenteventoffering)
- If the student fails stage filtering

## Key Information to Check

1. **Student Programs**: Look for the student's program data for event `vr20251001`
2. **Offering History**: Check if the student has an offering for the correct subevent
3. **Offering SKU**: Verify the student has a valid offering SKU
4. **Withdrawn Status**: Ensure the student is not withdrawn from the program
5. **Stage Record**: Check the stage record configuration and pools

## Removing Debug Code

Once debugging is complete, you can remove the debug instrumentation by:

1. Removing all lines containing `[DEBUG]` comments
2. Removing the `target_student_id` variable declarations
3. Removing the `is_target_student` checks and associated print statements

The debug code is designed to be easily removable and doesn't affect the normal operation of the email-agent.
