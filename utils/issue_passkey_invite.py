#!/usr/bin/env python3
"""
Issue a single-use passkey enrollment invite directly in DynamoDB and print its link.

For bootstrapping: the first sys admin uses this to enroll before student-manager (which issues invites
normally) requires a passkey. The link is printed, not emailed; open it on the device you want to enroll.

Reads APP_ACCESS_JSON and table names from the API's env file. The invite matches what the API's
passkeyInviteSend writes: only a SHA-256 hash of the token is stored, and it expires after --hours.

The app must have "authMode": "passkey-optional" or "passkey-required" in the API's production
APP_ACCESS_JSON for the link to work.

Example:
  python3 utils/issue_passkey_invite.py --pid <your-pid> --app student-manager \
      --env-file packages/api/.env.local --profile <aws-profile>
"""

import argparse
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sys
import time

import boto3
from boto3.dynamodb.conditions import Key

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
INVITE_RETENTION_SECONDS = 7 * 24 * 60 * 60


def read_env_file(path: str) -> dict:
    values = {}
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def require(env: dict, key: str) -> str:
    if not env.get(key):
        sys.exit(f"Error: {key} is not set in the env file")
    return env[key]


def find_app(access_list: list, app: str) -> dict:
    exact = [e for e in access_list if e.get("host") == app]
    if exact:
        return exact[0]
    by_prefix = [e for e in access_list if e.get("host", "").split(".")[0] == app]
    if len(by_prefix) != 1:
        sys.exit(f"Error: app '{app}' matches {len(by_prefix)} hosts in APP_ACCESS_JSON; pass the full host")
    return by_prefix[0]


def main():
    parser = argparse.ArgumentParser(description="Issue a passkey enrollment invite and print its link.")
    parser.add_argument("--pid", required=True, help="Participant ID to invite")
    parser.add_argument("--app", required=True, help="App the link opens: full host, or its first label (e.g. student-manager)")
    parser.add_argument("--env-file", default="packages/api/.env.local", help="API env file with APP_ACCESS_JSON and table names")
    parser.add_argument("--hours", type=float, default=72, help="Hours until the invite expires (default 72)")
    parser.add_argument("--profile", help="AWS profile")
    parser.add_argument("--region", default=AWS_REGION, help="AWS region")
    args = parser.parse_args()

    env = read_env_file(args.env_file)
    access_list = json.loads(require(env, "APP_ACCESS_JSON"))
    entry = find_app(access_list, args.app)
    host = entry["host"]
    if entry.get("sessionMode") == "silent":
        sys.exit(f"Error: {host} is a silent app; passkeys don't apply to it")

    session = boto3.Session(profile_name=args.profile, region_name=args.region) if args.profile else boto3.Session(region_name=args.region)
    dynamodb = session.resource("dynamodb")

    # The participant must exist (participants table, or auditors) and be permitted on the app
    participant = dynamodb.Table(require(env, "DYNAMODB_TABLE_PARTICIPANTS")).get_item(Key={"id": args.pid}).get("Item")
    if not participant and env.get("DYNAMODB_TABLE_AUDITORS"):
        participant = dynamodb.Table(env["DYNAMODB_TABLE_AUDITORS"]).get_item(Key={"id": args.pid}).get("Item")
    if not participant:
        sys.exit(f"Error: participant {args.pid} not found")
    auth_table = dynamodb.Table(require(env, "DYNAMODB_TABLE_AUTH"))
    auth = auth_table.get_item(Key={"id": args.pid}).get("Item") or auth_table.get_item(Key={"id": "default"}).get("Item") or {}
    if host not in (auth.get("permitted-hosts") or []):
        sys.exit(f"Error: participant {args.pid} is not permitted on {host}")

    # Warn when the participant can't register another passkey
    passkeys = dynamodb.Table(require(env, "DYNAMODB_TABLE_PASSKEYS")).query(KeyConditionExpression=Key("pid").eq(args.pid)).get("Items", [])
    max_passkeys = int(auth.get("maxPasskeys", 1)) if auth.get("id") == args.pid else 1
    if len(passkeys) >= max_passkeys:
        print(f"Warning: {args.pid} already has {len(passkeys)} passkey(s) (limit {max_passkeys}); enrollment will be refused", file=sys.stderr)

    token = secrets.token_urlsafe(32)
    now_ms = int(time.time() * 1000)
    expires_ms = now_ms + int(args.hours * 3600 * 1000)
    dynamodb.Table(require(env, "DYNAMODB_TABLE_PASSKEY_INVITES")).put_item(Item={
        "inviteHash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
        "pid": args.pid,
        "issuedBy": f"script:{getpass.getuser()}",
        "linkHost": host,
        "createdAt": now_ms,
        "expiresAt": expires_ms,
        "ttl": expires_ms // 1000 + INVITE_RETENTION_SECONDS,
    })

    secret = entry.get("secret", "none")
    app_hash = "none" if secret == "none" else hmac.new(bytes.fromhex(secret), args.pid.encode("utf-8"), hashlib.sha256).hexdigest()
    print(f"Invite for {args.pid} on {host}, expires {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(expires_ms / 1000))}")
    print("Open this link once, on the device you want to enroll. It works only once; don't share it.")
    print(f"https://{host}/login?pid={args.pid}&hash={app_hash}&invite={token}")


if __name__ == "__main__":
    main()
