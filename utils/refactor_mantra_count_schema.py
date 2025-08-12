"""
@file utils/refactor_mantra_count_schema.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility script to refactor mantra count schema from old table to new table.
"""

import argparse
import boto3
import os
import sys
import csv
from typing import Dict, Any, Optional, List
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import AWS configuration directly to avoid validation issues
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
AWS_PROFILE = os.getenv('AWS_PROFILE', 'default')
STUDENT_TABLE = os.getenv('STUDENT_TABLE')

# Environment variables for table names
MANTRA_COUNT_TABLE = os.getenv('MANTRA_COUNT_TABLE')
NEW_MANTRA_COUNT_TABLE = os.getenv('NEW_MANTRA_COUNT_TABLE')
MANTRA_CONFIG_TABLE = os.getenv('MANTRA_CONFIG_TABLE')

if not MANTRA_COUNT_TABLE or not NEW_MANTRA_COUNT_TABLE:
    print("ERROR: MANTRA_COUNT_TABLE and NEW_MANTRA_COUNT_TABLE environment variables must be set.")
    sys.exit(1)

def get_dynamodb_client():
    """
    @function get_dynamodb_client
    @description Get DynamoDB client using the configured AWS profile.
    @returns A DynamoDB client.
    """
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def load_field_mappings(dynamodb, table_name: str) -> Dict[str, str]:
    """
    @function load_field_mappings
    @description Load field mappings from mantra-config table.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to load from.
    @returns A dictionary of field mappings.
    """
    if not table_name:
        print("WARNING: MANTRA_CONFIG_TABLE not set, using default field mappings")
        return {
            'mcount': 'medicine-buddha',
            'c1count': 'seven-line-supplication',
            'c2count': 'condensed-supplication-tara',
            'c3count': 'pacifying-turmoil-mamos',
            'c4count': 'condensed-dispelling-obstacles'
        }
    
    try:
        table = dynamodb.Table(table_name)
        response = table.scan()
        mappings = {}
        
        # Build mappings from old field names to databaseField values
        old_to_new_map = {
            'mcount': 'medicine-buddha',
            'c1count': 'seven-line-supplication',
            'c2count': 'condensed-supplication-tara',
            'c3count': 'pacifying-turmoil-mamos',
            'c4count': 'condensed-dispelling-obstacles'
        }
        
        # Create a reverse lookup from databaseField to config id
        field_to_id_map = {}
        for item in response.get('Items', []):
            database_field = item.get('databaseField')
            config_id = item.get('id')
            if database_field and config_id:
                field_to_id_map[database_field] = config_id
        
        # Create final mappings: old_field -> config_id
        for old_field, new_field in old_to_new_map.items():
            if new_field in field_to_id_map:
                mappings[old_field] = field_to_id_map[new_field]
            else:
                # Fallback to database field name if config not found
                mappings[old_field] = new_field
        
        print(f"Loaded {len(mappings)} field mappings from {table_name}")
        return mappings
    except Exception as e:
        print(f"Error loading field mappings from {table_name}: {e}")
        print("Using default field mappings")
        return {
               'mcount': 'medicine-buddha',
            'c1count': 'seven-line-supplication',
            'c2count': 'condensed-supplication-tara',
            'c3count': 'pacifying-turmoil-mamos',
            'c4count': 'condensed-dispelling-obstacles'
        }

def load_id_mappings(csv_file: str = 'idmap.csv') -> Dict[str, str]:
    """
    @function load_id_mappings
    @description Load pre-mapped IDs from CSV file.
    @param csv_file - The path to the CSV file.
    @returns A dictionary of ID mappings.
    """
    mappings = {}
    
    if not os.path.exists(csv_file):
        print(f"WARNING: {csv_file} not found, no pre-mapped IDs will be used")
        return mappings
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file)
            for row in reader:
                old_id = row.get('old_mantra_id')
                new_id = row.get('student_id')
                if old_id and new_id:
                    mappings[old_id] = new_id
        
        print(f"Loaded {len(mappings)} ID mappings from {csv_file}")
        return mappings
    except Exception as e:
        print(f"Error loading ID mappings from {csv_file}: {e}")
        return mappings

def delete_all_records(dynamodb, table_name: str, dry_run: bool = False):
    """
    @function delete_all_records
    @description Delete all records from the specified table.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to delete from.
    @param dry_run - If True, only print what would be done without writing to DynamoDB.
    """
    if dry_run:
        print(f"[DRYRUN] Would delete all records from {table_name}")
        return
    
    try:
        table = dynamodb.Table(table_name)
        
        # Scan and delete all records
        deleted_count = 0
        last_evaluated_key = None
        
        while True:
            scan_kwargs = {}
            if last_evaluated_key:
                scan_kwargs['ExclusiveStartKey'] = last_evaluated_key
            
            response = table.scan(**scan_kwargs)
            items = response.get('Items', [])
            
            # Delete items in batches
            with table.batch_writer() as batch:
                for item in items:
                    batch.delete_item(Key={'id': item['id']})
                    deleted_count += 1
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        
        print(f"Deleted {deleted_count} records from {table_name}")
    except Exception as e:
        print(f"Error deleting records from {table_name}: {e}")
        raise

def scan_table(dynamodb, table_name: str) -> List[Dict[str, Any]]:
    """
    @function scan_table
    @description Scan a DynamoDB table and return all records.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to scan.
    @returns A list of records.
    """
    table = dynamodb.Table(table_name)
    items = []
    last_evaluated_key = None
    
    while True:
        scan_kwargs = {}
        if last_evaluated_key:
            scan_kwargs['ExclusiveStartKey'] = last_evaluated_key
        
        try:
            response = table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
                
        except Exception as e:
            print(f"Error scanning table {table_name}: {e}")
            break
    
    return items

def find_student_by_mid(students: List[Dict[str, Any]], mantra_id: str) -> Optional[Dict[str, Any]]:
    """
    @function find_student_by_mid
    @description Find student by matching 'mid' field to mantra count record ID.
    @param students - A list of students.
    @param mantra_id - The mantra ID to match.
    @returns The matching student, or None if not found.
    """
    for student in students:
        if student.get('mid') == mantra_id:
            return student
    return None

def find_student_by_email(students: List[Dict[str, Any]], email: str) -> Optional[Dict[str, Any]]:
    """
    @function find_student_by_email
    @description Find student by matching email field.
    @param students - A list of students.
    @param email - The email to match.
    @returns The matching student, or None if not found.
    """
    if not email:
        return None
    
    for student in students:
        if student.get('email', '').lower() == email.lower():
            return student
    return None

def find_student_by_name(students: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    """
    @function find_student_by_name
    @description Find student by case-folded name search.
    @param students - A list of students.
    @param name - The name to match.
    @returns The matching student, or None if not found.
    """
    if not name:
        return None
    
    name_lower = name.lower().strip()
    
    # Split name into parts
    name_parts = name_lower.split()
    
    for student in students:
        first = student.get('first', '').lower()
        last = student.get('last', '').lower()
        full_name = f"{first} {last}".strip()
        
        # Exact full name match
        if full_name == name_lower:
            return student
        
        # If name has exactly two parts, try first + last name combination
        if len(name_parts) == 2:
            potential_first = name_parts[0]
            potential_last = name_parts[1]
            
            # Try exact first + last match
            if first == potential_first and last == potential_last:
                return student
            
            # Try reversed (in case order is swapped)
            if first == potential_last and last == potential_first:
                return student
        
        # Try individual name matches (first name or last name only)
        if first == name_lower or last == name_lower:
            return student
        
        # Try partial matches for multi-word names
        if len(name_parts) > 1:
            # Check if any part matches first or last name
            for part in name_parts:
                if part == first or part == last:
                    return student
    
    return None

def find_student_by_id(students: List[Dict[str, Any]], student_id: str) -> Optional[Dict[str, Any]]:
    """
    @function find_student_by_id
    @description Find student by ID.
    @param students - A list of students.
    @param student_id - The ID of the student to find.
    @returns The matching student, or None if not found.
    """
    for student in students:
        if student.get('id') == student_id:
            return student
    return None

def transform_mantra_record(mantra_record: Dict[str, Any], student: Dict[str, Any], field_mappings: Dict[str, str]) -> Dict[str, Any]:
    """
    @function transform_mantra_record
    @description Transform mantra count record to new schema.
    @param mantra_record - The old mantra count record.
    @param student - The student record.
    @param field_mappings - A dictionary of field mappings.
    @returns The transformed mantra count record.
    """
    # Create new record with student ID
    new_record = {'id': student['id']}
    
    # Add country from student record (skip if value is '(none)')
    if 'country' in student and student['country'] != '(none)':
        new_record['country'] = student['country']
    
    # Initialize counts object
    counts = {}
    
    # Transform fields according to mapping and add to counts
    for old_field, config_id in field_mappings.items():
        if old_field in mantra_record and mantra_record[old_field] > 0:
            counts[config_id] = int(mantra_record[old_field])
    
    # Add counts object to record
    if counts:
        new_record['counts'] = counts
    
    # Preserve timestamp fields from old record
    if 'createdAt' in mantra_record:
        new_record['createdAt'] = mantra_record['createdAt']
    if 'lastUpdatedAt' in mantra_record:
        new_record['lastUpdatedAt'] = mantra_record['lastUpdatedAt']
    
    return new_record

def write_mantra_record(dynamodb, table_name: str, record: Dict[str, Any], dry_run: bool = False):
    """
    @function write_mantra_record
    @description Write a mantra count record to the new table.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to write to.
    @param record - The record to write.
    @param dry_run - If True, only print what would be done without writing to DynamoDB.
    """
    if dry_run:
        print(f"[DRYRUN] Would write record to {table_name}: {record}")
        return
    
    table = dynamodb.Table(table_name)
    try:
        table.put_item(Item=record)
        print(f"Wrote record to {table_name}: {record['id']}")
    except Exception as e:
        print(f"Error writing record to {table_name}: {e}")

def main():
    """
    @function main
    @description The main function for the script.
    """
    parser = argparse.ArgumentParser(
        description='Refactor mantra count schema from old table to new table',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python refactor_mantra_count_schema.py
  python refactor_mantra_count_schema.py --dry-run
  python refactor_mantra_count_schema.py --delete-all
        """
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='If set, only print what would be done without writing to DynamoDB'
    )
    
    parser.add_argument(
        '--delete-all',
        action='store_true',
        help='Delete all records from the new mantra count table'
    )
    
    args = parser.parse_args()
    
    # Check if required environment variables are set
    if not STUDENT_TABLE:
        print("ERROR: STUDENT_TABLE environment variable is not set")
        sys.exit(1)
    
    print(f"Student table: {STUDENT_TABLE}")
    print(f"Old mantra count table: {MANTRA_COUNT_TABLE}")
    print(f"New mantra count table: {NEW_MANTRA_COUNT_TABLE}")
    print(f"Mantra config table: {MANTRA_CONFIG_TABLE}")
    print(f"Dry run: {args.dry_run}")
    print(f"Delete all: {args.delete_all}")
    print("-" * 50)
    
    # Get DynamoDB client
    try:
        dynamodb = get_dynamodb_client()
    except Exception as e:
        print(f"ERROR: Failed to initialize DynamoDB client: {e}")
        sys.exit(1)
    
    # Handle delete-all case
    if args.delete_all:
        delete_all_records(dynamodb, NEW_MANTRA_COUNT_TABLE, args.dry_run)
        return
    
    # Scan student table
    print("Scanning student table...")
    students = scan_table(dynamodb, STUDENT_TABLE)
    if not students:
        print("No students found.")
        sys.exit(0)
    print(f"Found {len(students)} student(s)")
    
    # Load field mappings and ID mappings
    print("Loading field mappings...")
    field_mappings = load_field_mappings(dynamodb, MANTRA_CONFIG_TABLE)
    
    print("Loading ID mappings...")
    id_mappings = load_id_mappings()
    
    # Scan old mantra count table
    print("Scanning old mantra count table...")
    old_mantra_records = scan_table(dynamodb, MANTRA_COUNT_TABLE)
    if not old_mantra_records:
        print("No old mantra count records found.")
        sys.exit(0)
    print(f"Found {len(old_mantra_records)} old mantra count record(s)")
    print("-" * 50)
    
    # Process each old mantra count record
    processed_count = 0
    unmatched_records = []
    

    
    for mantra_record in old_mantra_records:
        mantra_id = mantra_record.get('id', 'unknown')
        name = mantra_record.get('name', '')
        email = mantra_record.get('email', '')
        
        print(f"Processing mantra record {mantra_id}: {name}")
        
        # Try to find matching student
        student = None
        
        # Method 1: Check pre-mapped IDs
        if mantra_id in id_mappings:
            student_id = id_mappings[mantra_id]
            student = find_student_by_id(students, student_id)
            if student:
                print(f"  Matched by pre-mapped ID: {student.get('id')}")
        
        # Method 2: Match by 'mid' field
        if not student:
            student = find_student_by_mid(students, mantra_id)
            if student:
                print(f"  Matched by 'mid' field: {student.get('id')}")
        
        # Method 3: Match by email
        if not student and email:
            student = find_student_by_email(students, email)
            if student:
                print(f"  Matched by email: {student.get('id')}")
        
        # Method 4: Match by name
        if not student and name:
            student = find_student_by_name(students, name)
            if student:
                print(f"  Matched by name: {student.get('id')}")
        
        if student:
            # Transform and write the record
            new_record = transform_mantra_record(mantra_record, student, field_mappings)
            write_mantra_record(dynamodb, NEW_MANTRA_COUNT_TABLE, new_record, args.dry_run)
            processed_count += 1
        else:
            # Could not match this record
            # Use lastUpdatedAt field for sorting
            updated_time = mantra_record.get('lastUpdatedAt', '')
            unmatched_records.append({
                'id': mantra_id,
                'name': name,
                'email': email,
                'updated': updated_time
            })
            print(f"  Could not match record to any student")
    
    # Summary
    print("-" * 50)
    print(f"SUMMARY:")
    print(f"  Total old mantra count records: {len(old_mantra_records)}")
    print(f"  Successfully processed: {processed_count}")
    print(f"  Unmatched records: {len(unmatched_records)}")
    
    if unmatched_records:
        # Sort unmatched records by updated field (most recent first)
        unmatched_records.sort(key=lambda x: x['updated'] or '', reverse=True)
        
        print("\nUnmatched records (could not determine student ID) - sorted by last updated (most recent first):")
        for record in unmatched_records:
            updated_str = record['updated'] if record['updated'] else 'No update time'
            print(f"  - ID: {record['id']}, Name: {record['name']}, Email: {record['email']}, Updated: {updated_str}")

if __name__ == '__main__':
    main() 