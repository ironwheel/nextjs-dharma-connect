#!/usr/bin/env python3
"""
Script to fix timestamps on REFUNDED transactions by consulting Stripe.
Updates 'timestamp' (original tx time) and 'refundedAt' (refund time).

Usage:
    export TRANSACTIONS_TABLE=foundations.transactions
    export STRIPE_SECRET_KEY=sk_abc123...
    python3 utils/fix_refund_timestamps.py --profile slsupport --dry-run
"""

import argparse
import boto3
import os
import sys
import stripe
from datetime import datetime
from boto3.dynamodb.conditions import Attr

def get_table(session, table_name):
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)

def fix_timestamps(profile, table_name, stripe_secret, dry_run, single_pi=None):
    print(f"Starting timestamp fix on {table_name}...")
    if dry_run:
        print("DRY RUN MODE: No updates will be performed.")

    session = boto3.Session(profile_name=profile, region_name='us-east-1')
    table = get_table(session, table_name)
    stripe.api_key = stripe_secret

    scan_kwargs = {
        'FilterExpression': Attr('status').eq('REFUNDED')
    }
    
    stats = {
        'scanned': 0,
        'updated': 0,
        'skipped_no_txn': 0,
        'stripe_errors': 0,
        'db_errors': 0
    }

    if single_pi:
        print(f"Targeting single transaction: {single_pi}")
        try:
            resp = table.get_item(Key={'transaction': single_pi})
            item = resp.get('Item')
            items = [item] if item else []
            if not item:
                 print(f"Transaction {single_pi} not found in table.")
        except Exception as e:
            print(f"Error fetching item {single_pi}: {e}")
            items = []
        done = True # Scan loop not needed, but we reuse the processing loop
    else:
        items = [] # Will be populated in loop
        done = False
    
    start_key = None

    while True: # unified loop
        if not single_pi:
            if start_key:
                scan_kwargs['ExclusiveStartKey'] = start_key
            
            response = table.scan(**scan_kwargs)
            items = response.get('Items', [])
        
        # Process items (either single fetched item or scanned batch)
        for item in items:
            stats['scanned'] += 1
            pi_id = item.get('transaction')
            
            if not pi_id or not pi_id.startswith('pi_'):
                print(f"  [SKIP] Invalid Transaction ID: {pi_id}")
                stats['skipped_no_txn'] += 1
                continue
            
            try:
                # 1. Fetch PI from Stripe for Original Timestamp
                pi = stripe.PaymentIntent.retrieve(pi_id)
                created_ts = pi.get('created')
                timestamp_iso = datetime.fromtimestamp(created_ts).isoformat()
                
                # 2. Determine Refund Time
                # We'll list refunds associated with this PI
                refunds = stripe.Refund.list(payment_intent=pi_id, limit=1)
                refund_ts = None
                
                if refunds.data:
                    # Use the most recent refund's creation time
                    refund_created = refunds.data[0].get('created')
                    refund_ts = datetime.fromtimestamp(refund_created).isoformat()
                else:
                    print(f"  [WARN] PI {pi_id} is REFUNDED in DB but has no refunds in Stripe list. Using PI created time?")
                    pass

                # Update Logic
                updates = []
                attrib_vals = {}
                attrib_names = {}
                
                # We always set timestamp
                updates.append("#ts = :ts")
                attrib_names['#ts'] = 'timestamp'
                attrib_vals[':ts'] = timestamp_iso
                
                if refund_ts:
                    updates.append("#ra = :ra")
                    attrib_names['#ra'] = 'refundedAt'
                    attrib_vals[':ra'] = refund_ts

                update_expr = "SET " + ", ".join(updates)
                
                print(f"  [UPDATE] PI {pi_id}")
                print(f"     timestamp: {item.get('timestamp')} -> {timestamp_iso}")
                if refund_ts:
                    print(f"     refundedAt: {item.get('refundedAt')} -> {refund_ts}")

                if not dry_run:
                    try:
                        table.update_item(
                            Key={'transaction': pi_id},
                            UpdateExpression=update_expr,
                            ExpressionAttributeNames=attrib_names,
                            ExpressionAttributeValues=attrib_vals
                        )
                        stats['updated'] += 1
                    except Exception as e:
                        print(f"    ! DB Update Error: {e}")
                        stats['db_errors'] += 1
                else:
                    stats['updated'] += 1

            except Exception as e:
                print(f"  ! Stripe Error for {pi_id}: {e}")
                stats['stripe_errors'] += 1
                continue

        if single_pi:
            break

        start_key = response.get('LastEvaluatedKey', None)
        if start_key is None:
            break
        print(f"... Scanned batch ...")

    print("\nFIX REPORT")
    print(f"Scanned (REFUNDED only): {stats['scanned']}")
    print(f"Updated (Dry Run={dry_run}): {stats['updated']}")
    print(f"Stripe Errors: {stats['stripe_errors']}")

def main():
    parser = argparse.ArgumentParser(description='Fix refund timestamps.')
    parser.add_argument('--profile', required=False, help='AWS CLI profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--pi', required=False, help='Specific PaymentIntent ID to process')
    
    args = parser.parse_args()
    
    tx_table = os.environ.get('TRANSACTIONS_TABLE')
    stripe_secret = os.environ.get('STRIPE_SECRET_KEY')
    
    if not tx_table or not stripe_secret:
        print("Error: TRANSACTIONS_TABLE and STRIPE_SECRET_KEY env vars must be set.")
        sys.exit(1)

    try:
        fix_timestamps(args.profile, tx_table, stripe_secret, args.dry_run, args.pi)
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
