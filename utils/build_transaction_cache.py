#!/usr/bin/env python3
"""
Build Transaction Cache Script

This script scans the legacy `transactions` table (v1) and the new `offering-transactions`
table (v2), aggregates data by Year and Month, and populates the `transactions-cache` table.

All cached amounts are in US dollars, whatever currency a payment was made in:
  - v1 rows keep Stripe's balance transaction in payerData, so their amount and fee are already
    the USD Stripe settled, with the exchange rate alongside.
  - v2 rows store the payment's own currency. For non-USD rows the script records Stripe's settled
    USD amount and exchange rate on the row (dashboardUsdAmountCents, dashboardExchangeRate),
    fetching them from Stripe the first time it sees the row. The offering dashboard uses the same
    fields for its totals.
  - KM fees are recorded in the payment's own currency and are converted at its exchange rate.
    Stripe fees are already in USD.
  - A payment whose rate can't be fetched is estimated with the most recent known rate for its
    currency, and reported.

Usage:
    export TRANSACTIONS_TABLE=foundations.transactions
    export OFFERING_TRANSACTIONS_TABLE=foundations.offering-transactions
    export TRANSACTIONS_CACHE_TABLE=foundations.transactions-cache
    export EVENTS_TABLE=foundations.events
    export STRIPE_SECRET_KEY=sk_...   # needed when non-USD v2 payments lack a USD amount
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
from decimal import Decimal, InvalidOperation

USD = 'USD'


def get_table(session, table_name):
    print(f"Getting table {table_name}...")
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)


def v2_km_fee_cents(rec):
    """KM fee in the payment's own currency, in cents: the skuSummary kmFee line, else dashboardKmFeeDollars."""
    for line in rec.get("skuSummary") or []:
        if isinstance(line, dict) and line.get("subEvent") == "kmFee" and line.get("amountCents") is not None:
            return Decimal(str(line["amountCents"]))
    km_fee_dollars = rec.get("dashboardKmFeeDollars")
    return Decimal(str(km_fee_dollars)) * 100 if km_fee_dollars is not None else Decimal(0)


def as_rate(value):
    """A positive exchange rate, or None when missing or unusable (some v1 rows hold the string 'None')."""
    try:
        rate = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return rate if rate.is_finite() and rate > 0 else None


def fetch_settled_usd(stripe, payment_intent_id):
    """(USD cents, exchange rate) Stripe settled for the payment's charge, or (None, None)."""
    pi = stripe.PaymentIntent.retrieve(payment_intent_id, expand=["latest_charge.balance_transaction"])
    charge = pi.get("latest_charge")
    balance_txn = charge.get("balance_transaction") if isinstance(charge, dict) else None
    if not isinstance(balance_txn, dict) or str(balance_txn.get("currency") or "").upper() != USD:
        return None, None
    rate = balance_txn.get("exchange_rate")
    return int(balance_txn["amount"]), Decimal(str(rate)) if rate is not None else Decimal(1)


def build_cache(profile, tx_table_name, cache_table_name, events_table_name, dry_run, stripe_secret):
    print(f"Inside build_cache...")
    print(f"Starting Cache Build...")
    print(f"  Profile: {profile}")
    print(f"  Transactions: {tx_table_name}")
    print(f"  Cache: {cache_table_name}")
    print(f"  Events: {events_table_name}")
    if dry_run:
        print("  Mode: DRY RUN (No updates)")

    session = boto3.Session(profile_name=profile, region_name='us-east-1')
    tx_table = get_table(session, tx_table_name)
    cache_table = get_table(session, cache_table_name)
    events_table = get_table(session, events_table_name)
    off_tx_table = None
    # offering-transactions table is optional; if not provided, we'll build cache from legacy v1 only.
    # This keeps the script safe when deploying before v2 migration/backfill completes.
    off_tx_table_name = os.environ.get("OFFERING_TRANSACTIONS_TABLE")
    if off_tx_table_name:
        off_tx_table = get_table(session, off_tx_table_name)
        print(f"Offering-transactions table: {off_tx_table_name}")
    else:
        print("Warning: OFFERING_TRANSACTIONS_TABLE env var not set; v2 cache contributions will be skipped.")

    # 1. Fetch Events and Build Category Map
    print("Fetching events...")
    aid_to_category = {}
    ignored_aids = set() # Events with list: true should be ignored
    scan_kwargs_events = {}
    done_events = False
    start_key_events = None

    while not done_events:
        if start_key_events:
            scan_kwargs_events['ExclusiveStartKey'] = start_key_events

        response = events_table.scan(**scan_kwargs_events)
        items = response.get('Items', [])

        for event in items:
            aid = event.get('aid')

            # Check for list: true and ignore if set
            if event.get('list') is True:
                if aid:
                    ignored_aids.add(aid)
                continue

            category = event.get('category')
            if not category or category.strip() == "":
                category = "Uncategorized"

            if aid:
                aid_to_category[aid] = category

        start_key_events = response.get('LastEvaluatedKey', None)
        done_events = start_key_events is None

    print(f"Loaded {len(aid_to_category)} events.")

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

    # Category Aggregators
    # Key: (category, year)
    category_years_data = defaultdict(lambda: {
        'count': 0, 'amount': Decimal(0), 'stripeFee': Decimal(0), 'kmFee': Decimal(0)
    })

    # Key: (category, "YYYY-MM")
    category_months_data = defaultdict(lambda: {
        'count': 0, 'amount': Decimal(0), 'stripeFee': Decimal(0), 'kmFee': Decimal(0)
    })

    def add(dt, category, amount, fee, km_fee):
        """Add one payment (amount and Stripe fee in USD cents, KM fee in USD dollars) to every aggregate."""
        m_key = f"{dt.year}-{dt.month:02d}"
        for store, key in (
            (years_data, dt.year),
            (months_data, m_key),
            (category_years_data, (category, dt.year)),
            (category_months_data, (category, m_key)),
        ):
            store[key]['count'] += 1
            store[key]['amount'] += amount
            store[key]['stripeFee'] += fee
            store[key]['kmFee'] += km_fee

    # Completed payments from both tables are gathered first and converted to USD afterwards, once the
    # latest known exchange rate for each currency is available for estimates.
    entries = []
    latest_rates = {}  # currency -> (timestamp, rate)

    def note_rate(currency, dt, rate):
        if currency == USD or rate is None:
            return
        seen = latest_rates.get(currency)
        if seen is None or dt.timestamp() > seen[0]:
            latest_rates[currency] = (dt.timestamp(), rate)

    # Scan Transactions (legacy v1)
    scan_kwargs = {}
    done = False
    start_key = None
    total_scanned = 0

    print("Scanning transactions...")
    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key

        response = tx_table.scan(**scan_kwargs)
        items = response.get('Items', [])

        total_scanned += len(items)

        for tx in items:
            if isinstance(tx, str):
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
            except ValueError:
                continue

            # Extract Metrics
            payer_data = tx.get('payerData', {})
            if not isinstance(payer_data, dict):
                 continue

            # payerData is Stripe's balance transaction, so amount and fee are USD cents.
            amount = Decimal(payer_data.get('amount', 0) if payer_data else 0)
            fee = Decimal(payer_data.get('fee', 0) if payer_data else 0)
            # kmFee is in dollars, in the payment's own currency.
            km_fee = Decimal(tx.get('kmFee', 0) or 0)

            aid = tx.get('aid')
            if aid in ignored_aids:
                continue

            category = aid_to_category.get(aid, "Uncategorized")
            # If for some reason aid is missing or not in events table, default to Uncategorized

            currency = str(tx.get('currency') or USD).upper()
            rate = as_rate(payer_data.get('exchange_rate'))
            if rate is None and currency == USD:
                rate = Decimal(1)
            note_rate(currency, dt, rate)
            entries.append({
                'dt': dt, 'category': category, 'currency': currency, 'amount_usd': amount,
                'fee': fee, 'km_cents': km_fee * 100, 'rate': rate,
            })

        start_key = response.get('LastEvaluatedKey', None)
        done = start_key is None
        print(f"  Scanned {total_scanned}...", end='\r')

    print(f"\nScanning complete. {total_scanned} records processed.")

    # ------------------------------------------------------------
    # Scan offering-transactions (v2)
    # We only aggregate records that correspond to dashboard "COMPLETED"
    # so cache-mode views remain consistent with the existing UI logic.
    # Refunded records are still given their USD amount, for the dashboard's Refunded view.
    # ------------------------------------------------------------
    needs_usd = []
    v2_entries_by_pi = {}
    if off_tx_table is not None:
        scan_kwargs_v2 = {}
        done_v2 = False
        start_key_v2 = None
        total_scanned_v2 = 0

        print("Scanning offering-transactions (v2)...")
        while not done_v2:
            if start_key_v2:
                scan_kwargs_v2['ExclusiveStartKey'] = start_key_v2

            response_v2 = off_tx_table.scan(**scan_kwargs_v2)
            items_v2 = response_v2.get('Items', [])

            total_scanned_v2 += len(items_v2)

            for rec in items_v2:
                dashboard_status = rec.get("dashboardStatus")
                dashboard_step = rec.get("dashboardStep")
                if dashboard_status not in ("COMPLETED", "REFUNDED"):
                    continue
                if dashboard_step != "confirmCardPayment":
                    continue

                currency = str(rec.get("currency") or USD).upper()
                usd_raw = rec.get("dashboardUsdAmountCents")
                rate_raw = rec.get("dashboardExchangeRate")
                if currency != USD and (usd_raw is None or rate_raw is None):
                    needs_usd.append(rec)

                # Only completed payments are aggregated.
                if dashboard_status != "COMPLETED":
                    continue

                # Parse timestamp
                ts_str = (
                    rec.get("dashboardTimestamp")
                    or rec.get("succeededAt")
                    or rec.get("createdAt")
                    or rec.get("updatedAt")
                )
                if not ts_str:
                    continue

                try:
                    dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                except ValueError:
                    continue

                aid = rec.get("eventCode")
                if aid in ignored_aids:
                    continue

                category = aid_to_category.get(aid, "Uncategorized")

                stripe_fee_cents_raw = rec.get("dashboardStripeFeeCents")
                if stripe_fee_cents_raw is None:
                    # If we haven't backfilled this record yet, we can't include it in cache-mode totals reliably.
                    continue

                gross = Decimal(str(rec.get("amount") or 0))
                rate = Decimal(1) if currency == USD else as_rate(rate_raw)
                note_rate(currency, dt, rate)
                entry = {
                    'dt': dt, 'category': category, 'currency': currency,
                    # Gross amount including the KM fee, like v1 rows and the dashboard's own rows;
                    # net subtracts the KM fee.
                    'amount_usd': gross if currency == USD else (Decimal(str(usd_raw)) if usd_raw is not None else None),
                    'gross': gross,
                    # Rows migrated from v1 have no line items and already hold the settled USD amount.
                    'migrated': not rec.get("skuSummary"),
                    'fee': Decimal(str(stripe_fee_cents_raw)),  # Stripe reports its fee in USD
                    'km_cents': v2_km_fee_cents(rec),
                    'rate': rate,
                }
                entries.append(entry)
                v2_entries_by_pi[rec.get("paymentIntentId")] = entry

            start_key_v2 = response_v2.get('LastEvaluatedKey', None)
            done_v2 = start_key_v2 is None
            print(f"  [v2] Scanned {total_scanned_v2}...", end='\r')

        print(f"\n[v2] Scanning complete. {total_scanned_v2} records processed.")

    # Record Stripe's settled USD amount on non-USD v2 payments that don't have one yet.
    if needs_usd:
        if not stripe_secret:
            print(f"Warning: {len(needs_usd)} non-USD v2 payments have no USD amount and no Stripe key was "
                  f"given; they will be estimated.")
        else:
            import stripe
            stripe.api_key = stripe_secret
            fetched = 0
            failed = 0
            write_failed = 0
            print(f"Fetching settled USD amounts from Stripe for {len(needs_usd)} payments...")
            for rec in needs_usd:
                payment_intent_id = rec.get("paymentIntentId")
                try:
                    usd_cents, rate = fetch_settled_usd(stripe, payment_intent_id)
                except Exception as e:
                    usd_cents, rate = None, None
                    print(f"\n  [FAIL] {payment_intent_id}: {e}")
                if usd_cents is None:
                    failed += 1
                    continue
                fetched += 1
                entry = v2_entries_by_pi.get(payment_intent_id)
                if entry is not None:
                    entry['amount_usd'] = Decimal(usd_cents)
                    entry['rate'] = rate
                    note_rate(entry['currency'], entry['dt'], rate)
                if not dry_run:
                    try:
                        off_tx_table.update_item(
                            Key={"paymentIntentId": payment_intent_id},
                            UpdateExpression="SET dashboardUsdAmountCents = :usd, dashboardExchangeRate = :rate",
                            ConditionExpression="attribute_exists(paymentIntentId)",
                            ExpressionAttributeValues={":usd": usd_cents, ":rate": rate},
                        )
                    except Exception as e:
                        # This run still uses the fetched amount; the next run fetches and writes it again.
                        write_failed += 1
                        print(f"\n  [WRITE FAIL] {payment_intent_id}: {e}")
                if (fetched + failed) % 50 == 0:
                    print(f"  {fetched + failed}/{len(needs_usd)}...")
            print(f"Stripe: {fetched} recorded{' (dry run, not written)' if dry_run else ''}, {failed} failed"
                  f"{f', {write_failed} not written' if write_failed else ''}.")

    # Convert every payment to USD and aggregate.
    estimated = defaultdict(int)
    unconverted = defaultdict(int)
    for e in entries:
        rate = e['rate']
        if rate is None:
            known = latest_rates.get(e['currency'])
            if known is None:
                unconverted[e['currency']] += 1
                continue
            rate = known[1]
            estimated[e['currency']] += 1
        amount_usd = e['amount_usd']
        if amount_usd is None:
            amount_usd = e['gross'] if e.get('migrated') else (e['gross'] * rate).quantize(Decimal(1))
        km_fee_usd = (e['km_cents'] * rate / 100).quantize(Decimal('0.01'))
        add(e['dt'], e['category'], amount_usd, e['fee'], km_fee_usd)

    if estimated:
        print(f"Estimated with the latest known rate for their currency: {dict(estimated)}")
    if unconverted:
        print(f"Left out, no rate known for their currency: {dict(unconverted)}")

    # Write to Cache
    print("Writing to cache...")

    with cache_table.batch_writer() as batch:
        # Years
        for year, data in years_data.items():
            # net = amount - (stripe + km*100): amount and stripe fee are cents, KM fee is dollars.
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
                'currency': 'usd',
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
                'month': int(month_part) - 1, # 0-11 to match JS Date.getMonth() in the dashboard
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

        # Category Years
        print("Writing Category Aggregates...")
        for (category, year), data in category_years_data.items():
            net = data['amount'] - (data['stripeFee'] + (data['kmFee'] * 100))

            item = {
                'id': f"CAT#{category}#{year}",
                'type': 'CATEGORY_YEAR',
                'category': category,
                'year': int(year),
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
            print(f"  [CAT-YEAR] {category} {year}: {item['count']} txs")

        # Category Months
        for (category, m_str), data in category_months_data.items():
            year_part, month_part = m_str.split('-')
            net = data['amount'] - (data['stripeFee'] + (data['kmFee'] * 100))

            item = {
                'id': f"CAT#{category}#{m_str}",
                'type': 'CATEGORY_MONTH',
                'category': category,
                'year': int(year_part),
                'month': int(month_part) - 1,
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

    print("Cache build complete.")

def main():
    parser = argparse.ArgumentParser(description='Build transaction cache.')
    parser.add_argument('--profile', required=False, help='AWS CLI profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run')
    parser.add_argument(
        '--stripe-secret',
        default=os.environ.get('STRIPE_SECRET_KEY'),
        help='Stripe secret key, to fetch USD amounts for non-USD payments (default: env STRIPE_SECRET_KEY)',
    )
    args = parser.parse_args()

    tx_table = os.environ.get('TRANSACTIONS_TABLE')
    cache_table = os.environ.get('TRANSACTIONS_CACHE_TABLE')
    events_table = os.environ.get('EVENTS_TABLE')

    if not tx_table or not cache_table or not events_table:
        print("Error: TRANSACTIONS_TABLE, TRANSACTIONS_CACHE_TABLE and EVENTS_TABLE env vars required.")
        sys.exit(1)

    try:
        build_cache(args.profile, tx_table, cache_table, events_table, args.dry_run, args.stripe_secret)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
