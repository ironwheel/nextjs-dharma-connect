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

- `--from-campaign`: The campaign key to rename from (required)
- `--to-campaign`: The campaign key to rename to (required)
- `--dryrun`: Show what would be changed without making actual changes
- `--id`: Process only the student with the specified ID

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