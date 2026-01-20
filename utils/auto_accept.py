import boto3
import argparse
import os
import sys
import json
from boto3.dynamodb.conditions import Attr

# Setup path to import eligible.py
# Assuming this script is in utils/ and eligible.py is in apps/email-agent/src/
# We need to go up one level from utils, then down into apps/email-agent/src
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
eligible_path = os.path.join(project_root, 'apps', 'email-agent', 'src')
sys.path.append(eligible_path)

try:
    from eligible import check_eligibility
except ImportError as e:
    print(f"Error importing eligible.py: {e}")
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description='Auto accept participants based on eligibility.')
    parser.add_argument('--eventCode', required=True, help='Event Code (aid)')
    parser.add_argument('--pool', required=True, help='Pool name')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--profile', help='AWS profile to use', default=None)
    
    args = parser.parse_args()
    
    event_code = args.eventCode
    pool_name = args.pool
    dry_run = args.dry_run
    
    # helper for env vars
    def get_env_var(name, default=None):
        val = os.environ.get(name, default)
        if not val:
            print(f"Error: Environment variable {name} is not set.")
            sys.exit(1)
        return val

    # Tables
    # Allowing defaults for testing/dev if env vars not strictly set, but prompt implies they are set
    # Using sensible defaults if not set in environment to match prompt description
    # The prompt explicitly mentions "indicated by the evar DYNAMODB_TABLE_POOLS" etc.
    pools_table_name = os.environ.get('DYNAMODB_TABLE_POOLS')
    if not pools_table_name:
         print("Warning: DYNAMODB_TABLE_POOLS not set. Defaulting to 'pools'")
         pools_table_name = 'pools'
         
    participants_table_name = os.environ.get('DYNAMODB_TABLE_PARTICIPANTS')
    if not participants_table_name:
        print("Error: DYNAMODB_TABLE_PARTICIPANTS environment variable must be set.")
        # For safety, strictly require this one or fail if user intention was strictly env var
        # But for development/testing often useful to have a fallback? 
        # The prompt says "indicated by the evar...", implying the evar holds the name.
        # I'll exit if not found to be safe.
        sys.exit(1)

    print(f"Configuration: Event={event_code}, Pool={pool_name}, DryRun={dry_run}")
    print(f"Tables: Participants={participants_table_name}, Pools={pools_table_name}")

    # Initialize session
    session_kwargs = {}
    if args.profile:
        session_kwargs['profile_name'] = args.profile
    
    session = boto3.Session(**session_kwargs)
    dynamodb = session.resource('dynamodb')
    
    pools_table = dynamodb.Table(pools_table_name)
    participants_table = dynamodb.Table(participants_table_name)
    
    # 1. Fetch all pools
    print("Fetching all pools...")
    try:
        # Scan is okay for pools as it's likely small-ish, but if large might need pagination handling
        # standard boto3 scan handles up to 1MB, might need loop.
        all_pools_data = []
        response = pools_table.scan()
        all_pools_data.extend(response.get('Items', []))
        while 'LastEvaluatedKey' in response:
            response = pools_table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            all_pools_data.extend(response.get('Items', []))
        print(f"Loaded {len(all_pools_data)} pools.")
    except Exception as e:
        print(f"Error scanning pools table: {e}")
        sys.exit(1)
        
    # Verify the requested pool exists
    target_pool = next((p for p in all_pools_data if p.get('name') == pool_name), None)
    if not target_pool:
        print(f"Error: Pool '{pool_name}' not found in DYNAMODB_TABLE_POOLS.")
        sys.exit(1)

    # 2. Scan participants and process
    print("Scanning participants...")
    
    # We want records where programs.{eventCode}.join == true
    # We can try to filter via FilterExpression but nested map access in key might be tricky if eventCode has dots, but aid usually doesn't.
    # However, simple scan and client-side filter is robust.
    # Let's use FilterExpression to reduce data transfer if possible, or just client side.
    # records found to have the field programs.{eventCode}.join == true
    
    # Using Scan
    processed_count = 0
    accepted_count = 0
    error_count = 0
    
    scan_kwargs = {}
    done = False
    start_key = None
    
    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key
            
        response = participants_table.scan(**scan_kwargs)
        items = response.get('Items', [])
        
        for item in items:
            programs = item.get('programs', {})
            # Ensure programs is a dict (Map)
            if not isinstance(programs, dict):
                continue
                
            program_data = programs.get(event_code)
            if not program_data or not isinstance(program_data, dict):
                continue
                
            is_join = program_data.get('join') is True
            is_accepted = program_data.get('accepted') is True

            if not is_join and not is_accepted:
                continue

            # Check eligibility if relevant (either trying to join or already accepted)
            try:
                is_eligible = check_eligibility(pool_name, item, event_code, all_pools_data)
                
                # Logic 1: Auto Accept
                if is_join:
                    processed_count += 1
                    if is_eligible:
                        accepted_count += 1
                        # Only update if not already accepted to avoid redundant writes/logs
                        if not is_accepted:
                            print(f"[ELIGIBLE] Participant {item.get('id', 'Unknown')} is eligible for join.")
                            if not dry_run:
                                try:
                                    participants_table.update_item(
                                        Key={'id': item['id']},
                                        UpdateExpression=f"SET programs.#{event_code}.accepted = :val",
                                        ExpressionAttributeNames={
                                            f"#{event_code}": event_code
                                        },
                                        ExpressionAttributeValues={
                                            ':val': True
                                        }
                                    )
                                    print(f"   -> Updated programs.{event_code}.accepted to True")
                                except Exception as update_err:
                                    print(f"   -> Failed to update: {update_err}")
                                    error_count += 1
                            else:
                                print(f"   -> [DRY RUN] Would update programs.{event_code}.accepted to True")
                    else:
                        # Not eligible for join
                        pass

                # Logic 2: Warning for Accepted but Ineligible
                if is_accepted and not is_eligible:
                    print(f"[WARNING] Participant {item.get('id', 'Unknown')} is ACCEPTED but NOT ELIGIBLE.")

            except Exception as e:
                print(f"Error checking eligibility for participant {item.get('id')}: {e}")
                error_count += 1
        
        start_key = response.get('LastEvaluatedKey')
        if not start_key:
            done = True
            
    print("-" * 30)
    print(f"Summary:")
    print(f"Processed (join=True): {processed_count}")
    print(f"Eligible & Accepted (newly or already): {accepted_count}")
    print(f"Errors: {error_count}")
    print("-" * 30)

if __name__ == '__main__':
    main()
