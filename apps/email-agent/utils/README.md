# Email Agent Utilities

This directory contains utility scripts for the email-agent system.

## rename_campaign.py

A utility script to rename campaign keys in student records stored in DynamoDB.

### Purpose

This script scans the student DynamoDB table and renames campaign keys in the `emails` field while preserving the timestamp values associated with each campaign. This is useful when you need to update campaign names across all student records.

### Usage

```bash
# Basic usage - rename a campaign across all students
python rename_campaign.py --from-campaign "old-campaign" --to-campaign "new-campaign"

# Dry run - see what would be changed without making changes
python rename_campaign.py --from-campaign "old-campaign" --to-campaign "new-campaign" --dryrun

# Process only a specific student
python rename_campaign.py --from-campaign "old-campaign" --to-campaign "new-campaign" --id "student-123"
```

### Arguments

- `--from-campaign`: The current campaign name to rename from
- `--to-campaign`: The new campaign name to rename to
- `--id`: (Optional) Process only a specific student by ID
- `--dryrun`: (Optional) Show what would be changed without making changes

### Examples

```bash
# Rename a campaign across all students
python rename_campaign.py --from-campaign "vt2024-retreat-reminder" --to-campaign "vt2024-retreat-reminder-v2"

# Test the changes first with dry run
python rename_campaign.py --from-campaign "test-campaign" --to-campaign "prod-campaign" --dryrun

# Update only a specific student record
python rename_campaign.py --from-campaign "test-campaign" --to-campaign "prod-campaign" --id "e271aea6-021e-4a7d-8269-79ee4aeae5bf"
```

### Requirements

- Python 3.6+
- boto3
- AWS credentials configured via profile (uses `AWS_PROFILE` from .env)
- `STUDENT_TABLE` environment variable set in .env

### How it works

1. **Scans the student table**: Either scans all students or gets a specific student by ID
2. **Checks for campaign keys**: Looks for the `from-campaign` key in each student's `emails` field
3. **Preserves timestamps**: Keeps the timestamp value intact while renaming the key
4. **Updates records**: Updates the DynamoDB record with the new campaign key
5. **Reports results**: Shows a summary of how many changes were made

### Safety features

- **Dry run mode**: Use `--dryrun` to see what would be changed without making actual changes
- **Single student processing**: Use `--id` to test on a single student first
- **Validation**: Ensures `--from-campaign` and `--to-campaign` are different
- **Error handling**: Gracefully handles errors and continues processing other records
- **Detailed logging**: Shows exactly what changes are being made

### Output

The script provides detailed output showing:
- Configuration summary
- Each student record being processed
- Success/error messages for each operation
- Final summary with total number of changes made

Example output:
```
Student table: students
From campaign: old-campaign
To campaign: new-campaign
Dry run: False
--------------------------------------------------
Scanning student table...
Found 1500 student(s) to process
--------------------------------------------------
SUCCESS: Renamed campaign 'old-campaign' to 'new-campaign' for student e271aea6-021e-4a7d-8269-79ee4aeae5bf (timestamp: 2024-01-15T10:30:00+00:00)
SUCCESS: Renamed campaign 'old-campaign' to 'new-campaign' for student f382b7f7-132f-5b8e-9370-8aff5bfbfbfc (timestamp: 2024-01-15T11:45:00+00:00)
--------------------------------------------------
SUMMARY: Made 2 changes
Successfully processed 2 student record(s)
```

## missing_campaign.py

A utility script to find students missing a specific campaign in their emails folder.

### Purpose

This script scans the student DynamoDB table and checks if each student has the specified campaign in their `emails` field. If a student is missing the campaign, their ID is printed. This is useful for identifying which students need to receive a particular email campaign.

### Usage

```bash
# Basic usage - find all students missing a campaign
python missing_campaign.py --campaign "campaign-name"

# Check only a specific student
python missing_campaign.py --campaign "campaign-name" --id "student-123"

# Ignore students who have unsubscribed from emails
python missing_campaign.py --campaign "campaign-name" --ignore-unsubscribed

# Ignore students with blank email fields
python missing_campaign.py --campaign "campaign-name" --ignore-missing-email

# Use both ignore flags together
python missing_campaign.py --campaign "campaign-name" --ignore-unsubscribed --ignore-missing-email
```

### Arguments

- `--campaign`: (Required) The campaign name to check for
- `--id`: (Optional) Check only the student with the specified ID
- `--ignore-unsubscribed`: (Optional) Ignore students who have unsubscribed from emails
- `--ignore-missing-email`: (Optional) Ignore students with blank email fields

### Output

The script outputs:
1. A list of student IDs missing the specified campaign
2. A summary showing the total count of students missing the campaign
3. If `--ignore-unsubscribed` is used, a count of unsubscribed students that were ignored
4. If `--ignore-missing-email` is used, a count of students with missing email that were ignored

### Examples

```bash
# Find all students missing the "vt2024-retreat-reminder" campaign
python missing_campaign.py --campaign "vt2024-retreat-reminder"

# Find students missing a campaign, but exclude unsubscribed students
python missing_campaign.py --campaign "newsletter-2024" --ignore-unsubscribed

# Find students missing a campaign, but exclude those without email addresses
python missing_campaign.py --campaign "welcome-email" --ignore-missing-email

# Find students missing a campaign, excluding both unsubscribed and those without emails
python missing_campaign.py --campaign "important-update" --ignore-unsubscribed --ignore-missing-email

# Check if a specific student has a campaign
python missing_campaign.py --campaign "welcome-email" --id "5f397b04-b1d4-464d-ab7d-fa7c71054a7a"
```

### Requirements

- Python 3.6+
- boto3
- AWS credentials configured via profile (uses `AWS_PROFILE` from .env)
- `STUDENT_TABLE` environment variable set in .env

### How it works

1. **Scans the student table**: Either scans all students or gets a specific student by ID
2. **Checks emails field**: Looks for the specified campaign key in each student's `emails` field
3. **Identifies missing campaigns**: Students without the campaign key are considered missing
4. **Reports results**: Prints the IDs of students missing the campaign and provides a summary

### Output

The script provides output showing:
- Configuration summary
- Student IDs that are missing the campaign (printed one per line)
- Final summary with total count of missing students

Example output:
```
Student table: foundations.participants
Campaign to check: test-campaign
--------------------------------------------------
Scanning student table...
Found 1500 student(s) to check
--------------------------------------------------
5f397b04-b1d4-464d-ab7d-fa7c71054a7a
47eb5dbd-87c3-411e-b69d-acf3ab69f738
54ee374f-5f27-4b25-b71b-fa85fc01941e
--------------------------------------------------
SUMMARY: Found 3 student(s) missing campaign 'test-campaign'
Students missing campaign 'test-campaign':
  - 5f397b04-b1d4-464d-ab7d-fa7c71054a7a
  - 47eb5dbd-87c3-411e-b69d-acf3ab69f738
  - 54ee374f-5f27-4b25-b71b-fa85fc01941e
```

### Use cases

- **Campaign auditing**: Verify which students received a particular campaign
- **Targeted campaigns**: Identify students who need to receive a specific campaign
- **Data validation**: Ensure campaign distribution is complete
- **Troubleshooting**: Debug issues with campaign delivery 