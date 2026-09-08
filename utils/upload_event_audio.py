#!/usr/bin/env python3
"""
Upload teaching audio (.m4a) for an event/sub-event/index/language and record it in the
event's DynamoDB record.

Audio availability mirrors how video availability is already expressed: the sub-event
carries an `embeddedAudioList` array whose index is the session number within that
sub-event, and each element is a map keyed by English language name. A language is
available iff its key is present.

    subEvents.weekend3.embeddedAudioList = [
        {"English": {"key": "a/vy2026/weekend3/0/English.m4a", "durationSec": 8412, ...},
         "Spanish": {...}},
        {"English": {...}}          # second session that weekend
    ]

Authentication uses your cached AWS credentials via --profile; nothing is embedded here.

Examples:
    # one file
    python utils/upload_event_audio.py --profile slsupport \
        --aid vy2026 --subevent weekend1 --index 0 --language English \
        --file ~/audio/vy2026-w1-en.m4a

    # a whole session in every language, from a directory of English.m4a, Spanish.m4a, ...
    python utils/upload_event_audio.py --profile slsupport \
        --aid vy2026 --subevent weekend1 --index 0 --all-languages ~/audio/vy2026-w1/

    # show what is present, and what is missing
    python utils/upload_event_audio.py --profile slsupport --aid vy2026 --list

    # replace an existing recording (e.g. re-uploaded with an intro prepended)
    python utils/upload_event_audio.py --profile slsupport \
        --aid vy2026 --subevent weekend3 --index 0 --language English \
        --file ~/audio/vy2026-w3-s1-en-with-intro.m4a --replace

Replacing reuses the same S3 key, so the CloudFront edge cache is invalidated
automatically — objects are served with a one-year max-age and the distribution holds
them for at least a day, so without that students would keep hearing the old recording.
Deleting invalidates for the same reason.
"""

import argparse
import hashlib
import os
import struct
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
DEFAULT_BUCKET = os.environ.get("AUDIO_BUCKET", "sl-teaching-audio")
DEFAULT_EVENTS_TABLE = os.environ.get("DYNAMODB_TABLE_EVENTS", "events")
DEFAULT_AUDIO_DOMAIN = os.environ.get("AUDIO_DOMAIN", "audio.slsupport.link")
DEFAULT_DISTRIBUTION_ID = os.environ.get("AUDIO_DISTRIBUTION_ID")

# Same language key space as embeddedVideoList, the prompts table and
# student.writtenLangPref. The keys are English language names, not codes.
KNOWN_LANGUAGES = [
    "Chinese", "Czech", "Dutch", "English", "French",
    "German", "Italian", "Portuguese", "Russian", "Spanish",
]

# Non-language keys reserved on an embeddedAudioList element, mirroring
# VIDEO_ENTRY_METADATA_KEYS in apps/student-dashboard/components/EmbeddedVideo.tsx.
AUDIO_ENTRY_METADATA_KEYS = {"title", "password"}

CONTENT_TYPE = "audio/mp4"
# Objects are immutable at a given key; a re-upload is a new version behind the same URL,
# so let the edge and the browser hold onto them.
CACHE_CONTROL = "private, max-age=31536000, immutable"


# --------------------------------------------------------------------------------------
# MP4 inspection (no third-party dependency: the same atom walk gives us duration and
# proves the moov atom precedes mdat, which is what makes progressive seeking work).
# --------------------------------------------------------------------------------------

def _iter_top_level_atoms(fh):
    """Yield (atom_type, payload_offset, payload_size) for each top-level MP4 atom."""
    fh.seek(0, os.SEEK_END)
    file_size = fh.tell()
    fh.seek(0)
    offset = 0
    while offset < file_size:
        fh.seek(offset)
        header = fh.read(8)
        if len(header) < 8:
            return
        size, atom_type = struct.unpack(">I4s", header)
        header_size = 8
        if size == 1:
            ext = fh.read(8)
            if len(ext) < 8:
                return
            size = struct.unpack(">Q", ext)[0]
            header_size = 16
        elif size == 0:
            size = file_size - offset
        if size < header_size:
            return
        yield atom_type.decode("latin-1"), offset + header_size, size - header_size
        offset += size


def _find_mvhd_duration(fh, moov_offset: int, moov_size: int) -> Optional[float]:
    """Walk moov's direct children for mvhd and return duration in seconds."""
    offset = moov_offset
    end = moov_offset + moov_size
    while offset < end:
        fh.seek(offset)
        header = fh.read(8)
        if len(header) < 8:
            return None
        size, atom_type = struct.unpack(">I4s", header)
        if size < 8:
            return None
        if atom_type == b"mvhd":
            payload = fh.read(size - 8)
            version = payload[0]
            if version == 1:
                # version 1: 8-byte creation/modification, 4-byte timescale, 8-byte duration
                timescale = struct.unpack(">I", payload[20:24])[0]
                duration = struct.unpack(">Q", payload[24:32])[0]
            else:
                # version 0: 4-byte creation/modification, 4-byte timescale, 4-byte duration
                timescale = struct.unpack(">I", payload[12:16])[0]
                duration = struct.unpack(">I", payload[16:20])[0]
            if not timescale:
                return None
            return duration / timescale
        offset += size
    return None


def inspect_m4a(path: str) -> Dict[str, Any]:
    """
    Return {'durationSec', 'faststart', 'brand'} for an MP4/M4A file.

    faststart is True when moov appears before mdat. Without it a browser must download
    the whole file before it can seek, which defeats shuttle control entirely.
    """
    result: Dict[str, Any] = {"durationSec": None, "faststart": False, "brand": None}
    with open(path, "rb") as fh:
        saw_mdat = False
        moov: Optional[Tuple[int, int]] = None
        for atom_type, payload_offset, payload_size in _iter_top_level_atoms(fh):
            if atom_type == "ftyp" and result["brand"] is None:
                fh.seek(payload_offset)
                result["brand"] = fh.read(4).decode("latin-1", errors="replace")
            elif atom_type == "mdat":
                saw_mdat = True
            elif atom_type == "moov":
                moov = (payload_offset, payload_size)
                result["faststart"] = not saw_mdat
                break
        if moov is not None:
            result["durationSec"] = _find_mvhd_duration(fh, moov[0], moov[1])

    if result["durationSec"] is None:
        result["durationSec"] = _ffprobe_duration(path)
    return result


def _ffprobe_duration(path: str) -> Optional[float]:
    """Fallback for files whose moov we could not parse."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode == 0 and out.stdout.strip():
            return float(out.stdout.strip())
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass
    return None


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------------------
# AWS helpers
# --------------------------------------------------------------------------------------

def resolve_distribution_id(session, explicit: Optional[str], domain: str) -> Optional[str]:
    """Find the CloudFront distribution serving `domain`, unless one was named."""
    if explicit:
        return explicit
    try:
        cf = session.client("cloudfront")
        paginator = cf.get_paginator("list_distributions")
        for page in paginator.paginate():
            for dist in (page.get("DistributionList") or {}).get("Items") or []:
                aliases = (dist.get("Aliases") or {}).get("Items") or []
                if domain in aliases:
                    return dist["Id"]
    except ClientError as exc:
        print(f"  WARNING: could not list CloudFront distributions: {exc}", file=sys.stderr)
    return None


def invalidate(session, distribution_id: Optional[str], key: str, domain: str,
               dryrun: bool) -> None:
    """
    Purge one object from the CloudFront edge cache.

    Required whenever an object at an existing key changes or goes away. Objects are
    served with a one-year max-age and the distribution's minimum TTL is a day, so
    without this the edge keeps serving the previous bytes for up to a year — a replaced
    recording would not reach students, and a deleted one would stay streamable.
    """
    path = "/" + key.lstrip("/")
    if dryrun:
        print(f"    DRYRUN: would invalidate {path}")
        return
    if not distribution_id:
        print(f"    WARNING: no CloudFront distribution found for {domain}; the edge will")
        print(f"             keep serving the previous bytes for up to a year. Run:")
        print(f"               aws cloudfront create-invalidation \\")
        print(f"                 --distribution-id <ID> --paths '{path}'")
        return
    try:
        cf = session.client("cloudfront")
        response = cf.create_invalidation(
            DistributionId=distribution_id,
            InvalidationBatch={
                "Paths": {"Quantity": 1, "Items": [path]},
                "CallerReference": f"audio-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            },
        )
        print(f"    invalidated {path} ({response['Invalidation']['Id']}, "
              f"live at the edge within a few minutes)")
    except ClientError as exc:
        print(f"    WARNING: invalidation failed: {exc}", file=sys.stderr)
        print(f"             Students may hear the previous recording. Retry with:")
        print(f"               aws cloudfront create-invalidation \\")
        print(f"                 --distribution-id {distribution_id} --paths '{path}'")


def get_session(profile: Optional[str], region: str):
    if profile:
        return boto3.Session(profile_name=profile, region_name=region)
    return boto3.Session(region_name=region)


def audio_key(aid: str, subevent: str, index: int, language: str) -> str:
    return f"a/{aid}/{subevent}/{index}/{language}.m4a"


def get_event(table, aid: str) -> Dict[str, Any]:
    response = table.get_item(Key={"aid": aid})
    item = response.get("Item")
    if not item:
        raise SystemExit(f"ERROR: no event record with aid '{aid}'")
    return item


def require_subevent(event: Dict[str, Any], subevent: str) -> Dict[str, Any]:
    sub_events = event.get("subEvents") or {}
    if subevent not in sub_events:
        available = ", ".join(sorted(sub_events.keys())) or "(none)"
        raise SystemExit(
            f"ERROR: event '{event.get('aid')}' has no sub-event '{subevent}'.\n"
            f"       Available sub-events: {available}"
        )
    return sub_events[subevent]


def write_audio_entry(
    table, aid: str, subevent: str, index: int, language: str,
    entry: Dict[str, Any], prior_list: Optional[List[Any]], dryrun: bool,
) -> None:
    """
    Replace the whole embeddedAudioList under a condition on its prior value.

    DynamoDB cannot create a list element at an arbitrary index, so this is a
    read-modify-write. The condition makes a concurrent upload fail loudly rather than
    silently discarding the other person's entry.
    """
    new_list: List[Any] = [dict(e) if isinstance(e, dict) else e for e in (prior_list or [])]
    while len(new_list) <= index:
        new_list.append({})
    if not isinstance(new_list[index], dict):
        new_list[index] = {}
    new_list[index][language] = entry

    if dryrun:
        print(f"  DRYRUN: would set subEvents.{subevent}.embeddedAudioList[{index}].{language}")
        return

    kwargs: Dict[str, Any] = {
        "Key": {"aid": aid},
        "UpdateExpression": "SET subEvents.#se.embeddedAudioList = :new",
        "ExpressionAttributeNames": {"#se": subevent},
        "ExpressionAttributeValues": {":new": new_list},
    }
    if prior_list is None:
        kwargs["ConditionExpression"] = "attribute_not_exists(subEvents.#se.embeddedAudioList)"
    else:
        kwargs["ConditionExpression"] = "subEvents.#se.embeddedAudioList = :prior"
        kwargs["ExpressionAttributeValues"][":prior"] = prior_list

    try:
        table.update_item(**kwargs)
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise SystemExit(
                "ERROR: the event record changed while this upload was in flight "
                "(someone else uploaded audio for this sub-event). The S3 object was "
                "written; re-run this command to record it."
            )
        raise


# --------------------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------------------

def cmd_upload_one(args, session, table, aid: str, subevent: str, index: int,
                   language: str, file_path: str) -> None:
    if language not in KNOWN_LANGUAGES:
        raise SystemExit(
            f"ERROR: unknown language '{language}'. Known: {', '.join(KNOWN_LANGUAGES)}"
        )
    if not os.path.isfile(file_path):
        raise SystemExit(f"ERROR: no such file: {file_path}")

    event = get_event(table, aid)
    sub = require_subevent(event, subevent)

    # Replacing an existing recording is a different act from adding a new one: it changes
    # what students who already have the link will hear, so make it explicit rather than
    # letting a mistyped --index silently overwrite a good file.
    prior_list = sub.get("embeddedAudioList")
    existing = None
    if prior_list and index < len(prior_list) and isinstance(prior_list[index], dict):
        existing = prior_list[index].get(language)
    if existing and not args.replace:
        raise SystemExit(
            f"ERROR: {language} audio already exists at {aid}/{subevent}[{index}]\n"
            f"       uploaded {existing.get('uploadedAt', '?')}, "
            f"{int(existing.get('durationSec', 0)) // 60} min, key {existing.get('key')}\n\n"
            "       Pass --replace to overwrite it. The new file is uploaded, the event\n"
            "       record is updated, and the CloudFront edge cache is invalidated so\n"
            "       students hear the new version instead of the old one."
        )

    info = inspect_m4a(file_path)
    if info["brand"] is None:
        raise SystemExit(f"ERROR: {file_path} is not an MP4/M4A file (no ftyp atom).")
    if not info["faststart"]:
        raise SystemExit(
            f"ERROR: {file_path} is not faststart — its mdat atom precedes moov, so a\n"
            "       browser cannot seek until the whole file has downloaded. Remux it:\n\n"
            f"         ffmpeg -i {file_path} -c copy -movflags +faststart fixed.m4a\n\n"
            "       then upload fixed.m4a. (Not fixed automatically: a non-faststart\n"
            "       master usually means the export settings need correcting too.)"
        )
    if info["durationSec"] is None:
        raise SystemExit(f"ERROR: could not determine the duration of {file_path}.")

    size_bytes = os.path.getsize(file_path)
    key = audio_key(aid, subevent, index, language)
    duration_sec = int(round(info["durationSec"]))

    print(f"  {language}: {os.path.basename(file_path)}")
    print(f"    duration {duration_sec // 3600}h{(duration_sec % 3600) // 60:02d}m{duration_sec % 60:02d}s"
          f"  {size_bytes / 1_048_576:.1f} MiB  brand {info['brand']}")
    print(f"    s3://{args.bucket}/{key}")

    checksum = sha256_of(file_path)

    if existing:
        old_duration = int(existing.get("durationSec", 0))
        delta = duration_sec - old_duration
        print(f"    REPLACING a {old_duration // 60}m{old_duration % 60:02d}s recording "
              f"({'+' if delta >= 0 else ''}{delta}s)")

    if args.dryrun:
        print("    DRYRUN: would upload and record")
    else:
        s3 = session.client("s3")
        s3.upload_file(
            file_path, args.bucket, key,
            ExtraArgs={"ContentType": CONTENT_TYPE, "CacheControl": CACHE_CONTROL},
        )
        print("    uploaded")

    entry = {
        "key": key,
        "durationSec": duration_sec,
        "bytes": size_bytes,
        "uploadedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sha256": checksum,
    }
    write_audio_entry(table, aid, subevent, index, language, entry,
                      prior_list, args.dryrun)
    if not args.dryrun:
        print(f"    recorded at subEvents.{subevent}.embeddedAudioList[{index}].{language}")
    # Only a replacement can be stale at the edge; a brand-new key was never cached.
    if existing:
        invalidate(session, args.distribution_id, key, args.domain, args.dryrun)


def cmd_upload(args, session, table) -> None:
    if args.all_languages:
        directory = os.path.expanduser(args.all_languages)
        if not os.path.isdir(directory):
            raise SystemExit(f"ERROR: not a directory: {directory}")
        found = []
        for language in KNOWN_LANGUAGES:
            candidate = os.path.join(directory, f"{language}.m4a")
            if os.path.isfile(candidate):
                found.append((language, candidate))
        if not found:
            raise SystemExit(
                f"ERROR: {directory} contains no <Language>.m4a files.\n"
                f"       Expected names like English.m4a, Spanish.m4a."
            )
        print(f"{args.aid} / {args.subevent} / index {args.index}: {len(found)} language(s)")
        for language, path in found:
            # Re-read the event between languages so each write conditions on the list
            # this run just produced.
            cmd_upload_one(args, session, table, args.aid, args.subevent,
                           args.index, language, path)
        return

    print(f"{args.aid} / {args.subevent} / index {args.index}")
    cmd_upload_one(args, session, table, args.aid, args.subevent, args.index,
                   args.language, os.path.expanduser(args.file))


def cmd_list(args, session, table) -> None:
    event = get_event(table, args.aid)
    sub_events = event.get("subEvents") or {}
    print(f"{args.aid}  {event.get('name', '')}")
    for name in sorted(sub_events.keys(), key=lambda n: str(sub_events[n].get("date", ""))):
        sub = sub_events[name]
        audio_list = sub.get("embeddedAudioList") or []
        video_list = sub.get("embeddedVideoList") or []
        flags = []
        if sub.get("eventOnDeck"):
            flags.append("onDeck")
        if sub.get("eventComplete"):
            flags.append("complete")
        print(f"\n  {name}  {sub.get('date', '?')}  [{', '.join(flags) or 'not on deck'}]"
              f"  video sessions: {len(video_list)}  audio sessions: {len(audio_list)}")

        if not audio_list:
            if video_list:
                print("    (no audio yet)")
            continue

        for index, element in enumerate(audio_list):
            element = element or {}
            present = sorted(k for k in element
                             if k not in AUDIO_ENTRY_METADATA_KEYS and isinstance(element[k], dict))
            missing = [lang for lang in ("English", "Spanish", "French", "German", "Italian", "Czech")
                       if lang not in present]
            title = element.get("title")
            print(f"    [{index}]{' ' + repr(title) if title else ''}")
            for lang in present:
                meta = element[lang]
                dur = int(meta.get("durationSec", 0))
                mib = float(meta.get("bytes", 0)) / 1_048_576
                print(f"      {lang:<12} {dur // 3600}h{(dur % 3600) // 60:02d}m{dur % 60:02d}s"
                      f"  {mib:7.1f} MiB  {meta.get('uploadedAt', '')}")
            if missing:
                print(f"      MISSING: {', '.join(missing)}")


def cmd_delete(args, session, table) -> None:
    event = get_event(table, args.aid)
    sub = require_subevent(event, args.subevent)
    audio_list = sub.get("embeddedAudioList")
    if not audio_list or args.index >= len(audio_list):
        raise SystemExit(f"ERROR: no audio recorded at index {args.index}")
    element = audio_list[args.index] or {}
    if args.language not in element:
        raise SystemExit(f"ERROR: no {args.language} audio at index {args.index}")

    key = element[args.language].get("key") or audio_key(
        args.aid, args.subevent, args.index, args.language)
    print(f"Deleting {args.language} audio at {args.aid}/{args.subevent}[{args.index}]")
    print(f"  s3://{args.bucket}/{key}")

    if args.dryrun:
        print("  DRYRUN: nothing removed")
        return

    new_list = [dict(e) if isinstance(e, dict) else e for e in audio_list]
    del new_list[args.index][args.language]
    table.update_item(
        Key={"aid": args.aid},
        UpdateExpression="SET subEvents.#se.embeddedAudioList = :new",
        ConditionExpression="subEvents.#se.embeddedAudioList = :prior",
        ExpressionAttributeNames={"#se": args.subevent},
        ExpressionAttributeValues={":new": new_list, ":prior": audio_list},
    )
    print("  removed from the event record")
    # The bucket is versioned, so this is a delete marker rather than data loss.
    session.client("s3").delete_object(Bucket=args.bucket, Key=key)
    print("  removed from S3 (previous version retained for 90 days)")
    invalidate(session, args.distribution_id, key, args.domain, args.dryrun)


def cmd_set_title(args, session, table) -> None:
    event = get_event(table, args.aid)
    sub = require_subevent(event, args.subevent)
    audio_list = sub.get("embeddedAudioList")
    if not audio_list or args.index >= len(audio_list):
        raise SystemExit(f"ERROR: no audio recorded at index {args.index}")

    new_list = [dict(e) if isinstance(e, dict) else e for e in audio_list]
    new_list[args.index]["title"] = args.set_title
    print(f"Setting title of {args.aid}/{args.subevent}[{args.index}] to {args.set_title!r}")
    if args.dryrun:
        print("  DRYRUN: nothing written")
        return
    table.update_item(
        Key={"aid": args.aid},
        UpdateExpression="SET subEvents.#se.embeddedAudioList = :new",
        ConditionExpression="subEvents.#se.embeddedAudioList = :prior",
        ExpressionAttributeNames={"#se": args.subevent},
        ExpressionAttributeValues={":new": new_list, ":prior": audio_list},
    )
    print("  done")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Upload teaching audio and record it in the event record.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples:")[-1],
    )
    parser.add_argument("--aid", required=True, help="Event aid, e.g. vy2026")
    parser.add_argument("--subevent", help="Sub-event name, e.g. weekend1")
    parser.add_argument("--index", type=int, default=0,
                        help="Session index within the sub-event (default 0)")
    parser.add_argument("--language", help=f"One of: {', '.join(KNOWN_LANGUAGES)}")
    parser.add_argument("--file", help="Path to the .m4a to upload")
    parser.add_argument("--all-languages", metavar="DIR",
                        help="Upload every <Language>.m4a found in DIR for this index")
    parser.add_argument("--list", action="store_true",
                        help="Show the audio matrix for this event and exit")
    parser.add_argument("--delete", action="store_true",
                        help="Remove one language's audio (object and record)")
    parser.add_argument("--set-title", metavar="TITLE",
                        help="Set the display title of this session index")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET,
                        help=f"S3 bucket (default {DEFAULT_BUCKET})")
    parser.add_argument("--table", default=DEFAULT_EVENTS_TABLE,
                        help=f"DynamoDB events table (default {DEFAULT_EVENTS_TABLE})")
    parser.add_argument("--replace", action="store_true",
                        help="Overwrite audio that already exists at this slot "
                             "(re-uploads, re-records duration, invalidates the CDN)")
    parser.add_argument("--domain", default=DEFAULT_AUDIO_DOMAIN,
                        help=f"Audio delivery hostname (default {DEFAULT_AUDIO_DOMAIN})")
    parser.add_argument("--distribution-id", default=DEFAULT_DISTRIBUTION_ID,
                        help="CloudFront distribution id (default: looked up from --domain)")
    parser.add_argument("--profile", help="AWS profile to use, e.g. slsupport")
    parser.add_argument("--region", default=AWS_REGION, help=f"AWS region (default {AWS_REGION})")
    parser.add_argument("--dryrun", action="store_true",
                        help="Show what would happen without uploading or writing")
    args = parser.parse_args()

    session = get_session(args.profile, args.region)
    table = session.resource("dynamodb").Table(args.table)

    # Resolved once so a replace or delete does not discover a missing distribution only
    # after the object has already changed.
    if args.replace or args.delete:
        args.distribution_id = resolve_distribution_id(session, args.distribution_id, args.domain)

    if args.list:
        cmd_list(args, session, table)
        return

    if not args.subevent:
        raise SystemExit("ERROR: --subevent is required (or use --list)")

    if args.delete:
        if not args.language:
            raise SystemExit("ERROR: --delete requires --language")
        cmd_delete(args, session, table)
        return

    if args.set_title:
        cmd_set_title(args, session, table)
        return

    if args.all_languages:
        cmd_upload(args, session, table)
        return

    if not args.language or not args.file:
        raise SystemExit(
            "ERROR: provide --language and --file, or --all-languages DIR, "
            "or --list / --delete / --set-title"
        )
    cmd_upload(args, session, table)


if __name__ == "__main__":
    main()
