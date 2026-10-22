#!/usr/bin/env python3
"""
Process the backlog of unsubscribe requests left by the legacy unsubscribe page.

The legacy page only recorded requests ({id: pid, timestamp, email}) in its own table and
never touched the participant record. For every requested pid whose participant record does
not already have unsubscribe=true, this script:

  - sets unsubscribe=true and unsubscribeTS=<the request's timestamp> on the participant, and
  - logs a `student.unsubscribed` activity (source `unsub-backlog`) with the participant's
    eligibility for the refuge, oath, psb and amitayus-lung pools (see docs/ACTIVITY_LOG.md).

The legacy table is history only: the unsubscribe app updates participant records directly and
never writes to it. Once the legacy page redirects to the new app, no new requests arrive, so run
this after that redirect is live to catch every request made before it.

When a pid has several requests, the latest one is used. Pids with no participant record are
reported and skipped (no record is ever created).

Table names come from the environment, or from flags:
  UNSUB_TABLE                                   legacy unsubscribe requests (pk id, sk timestamp)
  STUDENT_TABLE or DYNAMODB_TABLE_PARTICIPANTS  participants (pk id)
  POOLS_TABLE or DYNAMODB_TABLE_POOLS           pool definitions
  ACTIVITY_LOG_TABLE                            activity log (optional: no logging when unset)

Usage:
  python utils/process_unsub_backlog.py --profile <aws profile> --dry-run
  python utils/process_unsub_backlog.py --profile <aws profile> --output processed.csv
"""

import argparse
import csv
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone

import boto3

# check_eligibility lives in apps/email-agent/src/eligible.py
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.append(os.path.join(project_root, 'apps', 'email-agent', 'src'))

try:
    from eligible import check_eligibility
except ImportError as e:
    print(f"Error importing eligible.py: {e}")
    sys.exit(1)

SOURCE = 'unsub-backlog'
REPORT_POOLS = ['refuge', 'oath', 'psb', 'amitayus-lung']
RETENTION_DAYS = int(os.environ.get('ACTIVITY_LOG_RETENTION_DAYS', '365'))
# Detail keys holding email addresses: excluded from searchText, masked in the UI.
EMAIL_DETAIL_KEYS = {'email', 'previousEmail', 'to', 'recipient'}


def env_table(*names):
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def iso_utc(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def scan_all(table, **kwargs):
    while True:
        resp = table.scan(**kwargs)
        yield from resp.get('Items', [])
        if 'LastEvaluatedKey' not in resp:
            return
        kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']


def latest_requests(unsub_table):
    """Returns {pid: (timestamp, count)} using each pid's latest request."""
    latest = {}
    rows = 0
    for item in scan_all(unsub_table):
        rows += 1
        pid = item.get('id')
        ts = item.get('timestamp')
        if not pid or not ts:
            continue
        prev = latest.get(pid)
        count = (prev[1] if prev else 0) + 1
        latest[pid] = (max(ts, prev[0]) if prev else ts, count)
    return latest, rows


def batch_get_participants(dynamodb, table_name, pids):
    found = {}
    pids = list(pids)
    for i in range(0, len(pids), 100):
        request = {table_name: {'Keys': [{'id': pid} for pid in pids[i:i + 100]]}}
        while request:
            resp = dynamodb.batch_get_item(RequestItems=request)
            for item in resp.get('Responses', {}).get(table_name, []):
                found[item['id']] = item
            request = resp.get('UnprocessedKeys') or None
    return found


def pool_eligibility(student, pools):
    result = {}
    for pool in REPORT_POOLS:
        try:
            result[pool] = bool(check_eligibility(pool, student, pool, pools))
        except Exception as e:
            print(f"  [WARNING] eligibility check {pool} failed for {student.get('id')}: {e}")
            result[pool] = False
    return result


def activity_record(student_id, student_name, summary, details, now):
    """Mirrors activityRecord() in packages/api/lib/activity.ts."""
    ts = iso_utc(now)
    details = {k: v for k, v in details.items() if v not in (None, '')}
    searchable = ['student.unsubscribed', SOURCE, student_name, student_id, summary]
    for key, value in details.items():
        if key in EMAIL_DETAIL_KEYS:
            continue
        for v in value if isinstance(value, list) else [value]:
            if isinstance(v, (str, int)) and not isinstance(v, bool):
                searchable.append(str(v))
    seed = f"{SOURCE}|{student_id}|{ts}"
    item = {
        'day': ts[:10],
        'id': f"{ts}#{hashlib.sha256(seed.encode()).hexdigest()[:6]}",
        'ts': ts,
        'type': 'student.unsubscribed',
        'source': SOURCE,
        'summary': summary,
        'searchText': ' '.join(s for s in searchable if s).lower(),
        'expiresAt': int((now + timedelta(days=RETENTION_DAYS)).timestamp()),
    }
    if student_id:
        item['studentId'] = student_id
    if student_name:
        item['studentName'] = student_name
    if details:
        item['details'] = details
    return item


def main():
    parser = argparse.ArgumentParser(description='Apply unprocessed legacy unsubscribe requests to participant records.')
    parser.add_argument('--profile', required=True, help='AWS profile to use')
    parser.add_argument('--region', default=os.environ.get('AWS_REGION', 'us-east-1'), help='AWS region (default: AWS_REGION or us-east-1)')
    parser.add_argument('--unsubTable', default=env_table('UNSUB_TABLE'), help='Legacy unsubscribe requests table (default: UNSUB_TABLE)')
    parser.add_argument('--studentTable', default=env_table('STUDENT_TABLE', 'DYNAMODB_TABLE_PARTICIPANTS'), help='Participants table (default: STUDENT_TABLE or DYNAMODB_TABLE_PARTICIPANTS)')
    parser.add_argument('--poolsTable', default=env_table('POOLS_TABLE', 'DYNAMODB_TABLE_POOLS'), help='Pools table (default: POOLS_TABLE or DYNAMODB_TABLE_POOLS)')
    parser.add_argument('--activityTable', default=env_table('ACTIVITY_LOG_TABLE'), help='Activity log table (default: ACTIVITY_LOG_TABLE; no logging when unset)')
    parser.add_argument('--dry-run', action='store_true', help='Report what would change without writing')
    parser.add_argument('--yes', action='store_true', help='Skip the confirmation prompt')
    parser.add_argument('--output', help='Write the processed pids to this CSV (pid,name,requestedAt,' + ','.join(REPORT_POOLS) + ')')
    args = parser.parse_args()

    missing = [flag for flag, value in (('--unsubTable', args.unsubTable), ('--studentTable', args.studentTable), ('--poolsTable', args.poolsTable)) if not value]
    if missing:
        parser.error(f"table name(s) not set: {', '.join(missing)} (or the corresponding environment variables)")
    if not args.activityTable:
        print("[WARNING] No activity log table set: changes will not be logged.")

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    dynamodb = session.resource('dynamodb')
    unsub_table = dynamodb.Table(args.unsubTable)
    student_table = dynamodb.Table(args.studentTable)
    activity_table = dynamodb.Table(args.activityTable) if args.activityTable else None

    print("Scanning unsubscribe requests...")
    requests, rows = latest_requests(unsub_table)
    print(f"  {rows} requests for {len(requests)} distinct pids")

    participants = batch_get_participants(dynamodb, args.studentTable, requests.keys())
    not_found = sorted(pid for pid in requests if pid not in participants)
    already = [pid for pid in requests if pid in participants and participants[pid].get('unsubscribe') is True]
    pending = sorted((pid for pid in requests if pid in participants and participants[pid].get('unsubscribe') is not True),
                     key=lambda pid: requests[pid][0])

    print(f"  {len(already)} already unsubscribed")
    print(f"  {len(not_found)} with no participant record")
    for pid in not_found:
        print(f"    not found: {pid}")
    print(f"  {len(pending)} pending")

    if not pending:
        print("Nothing to do.")
        return

    pools = list(scan_all(dynamodb.Table(args.poolsTable)))
    print(f"Loaded {len(pools)} pools")

    if not args.dry_run and not args.yes:
        answer = input(f"Unsubscribe {len(pending)} participants? (yes/no): ").strip().lower()
        if answer != 'yes':
            print("Aborted.")
            return

    updated, failed, log_failed = 0, 0, 0
    processed = []
    for pid in pending:
        student = participants[pid]
        requested_at, count = requests[pid]
        name = ' '.join(p for p in (student.get('first'), student.get('last')) if p).strip()
        eligibility = pool_eligibility(student, pools)
        marks = ' '.join(f"{pool}={'Y' if ok else 'N'}" for pool, ok in eligibility.items())
        prefix = 'DRYRUN: ' if args.dry_run else ''
        print(f"{prefix}{pid} {name or '(no name)'} requested {requested_at}{f' ({count} requests)' if count > 1 else ''} {marks}")
        processed.append([pid, name, requested_at] + [eligibility[p] for p in REPORT_POOLS])
        if args.dry_run:
            continue

        try:
            # Conditional on the record existing, so nothing is ever created.
            student_table.update_item(
                Key={'id': pid},
                UpdateExpression='SET #u = :true, #ts = :ts',
                ConditionExpression='attribute_exists(id)',
                ExpressionAttributeNames={'#u': 'unsubscribe', '#ts': 'unsubscribeTS'},
                ExpressionAttributeValues={':true': True, ':ts': requested_at},
            )
            updated += 1
        except Exception as e:
            failed += 1
            print(f"  [ERROR] update failed for {pid}: {e}")
            continue

        if activity_table:
            item = activity_record(
                pid,
                name or None,
                'Unsubscribed from email (request made on the legacy unsubscribe page)',
                {'email': student.get('email'), 'requestedAt': requested_at, 'eligibility': eligibility},
                datetime.now(timezone.utc),
            )
            try:
                activity_table.put_item(Item=item, ConditionExpression='attribute_not_exists(id)')
            except Exception as e:
                log_failed += 1
                print(f"  [WARNING] activity log write failed for {pid}: {e}")

    print()
    print("Summary")
    print(f"  requests scanned:        {rows}")
    print(f"  distinct pids:           {len(requests)}")
    print(f"  not found:               {len(not_found)}")
    print(f"  already unsubscribed:    {len(already)}")
    print(f"  pending:                 {len(pending)}")
    if not args.dry_run:
        print(f"  updated:                 {updated}")
        print(f"  update failures:         {failed}")
        print(f"  activity log failures:   {log_failed}")

    if args.output:
        with open(args.output, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['pid', 'name', 'requestedAt'] + REPORT_POOLS)
            writer.writerows(processed)
        print(f"Wrote {len(processed)} rows to {args.output}")


if __name__ == '__main__':
    main()
