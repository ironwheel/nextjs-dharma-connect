"""
@file utils/rename_campaign_eligiible_recipients.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility script to rename campaignString keys containing "eligiible" to "eligible" in recipient tables.
"""

import argparse
import boto3
import os
import sys
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# AWS configuration
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
AWS_PROFILE = os.getenv('AWS_PROFILE', 'slsupport')  # Using slsupport profile as per user preference
DRYRUN_RECIPIENTS_TABLE = os.getenv('DRYRUN_RECIPIENTS_TABLE')
SEND_RECIPIENTS_TABLE = os.getenv('SEND_RECIPIENTS_TABLE')

if not DRYRUN_RECIPIENTS_TABLE:
    print("ERROR: DRYRUN_RECIPIENTS_TABLE environment variable must be set.")
    sys.exit(1)

if not SEND_RECIPIENTS_TABLE:
    print("ERROR: SEND_RECIPIENTS_TABLE environment variable must be set.")
    sys.exit(1)

def get_dynamodb_client():
    """
    @function get_dynamodb_client
    @description Get DynamoDB client using the configured AWS profile.
    @returns A DynamoDB client.
    """
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def scan_recipients_table(dynamodb, table_name: str) -> List[Dict[str, Any]]:
    """
    @function scan_recipients_table
    @description Scan a recipients table and return all records.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to scan.
    @returns A list of recipient records.
    """
    table = dynamodb.Table(table_name)
    records = []
    last_evaluated_key = None
    
    while True:
        scan_kwargs = {}
        if last_evaluated_key:
            scan_kwargs['ExclusiveStartKey'] = last_evaluated_key
        
        try:
            response = table.scan(**scan_kwargs)
            records.extend(response.get('Items', []))
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
                
        except Exception as e:
            print(f"Error scanning table {table_name}: {e}")
            break
    
    return records

def process_recipient_record(dynamodb, table_name: str, record: Dict[str, Any], dryrun: bool = False) -> bool:
    """
    @function process_recipient_record
    @description Process a single recipient record to rename campaignString containing "eligiible" to "eligible".
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table.
    @param record - The recipient record from DynamoDB.
    @param dryrun - If True, only count matches without making changes.
    @returns True if changes were made (or would be made in dryrun), False otherwise.
    """
    campaign_string = record.get('campaignString', '')
    
    # Check if the campaignString contains "eligiible"
    if 'eligiible' not in campaign_string:
        return False
    
    # Create the corrected campaignString
    new_campaign_string = campaign_string.replace('eligiible', 'eligible')
    
    if campaign_string == new_campaign_string:
        return False
    
    if dryrun:
        print(f"DRYRUN: Would rename campaignString '{campaign_string}' to '{new_campaign_string}' in table {table_name}")
        return True
    else:
        # Perform the actual rename
        # Since campaignString is the primary key, we need to:
        # 1. Create a new record with the corrected key (copying all data)
        # 2. Delete the old record
        try:
            table = dynamodb.Table(table_name)
            
            # Create a copy of the record with the new campaignString
            new_record = record.copy()
            new_record['campaignString'] = new_campaign_string
            
            # Put the new record
            table.put_item(Item=new_record)
            
            # Delete the old record
            table.delete_item(Key={'campaignString': campaign_string})
            
            print(f"SUCCESS: Renamed campaignString '{campaign_string}' to '{new_campaign_string}' in table {table_name}")
            return True
            
        except Exception as e:
            print(f"ERROR: Failed to rename campaignString '{campaign_string}' in table {table_name}: {e}")
            return False

def process_table(dynamodb, table_name: str, dryrun: bool = False) -> int:
    """
    @function process_table
    @description Process all records in a recipients table.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to process.
    @param dryrun - If True, only count matches without making changes.
    @returns The number of records renamed (or would be renamed in dryrun).
    """
    print(f"Scanning table: {table_name}")
    records = scan_recipients_table(dynamodb, table_name)
    print(f"Found {len(records)} record(s) in {table_name}")
    
    changes_made = 0
    for record in records:
        if process_recipient_record(dynamodb, table_name, record, dryrun):
            changes_made += 1
    
    return changes_made

def main():
    """
    @function main
    @description The main function for the script.
    """
    parser = argparse.ArgumentParser(
        description='Rename campaignString keys containing "eligiible" to "eligible" in recipient tables',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python rename_campaign_eligiible_recipients.py
  python rename_campaign_eligiible_recipients.py --dryrun
        """
    )
    
    parser.add_argument(
        '--dryrun',
        action='store_true',
        help='Show what would be changed without making actual changes'
    )
    
    args = parser.parse_args()
    
    print(f"Dryrun recipients table: {DRYRUN_RECIPIENTS_TABLE}")
    print(f"Send recipients table: {SEND_RECIPIENTS_TABLE}")
    print(f"Dry run: {args.dryrun}")
    print("Searching for campaignString values containing 'eligiible' and renaming to 'eligible'")
    print("-" * 50)
    
    # Get DynamoDB client
    try:
        dynamodb = get_dynamodb_client()
    except Exception as e:
        print(f"ERROR: Failed to initialize DynamoDB client: {e}")
        sys.exit(1)
    
    # Process both tables
    total_changes = 0
    
    # Process dryrun recipients table
    print("\nProcessing dryrun recipients table...")
    print("-" * 50)
    changes = process_table(dynamodb, DRYRUN_RECIPIENTS_TABLE, args.dryrun)
    total_changes += changes
    print(f"Changes in {DRYRUN_RECIPIENTS_TABLE}: {changes}")
    
    # Process send recipients table
    print("\nProcessing send recipients table...")
    print("-" * 50)
    changes = process_table(dynamodb, SEND_RECIPIENTS_TABLE, args.dryrun)
    total_changes += changes
    print(f"Changes in {SEND_RECIPIENTS_TABLE}: {changes}")
    
    # Summary
    print("\n" + "-" * 50)
    if args.dryrun:
        print(f"DRYRUN SUMMARY: Would have made {total_changes} changes across both tables")
    else:
        print(f"SUMMARY: Made {total_changes} changes across both tables")
    
    if total_changes == 0:
        print("No matching campaignString values found.")
    else:
        print(f"Successfully processed {total_changes} campaignString rename(s)")

if __name__ == '__main__':
    main()

