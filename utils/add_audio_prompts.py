#!/usr/bin/env python3
"""
Seed the prompt keys the student dashboard's audio section needs.

Two kinds of key are written:

  * Fixed keys (audioOpen, audioClose, ...) are seeded in English only. The dashboard
    returns a '<aid>-<prompt>-<language>-unknown' sentinel for a missing prompt and every
    audio component falls back sensibly on it, so English-only is safe to ship. Translate
    afterwards with the translation manager or translatePromptText.

  * Year titles (controlTitleAudio2026, ...) are copied from the corresponding
    controlTitleVideos<YYYY> rows in *every* language they already exist in. Those labels
    are year names ("2026 Teaching Events"), so the existing translation carries over
    exactly rather than being re-translated.

This writes to the prompts table only. To make the dashboard see them, refresh the cache:

    python utils/refresh_prompts_student_dashboard_cache.py --aid dashboard --tier 1

Usage:
    python utils/add_audio_prompts.py --profile slsupport --dryrun
    python utils/add_audio_prompts.py --profile slsupport
"""

import argparse
import os
import sys

import boto3
from boto3.dynamodb.conditions import Attr

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DEFAULT_PROMPTS_TABLE = os.environ.get("DYNAMODB_TABLE_PROMPTS", "csf.prompts")
DASHBOARD_AID = "dashboard"

# Fixed keys, English. Wording mirrors the existing video prompts where there is a
# counterpart, so the two sections read alike.
ENGLISH_PROMPTS = {
    "controlTitleAudio": "Audio Recording Library...",
    "audioOpen": "Click here to open the audio player",
    "audioClose": "Click here to close the audio player",
    "audioLanguageSelect": "Audio language",
    "audioLanguageNotAvailable":
        "This audio is unavailable in your language. Playing English instead.",
    "audioNotAvailable": "This audio is not available.",
    "audioSpeed": "Speed",
}

VIDEO_YEAR_PREFIX = "dashboard-controlTitleVideos"


def get_session(profile, region):
    if profile:
        return boto3.Session(profile_name=profile, region_name=region)
    return boto3.Session(region_name=region)


def put_prompt(table, name, language, text, dryrun, overwrite):
    key = f"{DASHBOARD_AID}-{name}"
    existing = table.get_item(Key={"prompt": key, "language": language}).get("Item")
    if existing and not overwrite:
        same = existing.get("text") == text
        print(f"  skip   {key} [{language}]{'' if same else '  (differs from proposed text)'}")
        return 0
    if dryrun:
        print(f"  WOULD  {key} [{language}] = {text!r}")
        return 1
    table.put_item(Item={
        "prompt": key,
        "language": language,
        "aid": DASHBOARD_AID,
        "text": text,
    })
    print(f"  wrote  {key} [{language}]")
    return 1


def collect_video_year_titles(table):
    """Every controlTitleVideos<YYYY> row, as {year: {language: text}}."""
    titles = {}
    kwargs = {"FilterExpression": Attr("prompt").begins_with(VIDEO_YEAR_PREFIX)}
    while True:
        response = table.scan(**kwargs)
        for item in response.get("Items", []):
            suffix = item["prompt"][len(VIDEO_YEAR_PREFIX):]
            if not suffix.isdigit():
                continue
            titles.setdefault(suffix, {})[item["language"]] = item["text"]
        if "LastEvaluatedKey" not in response:
            break
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
    return titles


def main():
    parser = argparse.ArgumentParser(
        description="Seed student dashboard audio prompt keys.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Usage:")[-1],
    )
    parser.add_argument("--table", default=DEFAULT_PROMPTS_TABLE,
                        help=f"Prompts table (default {DEFAULT_PROMPTS_TABLE})")
    parser.add_argument("--profile", help="AWS profile, e.g. slsupport")
    parser.add_argument("--region", default=AWS_REGION)
    parser.add_argument("--overwrite", action="store_true",
                        help="Replace prompts that already exist (default: leave them alone)")
    parser.add_argument("--dryrun", action="store_true",
                        help="Show what would be written without writing")
    args = parser.parse_args()

    session = get_session(args.profile, args.region)
    table = session.resource("dynamodb").Table(args.table)

    print(f"Prompts table: {args.table}{'  (DRYRUN)' if args.dryrun else ''}\n")

    print("Fixed audio prompts (English):")
    written = 0
    for name, text in ENGLISH_PROMPTS.items():
        written += put_prompt(table, name, "English", text, args.dryrun, args.overwrite)

    print("\nYear titles, carried over from the video section in every language:")
    year_titles = collect_video_year_titles(table)
    if not year_titles:
        print(f"  none found — no {VIDEO_YEAR_PREFIX}<YYYY> prompts in {args.table}")
    for year in sorted(year_titles):
        for language, text in sorted(year_titles[year].items()):
            written += put_prompt(table, f"controlTitleAudio{year}", language, text,
                                  args.dryrun, args.overwrite)

    print(f"\n{written} prompt row(s) {'would be ' if args.dryrun else ''}written.")
    if not args.dryrun and written:
        print("\nNow refresh the dashboard prompt cache so the dashboard can see them:")
        print("  python utils/refresh_prompts_student_dashboard_cache.py "
              f"--aid {DASHBOARD_AID} --tier 1")


if __name__ == "__main__":
    main()
