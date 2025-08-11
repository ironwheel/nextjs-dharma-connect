"""
@file utils/rename_campaign.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility script to rename campaign keys in student records.
"""

import argparse
import boto3
import os
import sys
from typing import Dict, Any, Optional
from pathlib import Path

# Add the parent directory to the path so we can import config
sys.path.append(str(Path(__file__).parent.parent / 'src'))

from config import STUDENT_TABLE, AWS_REGION, AWS_PROFILE

def get_dynamodb_client():
    """
    @function get_dynamodb_client
    @description Get DynamoDB client using the configured AWS profile.
    @returns A DynamoDB client.
    """
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def scan_student_table(dynamodb, table_name: str, student_id: Optional[str] = None) -> list:
    """
    @function scan_student_table
    @description Scan the student table and return all records or a specific record by ID.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to scan.
    @param student_id - The ID of the student to retrieve.
    @returns A list of students.
    """
    table = dynamodb.Table(table_name)
    
    if student_id:
        # Get specific student by ID
        try:
            response = table.get_item(Key={'id': student_id})
            if 'Item' in response:
                return [response['Item']]
            else:
                print(f"Student with ID '{student_id}' not found.")
                return []
        except Exception as e:
            print(f"Error getting student with ID '{student_id}': {e}")
            return []
    else:
        # Scan all students
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

def process_student_record(student: Dict[str, Any], from_campaign: str, to_campaign: str, dryrun: bool = False) -> bool:
    """
    @function process_student_record
    @description Process a single student record to rename campaign keys.
    @param student - The student record from DynamoDB.
    @param from_campaign - The campaign key to rename from.
    @param to_campaign - The campaign key to rename to.
    @param dryrun - If True, only count matches without making changes.
    @returns True if changes were made (or would be made in dryrun), False otherwise.
    """
    student_id = student.get('id', 'unknown')
    emails = student.get('emails', {})
    
    if not isinstance(emails, dict):
        print(f"Student {student_id}: emails field is not a dictionary, skipping")
        return False
    
    # Check if the from_campaign key exists
    if from_campaign not in emails:
        return False
    
    # Get the timestamp value
    timestamp = emails[from_campaign]
    
    if dryrun:
        print(f"DRYRUN: Would rename campaign '{from_campaign}' to '{to_campaign}' for student {student_id} (timestamp: {timestamp})")
        return True
    else:
        # Perform the actual rename
        try:
            # Create new emails dict with renamed key
            new_emails = emails.copy()
            new_emails[to_campaign] = timestamp
            del new_emails[from_campaign]
            
            # Update the student record
            table = get_dynamodb_client().Table(STUDENT_TABLE)
            table.update_item(
                Key={'id': student_id},
                UpdateExpression='SET emails = :emails',
                ExpressionAttributeValues={':emails': new_emails}
            )
            
            print(f"SUCCESS: Renamed campaign '{from_campaign}' to '{to_campaign}' for student {student_id} (timestamp: {timestamp})")
            return True
            
        except Exception as e:
            print(f"ERROR: Failed to update student {student_id}: {e}")
            return False

def main():
    """
    @function main
    @description The main function for the script.
    """
    parser = argparse.ArgumentParser(
        description='Rename campaign keys in student records',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python rename_campaign.py --from-campaign "vt2024-retreat-reminder" --to-campaign "vt2024-retreat-reminder-v2"
  python rename_campaign.py --from-campaign "old-campaign" --to-campaign "new-campaign" --dryrun
  python rename_campaign.py --from-campaign "test-campaign" --to-campaign "prod-campaign" --id "student-123"
        """
    )
    
    parser.add_argument(
        '--from-campaign',
        required=True,
        help='The campaign key to rename from'
    )
    
    parser.add_argument(
        '--to-campaign',
        required=True,
        help='The campaign key to rename to'
    )
    
    parser.add_argument(
        '--dryrun',
        action='store_true',
        help='Show what would be changed without making actual changes'
    )
    
    parser.add_argument(
        '--id',
        help='Process only the student with the specified ID'
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.from_campaign == args.to_campaign:
        print("ERROR: --from-campaign and --to-campaign must be different")
        sys.exit(1)
    
    # Check if STUDENT_TABLE is configured
    if not STUDENT_TABLE:
        print("ERROR: STUDENT_TABLE environment variable is not set")
        sys.exit(1)
    
    print(f"Student table: {STUDENT_TABLE}")
    print(f"From campaign: {args.from_campaign}")
    print(f"To campaign: {args.to_campaign}")
    print(f"Dry run: {args.dryrun}")
    if args.id:
        print(f"Student ID: {args.id}")
    print("-" * 50)
    
    # Get DynamoDB client
    try:
        dynamodb = get_dynamodb_client()
    except Exception as e:
        print(f"ERROR: Failed to initialize DynamoDB client: {e}")
        sys.exit(1)
    
    # Scan student table
    print("Scanning student table...")
    students = scan_student_table(dynamodb, STUDENT_TABLE, args.id)
    
    if not students:
        print("No students found.")
        sys.exit(0)
    
    print(f"Found {len(students)} student(s) to process")
    print("-" * 50)
    
    # Process each student
    changes_made = 0
    for student in students:
        if process_student_record(student, args.from_campaign, args.to_campaign, args.dryrun):
            changes_made += 1
    
    # Summary
    print("-" * 50)
    if args.dryrun:
        print(f"DRYRUN SUMMARY: Would have made {changes_made} changes")
    else:
        print(f"SUMMARY: Made {changes_made} changes")
    
    if changes_made == 0:
        print("No matching campaign keys found.")
    else:
        print(f"Successfully processed {changes_made} student record(s)")

if __name__ == '__main__':
    main() 