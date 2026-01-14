#!/usr/bin/env python3
"""
Script to fix transactions with payerData='(none)' and status='COMPLETED'.
It fetches the payment details from Stripe and updates the DynamoDB record.

Usage:
    export STRIPE_SECRET_KEY=sk_test_...
    export TRANSACTIONS_TABLE=lineage.transactions
    python3 utils/fix_transaction_payerdata.py --profile slsupport --dry-run
"""

import argparse
import boto3
import os
import sys
import json
import stripe
from decimal import Decimal
from boto3.dynamodb.conditions import Attr
import time

def get_table(session, table_name):
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)

# Helper to convert float to Decimal for DynamoDB
def json_serial(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    raise TypeError ("Type not serializable")

def to_dynamo_compatible(py_obj):
    """
    Safely convert a python object (like a dict from Stripe) into
    DynamoDB compatible types (e.g. float -> Decimal).
    """
    # Dump to JSON then load back with parse_float=Decimal
    return json.loads(json.dumps(py_obj), parse_float=Decimal)

def process_record(record, table, dry_run):
    tx_id = record.get('transaction')
    rec_id = record.get('id')
    aid = record.get('aid')
    
    print(f"\nProcessing Record ID: {rec_id}")
    print(f"  Transaction (PI): {tx_id}")
    print(f"  AID: {aid}")

    if not tx_id or not tx_id.startswith('pi_'):
        print(f"  SKIPPING: Invalid transaction ID format: {tx_id}")
        return False

    try:
        # Fetch from Stripe
        # Expand latest_charge.balance_transaction to get the full Balance Transaction object
        pi = stripe.PaymentIntent.retrieve(
            tx_id,
            expand=['latest_charge.balance_transaction']
        )
        
        # Navigate to the Balance Transaction
        latest_charge = pi.get('latest_charge')
        if not latest_charge:
            print("  SKIPPING: No latest_charge found on PaymentIntent")
            return False
            
        balance_txn = latest_charge.get('balance_transaction')
        if not balance_txn:
             print("  SKIPPING: No balance_transaction found on Charge")
             return False
             
        # The balance_transaction object from Stripe is what we want for payerData
        # We need to ensure it's a dictionary / compatible
        # Use simple dict conversion or JSON cycle to strip Stripe object wrapper
        payer_data_dict = json.loads(json.dumps(balance_txn))
        
        # Convert to DynamoDB compatible (floats to Decimals)
        dynamo_payer_data = to_dynamo_compatible(payer_data_dict)
        
        print("  Stripe Data Retrieved successfully.")
        print(f"  Balance Txn ID: {dynamo_payer_data.get('id')}")
        print(f"  Amount: {dynamo_payer_data.get('amount')} {dynamo_payer_data.get('currency')}")

        if dry_run:
            print("  [DRY RUN] Would update payerData.")
        else:
            # Update DynamoDB
            # Correct Key is 'transaction' based on tableConfig.ts
            table.update_item(
                Key={'transaction': tx_id},
                UpdateExpression="set payerData = :pd",
                ExpressionAttributeValues={
                    ':pd': dynamo_payer_data
                }
            )
            print("  [SUCCESS] Updated payerData in DynamoDB.")
            
        return True

    except stripe.error.StripeError as e:
        print(f"  STRIPE ERROR: {e}")
        return False
    except Exception as e:
        print(f"  ERROR: {e}")
        # Even if general error, we consider this an 'attempt' that failed
        return False

def main():
    parser = argparse.ArgumentParser(description="Fix transaction payerData from Stripe")
    parser.add_argument('--profile', default='slsupport', help='AWS Profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--only-one', action='store_true', help='Process only one record and exit')
    args = parser.parse_args()

    # Config Check
    stripe_key = os.environ.get('STRIPE_SECRET_KEY')
    if not stripe_key:
        print("ERROR: STRIPE_SECRET_KEY environment variable not set.")
        sys.exit(1)
    
    stripe.api_key = stripe_key
    
    table_name = os.environ.get('TRANSACTIONS_TABLE', 'lineage.transactions')
    
    print(f"Starting Scan on table: {table_name}")
    print(f"Profile: {args.profile}")
    print(f"Dry Run: {args.dry_run}")
    
    session = boto3.Session(profile_name=args.profile, region_name='us-east-1')
    table = get_table(session, table_name)
    
    # Scan for records
    # Filter: payerData == '(none)' AND status == 'COMPLETED'
    
    scan_kwargs = {
        'FilterExpression': Attr('payerData').eq('(none)') & Attr('status').eq('COMPLETED')
    }
    
    done = False
    start_key = None
    processed_count = 0
    updated_count = 0
    
    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key
            
        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])
        
        print(f"Batch scanned: {len(items)} matching candidates found.")
        
        for item in items:
            # Attempt to process
            success = process_record(item, table, args.dry_run)
            
            if success:
                updated_count += 1
            
            processed_count += 1
            
            # If --only-one is set, we stop after the first ATTEMPT (successful or not)
            # OR maybe user meant stop after first SUCCESS?
            # User said "Also, --only-one should stop when it gets that error"
            # implying they want it to stop on ANY attempt.
            if args.only_one:
                 print("Exiting due to --only-one (processed 1 record)")
                 return

            # Rate limit slightly to be nice to Stripe API if doing bulk
            if success: 
                time.sleep(0.2) 
        
        start_key = response.get('LastEvaluatedKey')
        if not start_key:
            done = True
            
    print(f"\nScanning Complete.")
    print(f"Total Processed candidates: {processed_count}")
    print(f"Total Updated: {updated_count}")

if __name__ == "__main__":
    main()
