#!/usr/bin/env python3
"""
Reconciliation script to sync student refund status to transactions table
and report on financial totals.

Usage:
    export STUDENT_TABLE=foundations.participants
    export TRANSACTIONS_TABLE=foundations.transactions
    python3 utils/reconcile_transactions.py --profile slsupport --dry-run
"""

import argparse
import boto3
import os
import sys
from datetime import datetime
from collections import defaultdict
from decimal import Decimal

# Helper to serialize decimals for DynamoDB if needed (though boto3 Table resource handles standard types well)
# We will read `total` as Decimal from boto3.

def get_table(session, table_name):
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)

def traverse_offerings(programs):
    """
    Generator that yields (event_code, sub_event, context_obj)
    for every found offeringIntent.
    """
    for event_code, event_data in programs.items():
        if not isinstance(event_data, dict):
            continue
        
        offering_history = event_data.get('offeringHistory', {})
        if not offering_history:
            continue
        
        for sub_event, sub_event_data in offering_history.items():
            if not isinstance(sub_event_data, dict):
                continue
            
            # Direct offering
            if 'offeringIntent' in sub_event_data:
                yield event_code, sub_event, sub_event_data
            
            # Installments
            installments = sub_event_data.get('installments', {})
            for inst_name, inst_data in installments.items():
                if isinstance(inst_data, dict) and 'offeringIntent' in inst_data:
                    yield event_code, sub_event, inst_data

def reconcile_transactions(profile, student_table_name, tx_table_name, dry_run):
    print(f"Starting reconciliation...")
    print(f"  Profile: {profile}")
    print(f"  Students: {student_table_name}")
    print(f"  Transactions: {tx_table_name}")
    if dry_run:
        print("  Mode: DRY RUN (No updates)")

    session = boto3.Session(profile_name=profile, region_name='us-east-1')
    student_table = get_table(session, student_table_name)
    tx_table = get_table(session, tx_table_name)

    # 1. Reconciliation Phase
    print("\n--- Phase 1: Syncing Refund Status ---")
    
    stats_sync = {
        'scanned_students': 0,
        'scanned_intents': 0,
        'missing_tx': 0,
        'invalid_state_tx': 0,
        'marked_refunded': 0,
        'already_refunded': 0,
        'errors': 0
    }

    # Helper to batch get items could be faster, but per-student loop matches requirement
    # We'll fetch one by one for simplicity and direct correlation
    
    scan_kwargs = {}
    done = False
    start_key = None

    processed_pis = set()

    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key
        
        response = student_table.scan(**scan_kwargs)
        items = response.get('Items', [])
        
        for student in items:
            stats_sync['scanned_students'] += 1
            student_id = student.get('id')
            programs = student.get('programs', {})
            
            if not programs:
                continue

            for ev_code, sub_ev, offer_obj in traverse_offerings(programs):
                pi_id = offer_obj.get('offeringIntent')
                
                # Basic validation
                if not isinstance(pi_id, str) or not pi_id.startswith('pi_'):
                    continue
                
                if pi_id in processed_pis:
                    continue
                processed_pis.add(pi_id)
                
                stats_sync['scanned_intents'] += 1
                
                # Lookup Transaction
                try:
                    tx_resp = tx_table.get_item(Key={'transaction': pi_id})
                    tx_item = tx_resp.get('Item')
                except Exception as e:
                    print(f"  ! Error feching tx {pi_id}: {e}")
                    stats_sync['errors'] += 1
                    continue
                
                if not tx_item:
                    # Missing transaction record
                    stats_sync['missing_tx'] += 1
                    print(f"  [MISSING TX] Student {student_id} | PI {pi_id}")
                    continue
                
                # Check State
                step = tx_item.get('step')
                status = tx_item.get('status')
                
                is_valid_completed = (step == 'confirmCardPayment' and status == 'COMPLETED')
                is_valid_refunded = (step == 'confirmCardPayment' and status == 'REFUNDED')
                
                if not (is_valid_completed or is_valid_refunded):
                    stats_sync['invalid_state_tx'] += 1
                    #print(f"  [INVALID STATE] PI {pi_id} | step={step} status={status}")
                    continue
                
                # Sync Logic
                student_is_refunded = offer_obj.get('offeringRefund', False)
                
                if student_is_refunded:
                    if status != 'REFUNDED':
                        # Needs Update
                        print(f"  [SYNC REFUND] PI {pi_id} | Student=Refunded | Tx={status} -> REFUNDED")
                        if not dry_run:
                            try:
                                resp = tx_table.update_item(
                                    Key={'transaction': pi_id},
                                    UpdateExpression="SET #s = :r",
                                    ExpressionAttributeNames={'#s': 'status'},
                                    ExpressionAttributeValues={':r': 'REFUNDED'},
                                    ReturnValues="UPDATED_NEW"
                                )
                                print(f"    > Update Response Code: {resp['ResponseMetadata']['HTTPStatusCode']}")
                                stats_sync['marked_refunded'] += 1
                            except Exception as e:
                                print(f"    ! Update failed: {e}")
                                stats_sync['errors'] += 1
                            print("Check this:",pi_id);
                            sys.exit(-1)
                        else:
                            stats_sync['marked_refunded'] += 1
                    else:
                        print(f"  [ALREADY REFUNDED] PI {pi_id} | Status is correctly REFUNDED")
                        stats_sync['already_refunded'] += 1

        start_key = response.get('LastEvaluatedKey', None)
        done = start_key is None
        print(f"... Scanned {stats_sync['scanned_students']} students...")

    # 2. Reporting Phase
    print("\n--- Phase 2: Financial Reporting ---")
    
    stats_report = {
        'completed': defaultdict(lambda: {'count': 0, 'amount': Decimal(0)}),
        'refunded': defaultdict(lambda: {'count': 0, 'amount': Decimal(0)}),
        'completed_total': {'count': 0, 'amount': Decimal(0)},
        'refunded_total': {'count': 0, 'amount': Decimal(0)},
        'skipped_records': 0
    }

    scan_kwargs = {}
    done = False
    start_key = None

    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key
        
        response = tx_table.scan(**scan_kwargs)
        items = response.get('Items', [])
        
        for tx in items:
            step = tx.get('step')
            status = tx.get('status')
            
            if step != 'confirmCardPayment':
                stats_report['skipped_records'] += 1
                continue
                
            amount = tx.get('total', 0)
            if amount is None: amount = 0
            amount = Decimal(amount)
            
            ts_str = tx.get('timestamp') # "2025-10-05T12:33:18.798Z"
            year = 'Unknown'
            if ts_str:
                try:
                    # Parse ISO format. Z might be present
                    # Python 3.7+ fromisoformat handles most, but Z needs handling manually usually or replace
                    dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                    year = dt.year
                except:
                    pass
            
            if status == 'COMPLETED':
                stats_report['completed'][year]['count'] += 1
                stats_report['completed'][year]['amount'] += amount
                stats_report['completed_total']['count'] += 1
                stats_report['completed_total']['amount'] += amount
            elif status == 'REFUNDED':
                stats_report['refunded'][year]['count'] += 1
                stats_report['refunded'][year]['amount'] += amount
                stats_report['refunded_total']['count'] += 1
                stats_report['refunded_total']['amount'] += amount
            else:
                stats_report['skipped_records'] += 1

        start_key = response.get('LastEvaluatedKey', None)
        done = start_key is None
        print(f"... Scanned transactions batch...")

    # Output Results
    print("\n" + "="*50)
    print("SYNC REPORT")
    print("="*50)
    print(f"Scanned Students: {stats_sync['scanned_students']}")
    print(f"Scanned Offering Intents: {stats_sync['scanned_intents']}")
    print(f"Missing Transaction Record: {stats_sync['missing_tx']}")
    print(f"Invalid State Transaction: {stats_sync['invalid_state_tx']}")
    print(f"Refunds Synced (Updated): {stats_sync['marked_refunded']}")
    print(f"Already Refunded: {stats_sync['already_refunded']}")
    
    print("\n" + "="*50)
    print("FINANCIAL REPORT (Transactions Table)")
    print("="*50)
    print("RETAINED REVENUE (Status=COMPLETED)")
    print(f"  Total: {stats_report['completed_total']['count']} txs | ${stats_report['completed_total']['amount']:,.2f}")
    print("  By Year:")
    for yr in sorted(stats_report['completed'].keys()):
        d = stats_report['completed'][yr]
        print(f"    {yr}: {d['count']:<5} (${d['amount']:,.2f})")
        
    print("-" * 50)
    print("REFUNDED (Status=REFUNDED)")
    print(f"  Total: {stats_report['refunded_total']['count']} txs | ${stats_report['refunded_total']['amount']:,.2f}")
    print("  By Year:")
    for yr in sorted(stats_report['refunded'].keys()):
        d = stats_report['refunded'][yr]
        print(f"    {yr}: {d['count']:<5} (${d['amount']:,.2f})")
    print("-" * 50)
    print(f"Skipped Records (Invalid Status/Step): {stats_report['skipped_records']}")
    print("="*50)

def main():
    parser = argparse.ArgumentParser(description='Reconcile transactions.')
    parser.add_argument('--profile', required=False, help='AWS CLI profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    # Allow args override but default to env
    
    args = parser.parse_args()
    
    student_table = os.environ.get('STUDENT_TABLE')
    tx_table = os.environ.get('TRANSACTIONS_TABLE')
    
    if not student_table or not tx_table:
        print("Error: STUDENT_TABLE and TRANSACTIONS_TABLE env vars must be set.")
        sys.exit(1)

    try:
        reconcile_transactions(args.profile, student_table, tx_table, args.dry_run)
    except Exception as e:
        print(f"An error occurred: {e}")
        # import traceback; traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
