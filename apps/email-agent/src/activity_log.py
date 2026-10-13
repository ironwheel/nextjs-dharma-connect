"""
Best-effort writer for the shared activity log table (see docs/ACTIVITY_LOG.md).

Logging is optional (off unless ACTIVITY_LOG_TABLE is set) and never raises:
a failed activity write must not fail the send it describes.
"""

import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

import boto3

from .config import ACTIVITY_LOG_TABLE, ACTIVITY_LOG_RETENTION_DAYS, config

SOURCE = 'email-agent'

# Detail keys holding email addresses: excluded from searchText, masked in the UI.
EMAIL_DETAIL_KEYS = {'email', 'previousEmail', 'to', 'recipient'}


def build_activity_record(
    activity_type: str,
    summary: str,
    now: datetime,
    retention_days: int,
    student_id: Optional[str] = None,
    student_name: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Builds an activity log item. `summary` must not contain email addresses."""
    ts = now.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    details = {k: v for k, v in (details or {}).items() if v not in (None, '')}
    searchable = [activity_type, SOURCE, student_name, student_id, summary]
    for key, value in details.items():
        if key in EMAIL_DETAIL_KEYS:
            continue
        values = value if isinstance(value, list) else [value]
        searchable.extend(str(v) for v in values if isinstance(v, (str, int)))

    item: Dict[str, Any] = {
        'day': ts[:10],
        'id': f"{ts}#{secrets.token_hex(3)}",
        'ts': ts,
        'type': activity_type,
        'source': SOURCE,
        'summary': summary,
        'searchText': ' '.join(s for s in searchable if s).lower(),
        'expiresAt': int((now + timedelta(days=retention_days)).timestamp()),
    }
    if student_id:
        item['studentId'] = student_id
    if student_name:
        item['studentName'] = student_name
    if details:
        item['details'] = details
    return item


class ActivityLog:
    def __init__(self, table_name: Optional[str] = ACTIVITY_LOG_TABLE, retention_days: int = ACTIVITY_LOG_RETENTION_DAYS):
        self.retention_days = retention_days
        self._table = boto3.resource('dynamodb', region_name=config.aws_region).Table(table_name) if table_name else None

    @property
    def enabled(self) -> bool:
        return self._table is not None

    def record(self, activity_type: str, summary: str, student_id: Optional[str] = None,
               student_name: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> None:
        if not self._table:
            return
        try:
            self._table.put_item(Item=build_activity_record(
                activity_type, summary, datetime.now(timezone.utc), self.retention_days,
                student_id=student_id, student_name=student_name, details=details,
            ))
        except Exception as e:
            print(f"[WARNING] Activity log write failed ({activity_type}): {e}")
