#!/usr/bin/env python3
"""
Utility script to find students missing a specific campaign in their emails folder.

This script scans the student DynamoDB table and checks if each student has the specified
campaign in their emails field. If a student is missing the campaign, their ID is printed.

Usage:
    python missing_campaign.py --campaign "campaign-name"
    python missing_campaign.py --campaign "vt2024-retreat-reminder" --id "student-123"
    python missing_campaign.py --campaign "campaign-name" --ignore-unsubscribed
    python missing_campaign.py --campaign "campaign-name" --ignore-missing-email
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
    """Get DynamoDB client using the configured AWS profile."""
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def scan_student_table(dynamodb, table_name: str, student_id: Optional[str] = None) -> list:
    """Scan the student table and return all records or a specific record by ID."""
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

def check_student_campaign(student: Dict[str, Any], campaign: str, ignore_unsubscribed: bool = False, ignore_missing_email: bool = False) -> bool:
    """
    Check if a student has the specified campaign in their emails field.
    
    Args:
        student: The student record from DynamoDB
        campaign: The campaign name to check for
        ignore_unsubscribed: If True, skip students who have unsubscribed
        ignore_missing_email: If True, skip students with blank email fields
    
    Returns:
        True if the student has the campaign, False otherwise
    """
    student_id = student.get('id', 'unknown')
    
    # Check if student has unsubscribed (if ignore_unsubscribed is True)
    if ignore_unsubscribed:
        unsubscribed = student.get('unsubscribe', False)
        if unsubscribed:
            print(f"Student {student_id}: Skipping unsubscribed student")
            return True  # Return True to indicate we're "ignoring" this student
    
    # Check if student has missing email (if ignore_missing_email is True)
    if ignore_missing_email:
        email = student.get('email', '')
        if not email or email.strip() == '':
            print(f"Student {student_id}: Skipping student with missing email")
            return True  # Return True to indicate we're "ignoring" this student
    
    emails = student.get('emails', {})
    
    if not isinstance(emails, dict):
        print(f"Student {student_id}: emails field is not a dictionary, considering as missing campaign")
        return False
    
    # Check if the campaign key exists
    return campaign in emails

def main():
    parser = argparse.ArgumentParser(
        description='Find students missing a specific campaign in their emails folder',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python missing_campaign.py --campaign "vt2024-retreat-reminder"
  python missing_campaign.py --campaign "test-campaign" --id "student-123"
  python missing_campaign.py --campaign "campaign-name" --ignore-unsubscribed
  python missing_campaign.py --campaign "campaign-name" --ignore-missing-email
        """
    )
    
    parser.add_argument(
        '--campaign',
        required=True,
        help='The campaign name to check for'
    )
    
    parser.add_argument(
        '--id',
        help='Check only the student with the specified ID'
    )
    
    parser.add_argument(
        '--ignore-unsubscribed',
        action='store_true',
        help='Ignore students who have unsubscribed from emails'
    )
    
    parser.add_argument(
        '--ignore-missing-email',
        action='store_true',
        help='Ignore students with blank email fields'
    )
    
    args = parser.parse_args()
    
    # Check if STUDENT_TABLE is configured
    if not STUDENT_TABLE:
        print("ERROR: STUDENT_TABLE environment variable is not set")
        sys.exit(1)
    
    print(f"Student table: {STUDENT_TABLE}")
    print(f"Campaign to check: {args.campaign}")
    if args.id:
        print(f"Student ID: {args.id}")
    if args.ignore_unsubscribed:
        print("Ignoring unsubscribed students: Yes")
    if args.ignore_missing_email:
        print("Ignoring students with missing email: Yes")
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
    
    print(f"Found {len(students)} student(s) to check")
    print("-" * 50)
    
    # Check each student
    missing_campaign_students = []
    ignored_unsubscribed_count = 0
    ignored_missing_email_count = 0
    
    for student in students:
        student_id = student.get('id', 'unknown')
        
        # Check if student has unsubscribed (if ignore_unsubscribed is True)
        if args.ignore_unsubscribed:
            unsubscribed = student.get('unsubscribe', False)
            if unsubscribed:
                ignored_unsubscribed_count += 1
                continue  # Skip this student
        
        # Check if student has missing email (if ignore_missing_email is True)
        if args.ignore_missing_email:
            email = student.get('email', '')
            if not email or email.strip() == '':
                ignored_missing_email_count += 1
                continue  # Skip this student
        
        if not check_student_campaign(student, args.campaign, args.ignore_unsubscribed, args.ignore_missing_email):
            missing_campaign_students.append(student_id)
            print(student_id)
    
    # Summary
    print("-" * 50)
    print(f"SUMMARY: Found {len(missing_campaign_students)} student(s) missing campaign '{args.campaign}'")
    
    if args.ignore_unsubscribed and ignored_unsubscribed_count > 0:
        print(f"Ignored {ignored_unsubscribed_count} unsubscribed student(s)")
    
    if args.ignore_missing_email and ignored_missing_email_count > 0:
        print(f"Ignored {ignored_missing_email_count} student(s) with missing email")
    
    if len(missing_campaign_students) == 0:
        print("All students have the specified campaign.")
    else:
        print(f"Students missing campaign '{args.campaign}':")
        for student_id in missing_campaign_students:
            print(f"  - {student_id}")

if __name__ == '__main__':
    main() 