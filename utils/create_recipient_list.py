"""
@file utils/create_recipient_list.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility script to create recipient lists for a specific campaign.
"""

import argparse
import boto3
import os
import sys
from typing import Dict, Any, Optional
from pathlib import Path
from datetime import datetime

# Add the parent directory to the path so we can import config
sys.path.append(str(Path(__file__).parent.parent / 'src'))

from config import STUDENT_TABLE, AWS_REGION, AWS_PROFILE

SEND_TABLE = os.getenv('SEND_TABLE')
DRYRUN_TABLE = os.getenv('DRYRUN_TABLE')

if not SEND_TABLE or not DRYRUN_TABLE:
    print("ERROR: SEND_TABLE and DRYRUN_TABLE environment variables must be set.")
    sys.exit(1)

def get_dynamodb_client():
    """
    @function get_dynamodb_client
    @description Initializes and returns a DynamoDB client.
    @returns A DynamoDB client.
    """
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def scan_student_table(dynamodb, table_name: str) -> list:
    """
    @function scan_student_table
    @description Scans the student table and returns all items.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to scan.
    @returns A list of items from the table.
    """
    table = dynamodb.Table(table_name)
    students = []
    last_evaluated_key = None
    while True:
        scan_kwargs = {}
        if last_evaluated_key:
            scan_kwargs['ExclusiveStartKey'] = last_evaluated_key
        try:
            response = table.scan(**scan_kwargs)
            students.extend(response.get('Items', []))
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        except Exception as e:
            print(f"Error scanning student table: {e}")
            break
    return students

def add_recipient_entry(dynamodb, table_name: str, campaign: str, student: Dict[str, Any], sendtime: str, dryrun: bool = False):
    """
    @function add_recipient_entry
    @description Adds a recipient entry to the specified table.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to add the entry to.
    @param campaign - The campaign to add the recipient to.
    @param student - The student to add.
    @param sendtime - The send time for the email.
    @param dryrun - If True, only print what would be done without writing to DynamoDB.
    """
    entry = {
        'name': student.get('first', '') + ' ' + student.get('last', ''),
        'email': student.get('email', ''),
        'sendtime': sendtime,
    }
    if dryrun:
        print(f"[DRYRUN] Would add recipient to {table_name} for campaign '{campaign}': {entry}")
        return
    
    table = dynamodb.Table(table_name)
    try:
        # First, check if the campaign record exists and get current entries
        response = table.get_item(Key={'campaignString': campaign})
        existing_entries = []
        if 'Item' in response:
            existing_entries = response['Item'].get('entries', [])
        
        # Check if this email already exists in the entries
        email = entry['email']
        email_exists = any(existing_entry.get('email') == email for existing_entry in existing_entries)
        
        if email_exists:
            print(f"Skipped duplicate recipient in {table_name}: {email}")
            return
        
        # Add the new entry
        if existing_entries:
            # Update existing record by appending to entries
            table.update_item(
                Key={'campaignString': campaign},
                UpdateExpression='SET entries = list_append(entries, :entry)',
                ExpressionAttributeValues={
                    ':entry': [entry]
                }
            )
        else:
            # Create new record with entries array
            table.put_item(Item={
                'campaignString': campaign,
                'entries': [entry]
            })
        
        print(f"Added recipient to {table_name}: {email}")
    except Exception as e:
        print(f"Error adding recipient to {table_name}: {e}")

def main():
    """
    @function main
    @description The main function for the script.
    """
    parser = argparse.ArgumentParser(
        description='Create recipient lists for a specific campaign',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python create_recipient_list.py --campaign "vt2024-retreat-reminder"
        """
    )
    parser.add_argument(
        '--campaign',
        required=True,
        help='The campaign string to search for in student emails field'
    )
    parser.add_argument(
        '--dryrun',
        action='store_true',
        help='If set, only print what would be done without writing to DynamoDB'
    )
    args = parser.parse_args()

    if not STUDENT_TABLE:
        print("ERROR: STUDENT_TABLE environment variable is not set")
        sys.exit(1)

    print(f"Student table: {STUDENT_TABLE}")
    print(f"SEND_TABLE: {SEND_TABLE}")
    print(f"DRYRUN_TABLE: {DRYRUN_TABLE}")
    print(f"Campaign: {args.campaign}")
    print("-" * 50)

    try:
        dynamodb = get_dynamodb_client()
    except Exception as e:
        print(f"ERROR: Failed to initialize DynamoDB client: {e}")
        sys.exit(1)

    print("Scanning student table...")
    students = scan_student_table(dynamodb, STUDENT_TABLE)
    if not students:
        print("No students found.")
        sys.exit(0)
    print(f"Found {len(students)} student(s) to check")
    print("-" * 50)

    added_count = 0
    for student in students:
        emails = student.get('emails', {})
        if not isinstance(emails, dict):
            continue
        if args.campaign in emails:
            email_entry = emails[args.campaign]
            sendtime = ''
            if isinstance(email_entry, dict) and 'sendtime' in email_entry:
                sendtime = email_entry['sendtime']
            elif isinstance(email_entry, str):
                sendtime = email_entry
            else:
                print(f"[WARN] Student {student.get('id', '')} campaign entry for '{args.campaign}' is not a dict or string: {repr(email_entry)}")
                sendtime = ''
            add_recipient_entry(dynamodb, SEND_TABLE, args.campaign, student, sendtime, dryrun=args.dryrun)
            add_recipient_entry(dynamodb, DRYRUN_TABLE, args.campaign, student, sendtime, dryrun=args.dryrun)
            added_count += 1
    print("-" * 50)
    print(f"SUMMARY: Added {added_count} recipients to both {SEND_TABLE} and {DRYRUN_TABLE} for campaign '{args.campaign}'")

if __name__ == '__main__':
    main() 