#!/usr/bin/env python3
"""
Reconciliation script to verify student offering refunds against Stripe.
Checks 'offeringRefund' flags and mock fields against Stripe PaymentIntents.
Adds missing flags if Stripe shows refunded. Reports anomalies.

Usage:
    export STUDENT_TABLE=foundations.participants
    export STRIPE_SECRET=sk_abc123...
    python3 utils/reconcile_refunds.py --profile slsupport --dry-run
"""

import argparse
import boto3
import os
import sys
import stripe
from datetime import datetime
from collections import defaultdict

def get_table(profile_name, table_name, region_name='us-east-1'):
    session = boto3.Session(profile_name=profile_name, region_name=region_name)
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)

def traverse_offerings(programs):
    """
    Generator that yields (event_code, sub_event, context_obj, parent_obj, key_in_parent)
    for every found offeringIntent.
    context_obj is the dict containing 'offeringIntent'.
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
            
            # Check for direct offering (non-installment)
            if 'offeringIntent' in sub_event_data:
                yield event_code, sub_event, sub_event_data, offering_history, sub_event
            
            # Check for installments
            installments = sub_event_data.get('installments', {})
            for inst_name, inst_data in installments.items():
                if isinstance(inst_data, dict) and 'offeringIntent' in inst_data:
                    yield event_code, sub_event, inst_data, installments, inst_name

def reconcile_refunds(profile, table_name, stripe_secret, dry_run):
    print(f"Starting reconciliation on '{table_name}' using profile '{profile}'")
    if dry_run:
        print("DRY RUN MODE: No changes will be written to DynamoDB.")
    
    stripe.api_key = stripe_secret
    table = get_table(profile, table_name)
    
    # Stats
    stats = {
        'total_refunds_count': 0,
        'total_refunds_amount': 0,
        'yearly_refunds': defaultdict(lambda: {'count': 0, 'amount': 0}),
        'total_unrefunded_amount': 0,
        'yearly_unrefunded': defaultdict(lambda: {'count': 0, 'amount': 0}),
        'missing_flag_fixed': 0, # Stripe=Ref, DB=False -> Set True
        'incorrect_flag_found': 0, # Stripe=NotRef, DB=True -> Report
        'invalid_intents': 0,
        'scanned_students': 0,
        'scanned_intents': 0,
        'errors': 0
    }

    scan_kwargs = {}
    done = False
    start_key = None
    
    # Cache Stripe lookups to avoid rate limits or duplicate calls if PI shared (rare)
    pi_cache = {} 

    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key
        
        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])
        
        for student in items:
            stats['scanned_students'] += 1
            student_id = student.get('id')
            programs = student.get('programs', {})
            
            if not programs:
                continue
                
            student_modified = False
            
            for ev_code, sub_ev, offer_obj, parent_obj, key_in_parent in traverse_offerings(programs):
                pi_id = offer_obj.get('offeringIntent')
                
                # Validation
                if not isinstance(pi_id, str) or not pi_id.startswith('pi_'):
                    if pi_id != 'installments': # 'installments' is a special marker, ignore
                        # stats['invalid_intents'] += 1 
                        # Actually 'installments' is valid for the parent container of installments, 
                        # but our traverse yields check for offeringIntent key. 
                        # If offeringIntent == 'installments', it's the parent, skip validation logic
                        pass
                    continue
                
                stats['scanned_intents'] += 1
                
                # Fetch Stripe PI
                pi_data = None
                if pi_id in pi_cache:
                    pi_data = pi_cache[pi_id]
                else:
                    try:
                        # Expand latest_charge to get refund details which might hide there
                        pi_data = stripe.PaymentIntent.retrieve(pi_id, expand=['latest_charge'])
                        pi_cache[pi_id] = pi_data
                    except Exception as e:
                        print(f"  ! Error retrieving Stripe PI {pi_id} (Student {student_id}): {e}")
                        stats['invalid_intents'] += 1
                        continue

                # Analyze Stripe Data
                # Check amount_refunded (cents). 
                # Prefer latest_charge.amount_refunded if available, fallback to pi.amount_refunded
                amount_refunded = pi_data.get('amount_refunded', 0)
                
                latest_charge = pi_data.get('latest_charge')
                if isinstance(latest_charge, dict):
                     # It was expanded
                     charge_refunded = latest_charge.get('amount_refunded', 0)
                     if charge_refunded > amount_refunded:
                         amount_refunded = charge_refunded
                
                is_stripe_refunded = amount_refunded > 0
                
                # Determine Year (from PI creation date)
                created_ts = pi_data.get('created')
                year = datetime.fromtimestamp(created_ts).year if created_ts else 'Unknown'

                # Calculate Unrefunded
                pi_amount = pi_data.get('amount', 0)
                unrefunded_amount = pi_amount - amount_refunded
                if unrefunded_amount > 0:
                    stats['total_unrefunded_amount'] += unrefunded_amount
                    stats['yearly_unrefunded'][year]['amount'] += unrefunded_amount
                    stats['yearly_unrefunded'][year]['count'] += 1
                
                # Analyze DB Data
                db_is_refunded = offer_obj.get('offeringRefund', False)
                
                # Logic
                if is_stripe_refunded:
                    # Update totals
                    stats['total_refunds_count'] += 1
                    stats['total_refunds_amount'] += amount_refunded
                    stats['yearly_refunds'][year]['count'] += 1
                    stats['yearly_refunds'][year]['amount'] += amount_refunded
                    
                    if not db_is_refunded:
                        # CASE: Missing Flag
                        print(f"  [MISSING FLAG] Student {student_id} | {ev_code}/{sub_ev} | PI {pi_id} | Refunded: {amount_refunded/100:.2f}")
                        if not dry_run:
                            offer_obj['offeringRefund'] = True
                            student_modified = True
                            stats['missing_flag_fixed'] += 1
                        else:
                            print(f"    (Dry Run) Would set offeringRefund=True")
                            stats['missing_flag_fixed'] += 1 # Count pending fix
                            
                else:
                    # Not refunded in Stripe
                    if db_is_refunded:
                        # CASE: Incorrect Flag
                        print(f"  [INCORRECT FLAG] Student {student_id} | {ev_code}/{sub_ev} | PI {pi_id} | DB says refunded, Stripe says NO.")
                        stats['incorrect_flag_found'] += 1
                        # We do NOT remove it automatically, just report.
            
            if student_modified and not dry_run:
                try:
                    table.put_item(Item=student)
                    # print(f"  > Saved updates for student {student_id}")
                except Exception as e:
                    print(f"  ! Error saving student {student_id}: {e}")
                    stats['errors'] += 1

        start_key = response.get('LastEvaluatedKey', None)
        done = start_key is None
        
        print(f"... Scanned {stats['scanned_students']} students...")

    # Report
    print("\n" + "="*40)
    print("RECONCILIATION REPORT")
    print("="*40)
    print(f"Scanned Students: {stats['scanned_students']}")
    print(f"Scanned Intents:  {stats['scanned_intents']}")
    print(f"Invalid/Err Intents: {stats['invalid_intents']}")
    print("-" * 20)
    print(f"CONFIRMED REFUNDS (Stripe > 0)")
    print(f"  Total Count:  {stats['total_refunds_count']}")
    print(f"  Total Amount: ${stats['total_refunds_amount']/100:,.2f}")
    print("\nBy Year:")
    for yr in sorted(stats['yearly_refunds'].keys()):
        d = stats['yearly_refunds'][yr]
        print(f"  {yr}: {d['count']:<5} (${d['amount']/100:,.2f})")
    print("-" * 20)
    print(f"UNREFUNDED OFFERINGS (Retained Revenue)")
    print(f"  Total Amount: ${stats['total_unrefunded_amount']/100:,.2f}")
    print("\nBy Year:")
    all_years = sorted(set(list(stats['yearly_refunds'].keys()) + list(stats['yearly_unrefunded'].keys())))
    for yr in all_years:
         d = stats['yearly_unrefunded'].get(yr, {'count':0,'amount':0})
         print(f"  {yr}: {d['count']:<5} (${d['amount']/100:,.2f})")
    print("-" * 20)
    print("DISCREPANCIES")
    print(f"  Missing Flag (Stripe=Yes, DB=No): {stats['missing_flag_fixed']} {'(Fixed)' if not dry_run else '(Found)'}")
    print(f"  Incorrect Flag (Stripe=No, DB=Yes): {stats['incorrect_flag_found']} (Reported only)")
    print("="*40)

def main():
    parser = argparse.ArgumentParser(description='Reconcile refunds with Stripe.')
    parser.add_argument('--profile', required=True, help='AWS CLI profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--table-name', help='DynamoDB table name', default=os.environ.get('STUDENT_TABLE', 'foundations.participants'))
    
    args = parser.parse_args()
    
    stripe_secret = os.environ.get('STRIPE_SECRET')
    if not stripe_secret:
        print("Error: STRIPE_SECRET env var must be set.")
        sys.exit(1)

    try:
        reconcile_refunds(args.profile, args.table_name, stripe_secret, args.dry_run)
    except Exception as e:
        print(f"An error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
