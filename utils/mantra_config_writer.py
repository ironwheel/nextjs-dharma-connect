#!/usr/bin/env python3
"""
Utility script to write records to the AWS mantra-config table.

This script reads a JSON file containing mantra configuration records and writes them
to the DynamoDB mantra-config table. The table name is accessed via the MANTRA_CONFIG_TABLE
environment variable.

Usage:
    python mantra_config_writer.py --input mantra-config-records.json
    python mantra_config_writer.py --input mantra-config-records.json --dry-run
    python mantra_config_writer.py --delete-all
    python mantra_config_writer.py --delete-all --dry-run
"""

import argparse
import boto3
import json
import os
import sys
from typing import Dict, Any, List
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# AWS configuration
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
AWS_PROFILE = os.getenv('AWS_PROFILE', 'slsupport')  # Using slsupport profile as per user preference
MANTRA_CONFIG_TABLE = os.getenv('MANTRA_CONFIG_TABLE')

if not MANTRA_CONFIG_TABLE:
    print("ERROR: MANTRA_CONFIG_TABLE environment variable must be set.")
    sys.exit(1)

def get_dynamodb_client():
    """Get DynamoDB client using the configured AWS profile."""
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def load_json_records(file_path: str) -> List[Dict[str, Any]]:
    """Load records from JSON file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            records = json.load(file)
        
        if not isinstance(records, list):
            print("ERROR: JSON file must contain an array of records.")
            sys.exit(1)
        
        print(f"Loaded {len(records)} records from {file_path}")
        return records
    except FileNotFoundError:
        print(f"ERROR: File not found: {file_path}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in file {file_path}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Failed to load file {file_path}: {e}")
        sys.exit(1)

def validate_record(record: Dict[str, Any]) -> bool:
    """Validate a single record against the expected schema."""
    required_fields = [
        'id', 'displayNamePrompt', 'descriptionPrompt',
        'bgColor', 'borderColor', 'displayOrder', 'isActive', 'incrementAmount'
    ]
    
    for field in required_fields:
        if field not in record:
            print(f"ERROR: Missing required field '{field}' in record: {record.get('id', 'unknown')}")
            return False
    
    # Validate data types
    if not isinstance(record['id'], str):
        print(f"ERROR: 'id' must be a string in record: {record['id']}")
        return False
    
    if not isinstance(record['displayOrder'], int):
        print(f"ERROR: 'displayOrder' must be an integer in record: {record['id']}")
        return False
    
    if not isinstance(record['isActive'], bool):
        print(f"ERROR: 'isActive' must be a boolean in record: {record['id']}")
        return False
    
    if not isinstance(record['incrementAmount'], int):
        print(f"ERROR: 'incrementAmount' must be an integer in record: {record['id']}")
        return False
    
    return True

def write_record(dynamodb, table_name: str, record: Dict[str, Any], dry_run: bool = False):
    """Write a single record to the DynamoDB table."""
    if dry_run:
        print(f"[DRYRUN] Would write record to {table_name}: {record['id']}")
        return
    
    table = dynamodb.Table(table_name)
    try:
        # Always set timestamps to current date/time
        current_time = datetime.utcnow().isoformat() + 'Z'
        record['createdAt'] = current_time
        record['updatedAt'] = current_time
        
        table.put_item(Item=record)
        print(f"Successfully wrote record: {record['id']}")
    except Exception as e:
        print(f"ERROR: Failed to write record {record['id']}: {e}")

def delete_all_records(dynamodb, table_name: str, dry_run: bool = False):
    """Delete all records from the table."""
    if dry_run:
        print(f"[DRYRUN] Would delete all records from {table_name}")
        return
    
    table = dynamodb.Table(table_name)
    try:
        # Scan the table to get all items
        response = table.scan()
        items = response.get('Items', [])
        
        # Delete each item
        deleted_count = 0
        for item in items:
            table.delete_item(Key={'id': item['id']})
            deleted_count += 1
        
        print(f"Successfully deleted {deleted_count} records from {table_name}")
    except Exception as e:
        print(f"ERROR: Failed to delete records from {table_name}: {e}")

def main():
    parser = argparse.ArgumentParser(description='Write records to the mantra-config table')
    parser.add_argument('--input', '-i', type=str, help='Input JSON file containing records')
    parser.add_argument('--dry-run', action='store_true', help='Perform all operations except writing to the table')
    parser.add_argument('--delete-all', action='store_true', help='Delete all records from the table')
    
    args = parser.parse_args()
    
    if not args.input and not args.delete_all:
        print("ERROR: Must specify either --input or --delete-all")
        parser.print_help()
        sys.exit(1)
    
    if args.input and args.delete_all:
        print("ERROR: Cannot specify both --input and --delete-all")
        parser.print_help()
        sys.exit(1)
    
    # Get DynamoDB client
    try:
        dynamodb = get_dynamodb_client()
        print(f"Connected to AWS using profile: {AWS_PROFILE}")
        print(f"Target table: {MANTRA_CONFIG_TABLE}")
    except Exception as e:
        print(f"ERROR: Failed to connect to AWS: {e}")
        sys.exit(1)
    
    if args.delete_all:
        delete_all_records(dynamodb, MANTRA_CONFIG_TABLE, args.dry_run)
        return
    
    # Load and validate records
    records = load_json_records(args.input)
    
    # Validate all records
    valid_records = []
    for record in records:
        if validate_record(record):
            valid_records.append(record)
        else:
            print(f"Skipping invalid record: {record.get('id', 'unknown')}")
    
    if not valid_records:
        print("ERROR: No valid records found in the input file")
        sys.exit(1)
    
    print(f"Found {len(valid_records)} valid records to write")
    
    # Write records
    for record in valid_records:
        write_record(dynamodb, MANTRA_CONFIG_TABLE, record, args.dry_run)
    
    if args.dry_run:
        print(f"[DRYRUN] Would have written {len(valid_records)} records to {MANTRA_CONFIG_TABLE}")
    else:
        print(f"Successfully wrote {len(valid_records)} records to {MANTRA_CONFIG_TABLE}")

if __name__ == '__main__':
    main() 