"""
@file utils/update_video_domains.py
@copyright Robert E. Taylor, Extropic Systems, 2025
@license MIT
@description Utility script to update Vimeo video domain permissions for embedded videos in events.
"""

import argparse
import boto3
import os
import sys
import requests
import json
from typing import Dict, Any, List, Optional
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# AWS configuration - following the pattern from other utils
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
AWS_PROFILE = os.getenv('AWS_PROFILE', 'slsupport')  # Default to slsupport as per user preferences
EVENTS_TABLE = os.getenv('EVENTS_TABLE', 'events')

# Vimeo configuration
VIMEO_BEARER_TOKEN = os.getenv('VIMEO_BEARER_TOKEN')

if not VIMEO_BEARER_TOKEN:
    print("ERROR: VIMEO_BEARER_TOKEN environment variable must be set.")
    sys.exit(1)

def get_dynamodb_client():
    """
    @function get_dynamodb_client
    @description Get DynamoDB client using the configured AWS profile.
    @returns A DynamoDB client.
    """
    session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
    return session.resource('dynamodb')

def scan_events_table(dynamodb, table_name: str) -> List[Dict[str, Any]]:
    """
    @function scan_events_table
    @description Scan the events table and return all events.
    @param dynamodb - The DynamoDB client.
    @param table_name - The name of the table to scan.
    @returns A list of events.
    """
    table = dynamodb.Table(table_name)
    events = []
    last_evaluated_key = None
    
    while True:
        scan_kwargs = {}
        if last_evaluated_key:
            scan_kwargs['ExclusiveStartKey'] = last_evaluated_key
        
        try:
            response = table.scan(**scan_kwargs)
            events.extend(response.get('Items', []))
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        except Exception as e:
            print(f"Error scanning events table: {e}")
            break
    
    return events

def set_allowed_domain(video_id: str, domain: str, dry_run: bool = False) -> bool:
    """
    @function set_allowed_domain
    @description Set the allowed domain for a Vimeo video.
    @param video_id - The Vimeo video ID.
    @param domain - The domain to allow.
    @param dry_run - If True, don't actually make the API call.
    @returns True if successful, False otherwise.
    """
    url = f"https://api.vimeo.com/videos/{video_id}/privacy/domains/{domain}"
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {VIMEO_BEARER_TOKEN}',
    }
    
    if dry_run:
        print(f"[DRYRUN] Would PUT {url}")
        return True
    
    try:
        response = requests.put(url, headers=headers)
        if response.status_code in [200, 201, 204]:
            print(f"Successfully set domain {domain} for video {video_id}")
            return True
        else:
            print(f"Failed to set domain {domain} for video {video_id}: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"Error setting domain {domain} for video {video_id}: {e}")
        return False

def extract_videos_from_event(event: Dict[str, Any]) -> List[str]:
    """
    @function extract_videos_from_event
    @description Extract all video IDs from an event's embeddedVideoList.
    @param event - The event dictionary from DynamoDB.
    @returns List of video IDs found in the event.
    """
    videos = []
    
    try:
        sub_events = event.get('subEvents', {})
        for subevent_name, subevent_data in sub_events.items():
            try:
                video_list = subevent_data.get('embeddedVideoList', [])
                for video in video_list:
                    # Handle case where video is a string (direct video ID)
                    if isinstance(video, str):
                        if video:
                            videos.append(video)
                    # Handle case where video is a dictionary with language keys
                    elif isinstance(video, dict):
                        for language, video_id in video.items():
                            if language not in ['title', 'whichRetreats'] and video_id:
                                videos.append(video_id)
                    else:
                        print(f"  Warning: Unexpected video format: {type(video)} - {video}")
            except (KeyError, TypeError) as e:
                print(f"  Warning: Error processing subevent '{subevent_name}': {e}")
                continue
    except (KeyError, TypeError) as e:
        print(f"  Warning: Error processing event: {e}")
    
    return videos

def process_events(events: List[Dict[str, Any]], allowed_domain: str, 
                  aid_filter: Optional[str] = None, subevent_filter: Optional[str] = None,
                  dry_run: bool = False, debug: bool = False) -> Dict[str, int]:
    """
    @function process_events
    @description Process events and update video domains.
    @param events - List of events from DynamoDB.
    @param allowed_domain - Domain to allow for videos.
    @param aid_filter - Optional aid to filter events.
    @param subevent_filter - Optional subevent to filter.
    @param dry_run - If True, don't actually make API calls.
    @param debug - If True, show debug information about video structure.
    @returns Dictionary with counts of processed items.
    """
    stats = {
        'events_processed': 0,
        'videos_found': 0,
        'videos_updated': 0,
        'videos_failed': 0
    }
    
    for event in events:
        # Apply aid filter if specified
        if aid_filter and event.get('aid') != aid_filter:
            continue
        
        print(f"Processing event: {event.get('name', 'Unknown')} (aid: {event.get('aid', 'Unknown')})")
        
        if debug:
            print(f"  Debug: Event has {len(event.get('subEvents', {}))} subevents")
        
        # Apply subevent filter if specified
        if subevent_filter:
            sub_events = event.get('subEvents', {})
            if subevent_filter not in sub_events:
                print(f"  Skipping - subevent '{subevent_filter}' not found")
                continue
            
            # Process only the specified subevent
            subevent_data = sub_events[subevent_filter]
            try:
                video_list = subevent_data.get('embeddedVideoList', [])
                if debug:
                    print(f"  Debug: Subevent '{subevent_filter}' has {len(video_list)} videos")
                    print(f"  Debug: Video list structure: {video_list}")
                for video in video_list:
                    # Handle case where video is a string (direct video ID)
                    if isinstance(video, str):
                        if video:
                            print(f"  Processing video: {video}")
                            stats['videos_found'] += 1
                            if set_allowed_domain(video, allowed_domain, dry_run):
                                stats['videos_updated'] += 1
                            else:
                                stats['videos_failed'] += 1
                    # Handle case where video is a dictionary with language keys
                    elif isinstance(video, dict):
                        for language, video_id in video.items():
                            if language not in ['title', 'whichRetreats'] and video_id:
                                print(f"  Processing video: {language} - {video_id}")
                                stats['videos_found'] += 1
                                if set_allowed_domain(video_id, allowed_domain, dry_run):
                                    stats['videos_updated'] += 1
                                else:
                                    stats['videos_failed'] += 1
                    else:
                        print(f"  Warning: Unexpected video format: {type(video)} - {video}")
            except (KeyError, TypeError) as e:
                print(f"  Error processing subevent '{subevent_filter}': {e}")
        else:
            # Process all subevents
            videos = extract_videos_from_event(event)
            if debug:
                print(f"  Debug: Found {len(videos)} videos in all subevents")
            for video_id in videos:
                print(f"  Processing video: {video_id}")
                stats['videos_found'] += 1
                if set_allowed_domain(video_id, allowed_domain, dry_run):
                    stats['videos_updated'] += 1
                else:
                    stats['videos_failed'] += 1
        
        stats['events_processed'] += 1
    
    return stats

def main():
    """
    @function main
    @description Main function to run the video domain update utility.
    """
    parser = argparse.ArgumentParser(
        description='Update Vimeo video domain permissions for embedded videos in events'
    )
    
    parser.add_argument('--allowed-domain', required=True,
                       help='Domain to allow for videos (e.g., "example.com")')
    parser.add_argument('--dry-run', action='store_true',
                       help='Show what would be done without making changes')
    parser.add_argument('--aid', help='Filter to specific aid')
    parser.add_argument('--subevent', help='Filter to specific subevent')
    parser.add_argument('--debug', action='store_true',
                       help='Show debug information about video structure')
    
    args = parser.parse_args()
    
    print(f"Starting video domain update utility")
    print(f"Allowed domain: {args.allowed_domain}")
    print(f"Dry run: {args.dry_run}")
    if args.aid:
        print(f"AID filter: {args.aid}")
    if args.subevent:
        print(f"Subevent filter: {args.subevent}")
    if args.debug:
        print(f"Debug mode: enabled")
    print()
    
    # Get DynamoDB client
    try:
        dynamodb = get_dynamodb_client()
        print(f"Connected to DynamoDB using profile: {AWS_PROFILE}")
    except Exception as e:
        print(f"Error connecting to DynamoDB: {e}")
        sys.exit(1)
    
    # Scan events table
    print(f"Scanning events table: {EVENTS_TABLE}")
    events = scan_events_table(dynamodb, EVENTS_TABLE)
    print(f"Found {len(events)} events in table")
    
    if not events:
        print("No events found. Exiting.")
        return
    
    # Process events
    print("\nProcessing events...")
    stats = process_events(
        events=events,
        allowed_domain=args.allowed_domain,
        aid_filter=args.aid,
        subevent_filter=args.subevent,
        dry_run=args.dry_run,
        debug=args.debug
    )
    
    # Print summary
    print("\n" + "="*50)
    print("SUMMARY")
    print("="*50)
    print(f"Events processed: {stats['events_processed']}")
    print(f"Videos found: {stats['videos_found']}")
    print(f"Videos updated: {stats['videos_updated']}")
    print(f"Videos failed: {stats['videos_failed']}")
    
    if args.dry_run:
        print("\nNOTE: This was a dry run - no actual changes were made")
    else:
        print(f"\nSuccessfully updated {stats['videos_updated']} videos with domain {args.allowed_domain}")

    # Print environment variable summary
    print("\n" + "="*50)
    print("ENVIRONMENT VARIABLES USED")
    print("="*50)
    print(f"VIMEO_BEARER_TOKEN: {'Set' if VIMEO_BEARER_TOKEN else 'NOT SET (Required)'}")
    print(f"AWS_REGION: {AWS_REGION}")
    print(f"AWS_PROFILE: {AWS_PROFILE}")
    print(f"EVENTS_TABLE: {EVENTS_TABLE}")

if __name__ == "__main__":
    main()
