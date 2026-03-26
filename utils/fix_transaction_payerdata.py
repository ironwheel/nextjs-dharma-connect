#!/usr/bin/env python3
"""
Utility script for auditing and fixing offering/transaction records by reconciling DynamoDB state with Stripe.

Supports:
- v1 legacy `transactions` table: fix payerData='(none)' for COMPLETED rows
- v2 `offering-transactions` table: reconcile pending rows when Stripe succeeded (complete offering),
  and delete abandoned carts (pending + Stripe not succeeded + older than 7 days)
- v1 legacy pending rows: flag loudly when Stripe succeeded (manual follow-up), and delete abandoned carts
  (pending + Stripe not succeeded + older than 7 days)

Usage:
    export STRIPE_SECRET_KEY=sk_test_...
    export TRANSACTIONS_TABLE=lineage.transactions
    export OFFERING_TRANSACTIONS_TABLE=lineage.offering-transactions   # optional but recommended
    export STUDENT_TABLE=lineage.participants                          # required for v2 completion
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
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Tuple, List

def get_table(session, table_name):
    dynamodb = session.resource('dynamodb')
    return dynamodb.Table(table_name)

def to_dynamo_compatible(py_obj):
    """
    Safely convert a python object (like a dict from Stripe) into
    DynamoDB compatible types (e.g. float -> Decimal).
    """
    # Dump to JSON then load back with parse_float=Decimal
    return json.loads(json.dumps(py_obj), parse_float=Decimal)

def now_iso_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def parse_iso8601(ts: Any) -> Optional[datetime]:
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.astimezone(timezone.utc) if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    s = str(ts).strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def is_older_than_days(ts: Any, days: int) -> Tuple[bool, Optional[datetime], str]:
    dt = parse_iso8601(ts)
    if not dt:
        return (False, None, "missing_or_invalid_timestamp")
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    return (dt < cutoff, dt, "")

def stripe_retrieve_pi(payment_intent_id: str) -> Any:
    return stripe.PaymentIntent.retrieve(payment_intent_id, expand=["latest_charge.balance_transaction"])

def print_header(title: str) -> None:
    print("\n" + "=" * 90)
    print(title)
    print("=" * 90)

def summarize_stripe_pi(pi: Any) -> Dict[str, Any]:
    status = getattr(pi, "status", None) if hasattr(pi, "status") else (pi.get("status") if isinstance(pi, dict) else None)
    created = None
    try:
        created_raw = pi.get("created") if isinstance(pi, dict) else getattr(pi, "created", None)
        if created_raw is not None:
            created = datetime.fromtimestamp(int(created_raw), tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        created = None
    latest_charge = pi.get("latest_charge") if isinstance(pi, dict) else getattr(pi, "latest_charge", None)
    balance_txn = latest_charge.get("balance_transaction") if isinstance(latest_charge, dict) else None
    fee = balance_txn.get("fee") if isinstance(balance_txn, dict) else None
    card = None
    try:
        card = (latest_charge.get("payment_method_details") or {}).get("card") if isinstance(latest_charge, dict) else None
    except Exception:
        card = None
    brand = card.get("brand") if isinstance(card, dict) else None
    last4 = card.get("last4") if isinstance(card, dict) else None
    return {"status": status, "created": created, "fee": fee, "cardBrand": brand, "cardLast4": last4}

def matches_filters(pid_value: Any, payment_id_value: Any, pid_filter: Optional[str], payment_id_filter: Optional[str]) -> bool:
    if pid_filter is not None and str(pid_value) != str(pid_filter):
        return False
    if payment_id_filter is not None and str(payment_id_value) != str(payment_id_filter):
        return False
    return True

def v1_fix_payerdata(record: Dict[str, Any], tx_table, dry_run: bool) -> bool:
    tx_id = record.get("transaction")
    rec_pid = record.get("id")
    aid = record.get("aid")

    print_header(f"[v1 payerData-fix] transaction={tx_id} pid={rec_pid} aid={aid}")
    if not tx_id or not isinstance(tx_id, str) or not tx_id.startswith("pi_"):
        print(f"SKIP: invalid PaymentIntent id in record.transaction: {tx_id!r}")
        return False

    try:
        pi = stripe_retrieve_pi(tx_id)
        pi_summary = summarize_stripe_pi(pi)
        latest_charge = pi.get("latest_charge")
        if not latest_charge:
            print(f"SKIP: Stripe PI has no latest_charge. stripeStatus={pi_summary.get('status')}")
            return False

        balance_txn = latest_charge.get("balance_transaction")
        if not balance_txn:
            print("SKIP: Stripe latest_charge has no balance_transaction expanded")
            return False

        payer_data_dict = json.loads(json.dumps(balance_txn))
        dynamo_payer_data = to_dynamo_compatible(payer_data_dict)

        print("Stripe PI summary:", json.dumps(pi_summary, indent=2))
        print("Computed payerData fields:", json.dumps({
            "id": dynamo_payer_data.get("id"),
            "amount": dynamo_payer_data.get("amount"),
            "currency": dynamo_payer_data.get("currency"),
            "fee": dynamo_payer_data.get("fee"),
            "net": dynamo_payer_data.get("net"),
        }, default=str, indent=2))

        if dry_run:
            print("DRY RUN: WOULD_UPDATE payerData on v1 transactions row.")
        else:
            tx_table.update_item(
                Key={"transaction": tx_id},
                UpdateExpression="SET payerData = :pd",
                ExpressionAttributeValues={":pd": dynamo_payer_data},
            )
            print("UPDATED: payerData written to v1 transactions row.")
        return True
    except stripe.error.StripeError as e:
        print(f"STRIPE_ERROR: {e}")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False

def extract_km_fee_cents_from_sku_summary(sku_summary: Any) -> int:
    if not isinstance(sku_summary, list):
        return 0
    for line in sku_summary:
        try:
            if isinstance(line, dict) and line.get("subEvent") == "kmFee":
                amt = line.get("amountCents")
                return int(amt) if amt is not None else 0
        except Exception:
            continue
    return 0

def v2_update_to_succeeded(off_tx_table, rec: Dict[str, Any], pi_summary: Dict[str, Any], dry_run: bool) -> None:
    payment_intent_id = rec.get("paymentIntentId")
    now = now_iso_z()

    km_fee_cents = extract_km_fee_cents_from_sku_summary(rec.get("skuSummary"))
    gross_amount_cents = int(rec.get("amount") or 0)
    dashboard_amount_cents = gross_amount_cents - km_fee_cents
    dashboard_km_fee_dollars = km_fee_cents / 100 if km_fee_cents else 0

    stripe_fee_cents = None
    try:
        if pi_summary.get("fee") is not None:
            stripe_fee_cents = int(pi_summary["fee"])
    except Exception:
        stripe_fee_cents = None

    card = None
    if pi_summary.get("cardBrand") or pi_summary.get("cardLast4"):
        card = {"brand": pi_summary.get("cardBrand"), "last4": pi_summary.get("cardLast4")}

    print("Planned v2 transaction record update:", json.dumps({
        "status": "succeeded",
        "updatedAt": now,
        "succeededAt": now,
        "dashboardStatus": "COMPLETED",
        "dashboardStep": "confirmCardPayment",
        "dashboardTimestamp": now,
        "dashboardStripeFeeCents": stripe_fee_cents,
        "dashboardKmFeeDollars": dashboard_km_fee_dollars,
        "dashboardAmountCents": dashboard_amount_cents,
        "card": card,
    }, indent=2))

    if dry_run:
        print("DRY RUN: WOULD_UPDATE v2 offering-transactions status->succeeded + dashboard fields.")
        return

    set_parts: List[str] = [
        "#status = :status",
        "#updatedAt = :updatedAt",
        "#succeededAt = :succeededAt",
        "#dashboardStatus = :dashboardStatus",
        "#dashboardStep = :dashboardStep",
        "#dashboardTimestamp = :dashboardTimestamp",
    ]
    expr_values: Dict[str, Any] = {
        ":status": "succeeded",
        ":updatedAt": now,
        ":succeededAt": now,
        ":dashboardStatus": "COMPLETED",
        ":dashboardStep": "confirmCardPayment",
        ":dashboardTimestamp": now,
    }
    expr_names: Dict[str, str] = {
        "#status": "status",
        "#updatedAt": "updatedAt",
        "#succeededAt": "succeededAt",
        "#dashboardStatus": "dashboardStatus",
        "#dashboardStep": "dashboardStep",
        "#dashboardTimestamp": "dashboardTimestamp",
    }
    if stripe_fee_cents is not None:
        set_parts.append("#dashboardStripeFeeCents = :dashboardStripeFeeCents")
        expr_values[":dashboardStripeFeeCents"] = stripe_fee_cents
        expr_names["#dashboardStripeFeeCents"] = "dashboardStripeFeeCents"
    set_parts.append("#dashboardKmFeeDollars = :dashboardKmFeeDollars")
    expr_values[":dashboardKmFeeDollars"] = Decimal(str(dashboard_km_fee_dollars))
    expr_names["#dashboardKmFeeDollars"] = "dashboardKmFeeDollars"
    set_parts.append("#dashboardAmountCents = :dashboardAmountCents")
    expr_values[":dashboardAmountCents"] = int(dashboard_amount_cents)
    expr_names["#dashboardAmountCents"] = "dashboardAmountCents"
    if card is not None:
        set_parts.append("#card = :card")
        expr_values[":card"] = card
        expr_names["#card"] = "card"

    off_tx_table.update_item(
        Key={"paymentIntentId": payment_intent_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeValues=expr_values,
        ExpressionAttributeNames=expr_names,
    )
    print("UPDATED: v2 offering-transactions row set to succeeded.")

def _ensure_student_program_struct(student: Dict[str, Any], event_code: str) -> Dict[str, Any]:
    programs = student.get("programs") if isinstance(student.get("programs"), dict) else {}
    if not isinstance(programs, dict):
        programs = {}
    if event_code not in programs or not isinstance(programs.get(event_code), dict):
        programs[event_code] = {}
    if "offeringHistory" not in programs[event_code] or not isinstance(programs[event_code].get("offeringHistory"), dict):
        programs[event_code]["offeringHistory"] = {}
    student["programs"] = programs
    return student

def _next_installment_key(installments: Dict[str, Any]) -> str:
    n = 1
    while True:
        k = f"installment{n}"
        if k not in installments:
            return k
        n += 1

def write_offering_history_for_person(student_table, person_id: str, event_code: str, current_offerings: Dict[str, Any], payment_intent_id: str, dry_run: bool) -> None:
    resp = student_table.get_item(Key={"id": person_id})
    student = resp.get("Item")
    if not student:
        raise Exception(f"Student not found: {person_id}")

    student = _ensure_student_program_struct(student, event_code)
    offering_history: Dict[str, Any] = student["programs"][event_code]["offeringHistory"]
    now = now_iso_z()

    writes: List[Tuple[str, str]] = []

    for sub_event_name, obj in (current_offerings or {}).items():
        if not isinstance(obj, dict):
            continue
        if obj.get("offeringSKU") is None and obj.get("offeringAmount") is None:
            continue

        if sub_event_name not in offering_history or not isinstance(offering_history.get(sub_event_name), dict):
            offering_history[sub_event_name] = {}
        entry = offering_history[sub_event_name]

        is_installments = obj.get("offeringIntent") == "installments" or obj.get("installments") is True
        if is_installments and obj.get("offeringAmount") is not None:
            entry_installments = entry.get("installments") if isinstance(entry.get("installments"), dict) else {}
            for k in ["offeringIntent", "offeringSKU", "offeringAmount", "offeringTime"]:
                if k in entry:
                    del entry[k]
            installment_key = _next_installment_key(entry_installments)
            entry_installments[installment_key] = {
                "offeringAmount": int(obj.get("offeringAmount")),
                "offeringIntent": payment_intent_id,
                "offeringSKU": obj.get("offeringSKU"),
                "offeringTime": now,
            }
            entry["installments"] = entry_installments
            for k in ["offeringIntent", "offeringSKU", "offeringAmount", "offeringTime"]:
                if k in entry:
                    del entry[k]
            writes.append((sub_event_name, f"installments.{installment_key}"))
            continue

        entry["offeringIntent"] = payment_intent_id
        entry["offeringTime"] = now
        if obj.get("offeringSKU") is not None:
            entry["offeringSKU"] = obj.get("offeringSKU")
        if obj.get("offeringAmount") is not None:
            entry["offeringAmount"] = int(obj.get("offeringAmount"))
        writes.append((sub_event_name, "base"))

    student["programs"][event_code]["offeringHistory"] = offering_history

    print("OfferingHistory writes for student:", person_id)
    for sub, mode in writes:
        print(f"  - WRITE subEvent={sub} mode={mode}")

    if dry_run:
        print("DRY RUN: WOULD_PUT updated student record (offeringHistory).")
        return

    student_table.put_item(Item=student)
    print("UPDATED: student record written with offeringHistory changes.")

def v2_complete_offering(student_table, rec: Dict[str, Any], dry_run: bool) -> None:
    payment_intent_id = rec.get("paymentIntentId")
    event_code = rec.get("eventCode")
    cart = rec.get("cart") if isinstance(rec.get("cart"), list) else []

    print("v2 completion context:", json.dumps({
        "paymentIntentId": payment_intent_id,
        "eventCode": event_code,
        "cartCount": len(cart),
    }, indent=2))

    if not event_code or not isinstance(event_code, str):
        raise Exception(f"Missing/invalid v2 eventCode: {event_code!r}")
    if not isinstance(cart, list) or len(cart) == 0:
        raise Exception("Missing/invalid v2 cart; cannot write offeringHistory")

    for person in cart:
        if not isinstance(person, dict):
            continue
        person_id = person.get("id")
        current_offerings = person.get("currentOfferings") if isinstance(person.get("currentOfferings"), dict) else {}
        if not person_id:
            print("SKIP cart person without id:", json.dumps(person, default=str)[:500])
            continue
        if not current_offerings:
            print(f"SKIP student {person_id}: empty currentOfferings")
            continue
        write_offering_history_for_person(student_table, person_id, event_code, current_offerings, payment_intent_id, dry_run)

def delete_record(table, key: Dict[str, Any], dry_run: bool, label: str) -> None:
    print(f"{'DRY RUN: WOULD_DELETE' if dry_run else 'DELETING'} {label}: key={json.dumps(key)}")
    if dry_run:
        return
    table.delete_item(Key=key)
    print(f"DELETED {label}.")

def main():
    parser = argparse.ArgumentParser(description="Fix transaction payerData from Stripe")
    parser.add_argument('--profile', help='AWS Profile')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--only-one', action='store_true', help='Process only one record and exit')
    parser.add_argument('--pid-filter', help='Only process records with pid equal to this value')
    parser.add_argument('--payment-id-filter', help='Only process records with PaymentIntent id equal to this value (pi_...)')
    args = parser.parse_args()

    # Config Check
    stripe_key = os.environ.get('STRIPE_SECRET_KEY')
    if not stripe_key:
        print("ERROR: STRIPE_SECRET_KEY environment variable not set.")
        sys.exit(1)
    
    stripe.api_key = stripe_key
    
    v1_table_name = os.environ.get('TRANSACTIONS_TABLE', 'lineage.transactions')
    v2_table_name = os.environ.get('OFFERING_TRANSACTIONS_TABLE')
    student_table_name = os.environ.get('STUDENT_TABLE') or os.environ.get('DYNAMODB_TABLE_PARTICIPANTS')

    print_header("Starting fix_transaction_payerdata.py")
    print(f"Profile: {args.profile}")
    print(f"Dry Run: {args.dry_run}")
    print(f"Only One: {args.only_one}")
    print(f"pidFilter: {args.pid_filter}")
    print(f"paymentIdFilter: {args.payment_id_filter}")
    print(f"v1 TRANSACTIONS_TABLE: {v1_table_name}")
    print(f"v2 OFFERING_TRANSACTIONS_TABLE: {v2_table_name or '(not set; v2 disabled)'}")
    print(f"STUDENT_TABLE: {student_table_name or '(not set; v2 completion disabled)'}")

    session = boto3.Session(profile_name=args.profile, region_name='us-east-1')
    v1_table = get_table(session, v1_table_name)
    v2_table = get_table(session, v2_table_name) if v2_table_name else None
    student_table = get_table(session, student_table_name) if student_table_name else None

    processed_count = 0
    updated_count = 0
    deleted_count = 0
    flagged_manual_count = 0

    def handle_only_one() -> None:
        if args.only_one:
            print("Exiting due to --only-one (processed 1 candidate)")
            raise SystemExit(0)

    # ------------------------------------------------------------
    # Fast path for a specific payment intent id (avoid full scans)
    # ------------------------------------------------------------
    if args.payment_id_filter:
        pi_id = str(args.payment_id_filter)
        print_header(f"Direct lookup mode for paymentIntentId={pi_id}")
        v1_item = None
        v2_item = None
        try:
            v1_item = v1_table.get_item(Key={"transaction": pi_id}).get("Item")
        except Exception as e:
            print(f"WARNING: failed to get v1 item: {e}")
        if v2_table:
            try:
                v2_item = v2_table.get_item(Key={"paymentIntentId": pi_id}).get("Item")
            except Exception as e:
                print(f"WARNING: failed to get v2 item: {e}")
        if not v1_item and not v2_item:
            print("No matching record found in v1 or v2 for the provided paymentIntentId.")
            return
        v1_items_for_payer_fix = [v1_item] if v1_item else []
        v1_items_pending = [v1_item] if v1_item else []
        v2_items_pending = [v2_item] if v2_item else []
    else:
        v1_items_for_payer_fix = None
        v1_items_pending = None
        v2_items_pending = None

    # ------------------------------------------------------------
    # Phase A: v1 payerData fix
    # ------------------------------------------------------------
    print_header("Phase A: v1 payerData fix (payerData='(none)' AND status='COMPLETED')")
    if v1_items_for_payer_fix is None:
        scan_kwargs = {"FilterExpression": Attr("payerData").eq("(none)") & Attr("status").eq("COMPLETED")}
        done = False
        start_key = None
        v1_items_for_payer_fix = []
        while not done:
            if start_key:
                scan_kwargs["ExclusiveStartKey"] = start_key
            resp = v1_table.scan(**scan_kwargs)
            v1_items_for_payer_fix.extend(resp.get("Items", []))
            start_key = resp.get("LastEvaluatedKey")
            done = start_key is None
        print(f"Found {len(v1_items_for_payer_fix)} v1 payerData candidates (pre-filter).")

    for item in v1_items_for_payer_fix:
        if not isinstance(item, dict):
            continue
        if not matches_filters(item.get("id"), item.get("transaction"), args.pid_filter, args.payment_id_filter):
            continue
        processed_count += 1
        ok = v1_fix_payerdata(item, v1_table, args.dry_run)
        if ok:
            updated_count += 1
            time.sleep(0.2)
        handle_only_one()

    # ------------------------------------------------------------
    # Phase B: v1 pending reconciliation + abandoned carts
    # ------------------------------------------------------------
    print_header("Phase B: v1 pending reconciliation + abandoned carts")
    if v1_items_pending is None:
        scan_kwargs = {"FilterExpression": Attr("status").eq("PENDING")}
        done = False
        start_key = None
        v1_items_pending = []
        while not done:
            if start_key:
                scan_kwargs["ExclusiveStartKey"] = start_key
            resp = v1_table.scan(**scan_kwargs)
            v1_items_pending.extend(resp.get("Items", []))
            start_key = resp.get("LastEvaluatedKey")
            done = start_key is None
        print(f"Found {len(v1_items_pending)} v1 pending candidates (pre-filter).")

    for item in v1_items_pending:
        if not isinstance(item, dict):
            continue
        tx_id = item.get("transaction")
        pid = item.get("id")
        if not matches_filters(pid, tx_id, args.pid_filter, args.payment_id_filter):
            continue

        print_header(f"[v1 pending] transaction={tx_id} pid={pid} aid={item.get('aid')}")
        if not tx_id or not isinstance(tx_id, str) or not tx_id.startswith("pi_"):
            print(f"SKIP: invalid PaymentIntent id in record.transaction: {tx_id!r}")
            continue

        processed_count += 1
        try:
            pi = stripe_retrieve_pi(tx_id)
            pi_summary = summarize_stripe_pi(pi)
        except stripe.error.StripeError as e:
            print(f"STRIPE_ERROR: {e}")
            handle_only_one()
            continue

        print("DB record summary:", json.dumps({
            "status": item.get("status"),
            "step": item.get("step"),
            "timestamp": item.get("timestamp"),
        }, default=str, indent=2))
        print("Stripe PI summary:", json.dumps(pi_summary, indent=2))

        stripe_status = pi_summary.get("status")
        if stripe_status == "succeeded":
            flagged_manual_count += 1
            print("NEEDS_MANUAL_REVIEW: v1 row is pending but Stripe says succeeded. Per instructions, no auto-fix will be applied.")
            handle_only_one()
            continue

        older, parsed_dt, reason = is_older_than_days(item.get("timestamp"), 7)
        if reason:
            print(f"SKIP_ABANDON_CHECK: cannot evaluate age (reason={reason}).")
            handle_only_one()
            continue

        age_days = (datetime.now(timezone.utc) - (parsed_dt or datetime.now(timezone.utc))).total_seconds() / (24 * 3600)
        print(f"Abandon check: ageDays={age_days:.2f}, olderThan7Days={older}, stripeStatus={stripe_status}")
        if older and stripe_status != "succeeded":
            delete_record(v1_table, {"transaction": tx_id}, args.dry_run, "v1 transactions pending abandoned cart")
            deleted_count += 1
        handle_only_one()

    # ------------------------------------------------------------
    # Phase C: v2 pending reconciliation + abandoned carts
    # ------------------------------------------------------------
    print_header("Phase C: v2 pending reconciliation + abandoned carts")
    if v2_table is None:
        print("Skipping v2 phase: OFFERING_TRANSACTIONS_TABLE env var not set.")
    else:
        if v2_items_pending is None:
            scan_kwargs = {"FilterExpression": Attr("status").eq("pending")}
            done = False
            start_key = None
            v2_items_pending = []
            while not done:
                if start_key:
                    scan_kwargs["ExclusiveStartKey"] = start_key
                resp = v2_table.scan(**scan_kwargs)
                v2_items_pending.extend(resp.get("Items", []))
                start_key = resp.get("LastEvaluatedKey")
                done = start_key is None
            print(f"Found {len(v2_items_pending)} v2 pending candidates (pre-filter).")

        for rec in v2_items_pending:
            if not isinstance(rec, dict):
                continue
            payment_intent_id = rec.get("paymentIntentId")
            pid = rec.get("pid")
            if not matches_filters(pid, payment_intent_id, args.pid_filter, args.payment_id_filter):
                continue

            print_header(f"[v2 pending] paymentIntentId={payment_intent_id} pid={pid} eventCode={rec.get('eventCode')}")
            if not payment_intent_id or not isinstance(payment_intent_id, str) or not payment_intent_id.startswith("pi_"):
                print(f"SKIP: invalid v2 paymentIntentId: {payment_intent_id!r}")
                continue

            processed_count += 1
            try:
                pi = stripe_retrieve_pi(payment_intent_id)
                pi_summary = summarize_stripe_pi(pi)
            except stripe.error.StripeError as e:
                print(f"STRIPE_ERROR: {e}")
                handle_only_one()
                continue

            print("DB record summary:", json.dumps({
                "status": rec.get("status"),
                "createdAt": rec.get("createdAt"),
                "updatedAt": rec.get("updatedAt"),
                "eventCode": rec.get("eventCode"),
                "amount": rec.get("amount"),
                "currency": rec.get("currency"),
                "cartCount": len(rec.get("cart") or []) if isinstance(rec.get("cart"), list) else None,
            }, default=str, indent=2))
            print("Stripe PI summary:", json.dumps(pi_summary, indent=2))

            stripe_status = pi_summary.get("status")
            if stripe_status == "succeeded":
                if student_table is None:
                    print("ERROR: Stripe succeeded but STUDENT_TABLE/DYNAMODB_TABLE_PARTICIPANTS not set; cannot complete offeringHistory. Skipping writes.")
                    handle_only_one()
                    continue
                v2_update_to_succeeded(v2_table, rec, pi_summary, args.dry_run)
                v2_complete_offering(student_table, rec, args.dry_run)
                updated_count += 1
                handle_only_one()
                continue

            older, parsed_dt, reason = is_older_than_days(rec.get("createdAt"), 7)
            if reason:
                print(f"SKIP_ABANDON_CHECK: cannot evaluate age (reason={reason}).")
                handle_only_one()
                continue

            age_days = (datetime.now(timezone.utc) - (parsed_dt or datetime.now(timezone.utc))).total_seconds() / (24 * 3600)
            print(f"Abandon check: ageDays={age_days:.2f}, olderThan7Days={older}, stripeStatus={stripe_status}")
            if older and stripe_status != "succeeded":
                delete_record(v2_table, {"paymentIntentId": payment_intent_id}, args.dry_run, "v2 offering-transactions pending abandoned cart")
                deleted_count += 1
            handle_only_one()

    print_header("Run Summary")
    print(json.dumps({
        "processedCandidates": processed_count,
        "updatedCount": updated_count,
        "deletedCount": deleted_count,
        "flaggedManualCount": flagged_manual_count,
        "dryRun": bool(args.dry_run),
        "pidFilter": args.pid_filter,
        "paymentIdFilter": args.payment_id_filter,
    }, indent=2))

if __name__ == "__main__":
    main()
