#!/usr/bin/env python3
"""
Build Transaction Cache Script

This script scans the `transactions` table, aggregates data by Year and Month,
and populates the `transactions-cache` table.

Usage:
    export TRANSACTIONS_TABLE=foundations.transactions
    export TRANSACTIONS_CACHE_TABLE=foundations.transactions-cache
    python3 utils/build_transaction_cache.py --profile slsupport
"""

import argparse
print("Importing boto3...")
import boto3
import os
import sys
print("Script started...")
from datetime import datetime
from collections import defaultdict
from decimal import Decimal

def get_table(session, table_name):
    print(f"Getting table {table_name}...")
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)

def build_cache(profile, tx_table_name, cache_table_name, dry_run):
    print(f"Inside build_cache...")
    print(f"Starting Cache Build...")
    print(f"  Profile: {profile}")
    print(f"  Transactions: {tx_table_name}")
    print(f"  Cache: {cache_table_name}")
    if dry_run:
        print("  Mode: DRY RUN (No updates)")

    session = boto3.Session(profile_name=profile, region_name='us-east-1')
    tx_table = get_table(session, tx_table_name)
    cache_table = get_table(session, cache_table_name)

    # Aggregators
    # Key: Year (int) or "YYYY-MM" (str)
    # Value: dict of metrics
    
    # We need separate stores for Years and Months to make it easy
    years_data = defaultdict(lambda: {
        'count': 0, 'amount': Decimal(0), 'stripeFee': Decimal(0), 'kmFee': Decimal(0)
    })
    
    months_data = defaultdict(lambda: {
        'count': 0, 'amount': Decimal(0), 'stripeFee': Decimal(0), 'kmFee': Decimal(0)
    })

    # Scan Transactions
    scan_kwargs = {}
    done = False
    start_key = None
    total_scanned = 0

    print("Scanning transactions...")
    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key
        
        response = tx_table.scan(**scan_kwargs)
        print(f"Response keys: {list(response.keys())}")
        items = response.get('Items', [])
        print(f"Items type: {type(items)}")
        if len(items) > 0:
            print(f"First item type: {type(items[0])}")
            print(f"First item sample: {str(items[0])[:100]}")
        
        total_scanned += len(items)
        
        for tx in items:
            # Debug loop
            if isinstance(tx, str):
                print(f"WTF: tx is string: {tx}")
                continue
            # 1. Basic Validation
            # Filter for COMPLETED and confirmCardPayment as per user request
            status = tx.get('status')
            step = tx.get('step')
            
            if status != 'COMPLETED':
                continue
            if step != 'confirmCardPayment':
                continue

            ts_str = tx.get('timestamp')
            if not ts_str:
                continue

            try:
                # Handle Z/timezone if simple ISO
                dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                year = dt.year
                month = dt.month
            except ValueError:
                continue

            # Extract Metrics
            payer_data = tx.get('payerData', {})
            if isinstance(payer_data, str):
                 # Skip or parse? Usually bad data.
                 # print(f"Skipping record with string payerData: {payer_data[:50]}")
                 continue
            if not isinstance(payer_data, dict):
                 continue

            # amounts in cents
            amount = Decimal(payer_data.get('amount', 0) if payer_data else 0)
            fee = Decimal(payer_data.get('fee', 0) if payer_data else 0)
            
            # kmFee in Dollars -> Convert to Cents for storage?
            # The dashboard converts it ON THE FLY.
            # The PROPOSAL said: "kmFee: Number (Total KM Fee in Dollars, as requested)"??
            # WAIT. The user request in Step 840 said: "payerData.amount is in cents... but kmFee is in dollars".
            # My Dashboard fix multiplies kmFee by 100.
            # The PROPOSAL for Cache said: "kmFee: Number (Total KM Fee in Dollars, as requested)".
            # Let's stick to the Plan: Store KM Fee in DOLLARS.
            # The Dashboard will load it and multiply by 100.
            km_fee = Decimal(tx.get('kmFee', 0) or 0) 

            # Aggregation Keys
            y_key = year
            m_key = f"{year}-{month:02d}"

            # Update Year
            years_data[y_key]['count'] += 1
            years_data[y_key]['amount'] += amount
            years_data[y_key]['stripeFee'] += fee
            years_data[y_key]['kmFee'] += km_fee

            # Update Month
            months_data[m_key]['count'] += 1
            months_data[m_key]['amount'] += amount
            months_data[m_key]['stripeFee'] += fee
            months_data[m_key]['kmFee'] += km_fee

        start_key = response.get('LastEvaluatedKey', None)
        done = start_key is None
        print(f"  Scanned {total_scanned}...", end='\r')

    print(f"\nScanning complete. {total_scanned} records processed.")

    # Write to Cache
    print("Writing to cache...")
    
    with cache_table.batch_writer() as batch:
        # Years
        for year, data in years_data.items():
            # net = amount - (stripe + km*100) -- IF KM is dollars. 
            # Let's calculate net in Cents.
            net = data['amount'] - (data['stripeFee'] + (data['kmFee'] * 100))
            
            item = {
                'id': str(year),
                'type': 'YEAR',
                'year': int(year),
                'count': int(data['count']),
                'amount': int(data['amount']),
                'stripeFee': int(data['stripeFee']),
                'kmFee': Decimal(str(data['kmFee'])), # Validate Decimal
                'net': int(net),
                'currency': 'usd', # assumption
                'updatedAt': datetime.utcnow().isoformat()
            }
            if not dry_run:
                batch.put_item(Item=item)
            print(f"  [YEAR] {year}: {item['count']} txs, ${item['amount']/100:,.2f}")

        # Months
        for m_str, data in months_data.items():
            year_part, month_part = m_str.split('-')
            net = data['amount'] - (data['stripeFee'] + (data['kmFee'] * 100))
            
            item = {
                'id': m_str,
                'type': 'MONTH',
                'year': int(year_part),
                'month': int(month_part) - 1, # Dashboard logic usually 0-11 for Date()? 
                # PROPOSAL said: "0-11 or 1-12". 
                # Let's stick to 0-11 to match JS Date.getMonth() usage in Dashboard filtering.
                'count': int(data['count']),
                'amount': int(data['amount']),
                'stripeFee': int(data['stripeFee']),
                'kmFee': Decimal(str(data['kmFee'])),
                'net': int(net),
                'currency': 'usd',
                'updatedAt': datetime.utcnow().isoformat()
            }
            if not dry_run:
                batch.put_item(Item=item)
            print(f"  [MONTH] {m_str}: {item['count']} txs")

    print("Cache build complete.")

def main():
    parser = argparse.ArgumentParser(description='Build transaction cache.')
    parser.add_argument('--profile', required=False, help='AWS CLI profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run')
    args = parser.parse_args()

    tx_table = os.environ.get('TRANSACTIONS_TABLE')
    cache_table = os.environ.get('TRANSACTIONS_CACHE_TABLE')

    if not tx_table or not cache_table:
        print("Error: TRANSACTIONS_TABLE and TRANSACTIONS_CACHE_TABLE env vars required.")
        sys.exit(1)

    try:
        build_cache(args.profile, tx_table, cache_table, args.dry_run)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
