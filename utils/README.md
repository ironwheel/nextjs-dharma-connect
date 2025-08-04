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

## mantra_config_writer.py

A utility script to write records to the AWS mantra-config DynamoDB table.

### Purpose

This script reads a JSON file containing mantra configuration records and writes them to the DynamoDB mantra-config table. The table name is accessed via the `MANTRA_CONFIG_TABLE` environment variable. This is useful for managing mantra configuration data that controls the display and behavior of mantra counting features in the application.

### Usage

```bash
# Basic usage - write records from JSON file
python mantra_config_writer.py --input mantra-config-records.json

# Dry run - see what would be written without making changes
python mantra_config_writer.py --input mantra-config-records.json --dry-run

# Delete all records from the table
python mantra_config_writer.py --delete-all

# Delete all records with dry run
python mantra_config_writer.py --delete-all --dry-run
```

### Arguments

- `--input`, `-i`: (Required for writing) Input JSON file containing records
- `--dry-run`: (Optional) Perform all operations except writing to the table
- `--delete-all`: (Optional) Delete all records from the table

### JSON Record Schema

Each record in the input JSON file must follow this schema:

```json
{
  "id": "seven-line-supplication",
  "displayNamePrompt": "mantraSevenLineSupplicationTitle",
  "descriptionPrompt": "mantraSevenLineSupplicationDescription",
  "bgColor": "bg-green-600",
  "borderColor": "border-green-500",
  "displayOrder": 2,
  "isActive": true,
  "incrementAmount": 100
}
```

### Required Fields

- `id`: Unique identifier for the mantra and database field name for storing counts (string)
- `displayNamePrompt`: Translation key for display name (string)
- `descriptionPrompt`: Translation key for description (string)
- `bgColor`: Background color CSS class (string)
- `borderColor`: Border color CSS class (string)
- `displayOrder`: Order for display (integer)
- `isActive`: Whether the mantra is active (boolean)
- `incrementAmount`: Amount to increment by (integer)

### Optional Fields

- `createdAt`: Creation timestamp (ISO 8601 string) - will be overwritten with current time
- `updatedAt`: Last update timestamp (ISO 8601 string) - will be overwritten with current time

**Note**: The `createdAt` and `updatedAt` fields will always be set to the current date/time when writing records, regardless of the values provided in the input JSON.

### Examples

```bash
# Write mantra configuration records
python mantra_config_writer.py --input mantra-config-records.json

# Test the write operation first
python mantra_config_writer.py --input mantra-config-records.json --dry-run

# Clear all existing records
python mantra_config_writer.py --delete-all

# Test the delete operation first
python mantra_config_writer.py --delete-all --dry-run
```

### Requirements

- Python 3.6+
- boto3
- python-dotenv
- AWS credentials configured via profile (uses `AWS_PROFILE` from .env, defaults to 'slsupport')
- `MANTRA_CONFIG_TABLE` environment variable set in .env

### How it works

1. **Loads JSON file**: Reads the input JSON file containing an array of records
2. **Validates records**: Checks each record against the required schema
3. **Connects to AWS**: Uses the configured AWS profile to connect to DynamoDB
4. **Writes records**: Writes each valid record to the mantra-config table
5. **Reports results**: Shows success/error messages for each operation

### Safety features

- **Dry run mode**: Use `--dry-run` to see what would be written without making actual changes
- **Record validation**: Validates all records against the required schema before writing
- **Error handling**: Gracefully handles errors and continues processing other records
- **Detailed logging**: Shows exactly what operations are being performed
- **Delete confirmation**: Use `--delete-all` with `--dry-run` to preview deletions

### Output

The script provides detailed output showing:
- AWS connection status and profile used
- Number of records loaded from the input file
- Validation results for each record
- Success/error messages for each write operation
- Final summary with total number of records processed

Example output:
```
Connected to AWS using profile: slsupport
Target table: mantra.config
Loaded 5 records from mantra-config-records.json
Found 5 valid records to write
Successfully wrote record: medicine-buddha
Successfully wrote record: seven-line-supplication
Successfully wrote record: condensed-supplication-tara
Successfully wrote record: pacifying-turmoil-mamos
Successfully wrote record: condensed-dispelling-obstacles
Successfully wrote 5 records to mantra.config
```

### Use cases

- **Initial setup**: Populate the mantra-config table with initial configuration
- **Configuration updates**: Update mantra settings and display properties
- **Data migration**: Import mantra configuration from external sources
- **Testing**: Use dry-run mode to validate configuration before deployment 