from __future__ import annotations

import re
from datetime import date, datetime, timezone

DATE_ONLY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_datetime_value(value):
    if value in {None, ""}:
        return None

    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("z", "+00:00").replace("Z", "+00:00"))
        except Exception:
            return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    return dt


def format_display_date(value, fallback: str = "Recently") -> str:
    dt = parse_datetime_value(value)
    if dt is None:
        return fallback
    return dt.astimezone(timezone.utc).strftime("%d %b %Y")


def format_time_ago(value, fallback: str = "recently") -> str:
    dt = parse_datetime_value(value)
    if dt is None:
        return fallback

    now = datetime.now(tz=timezone.utc)
    raw_value = str(value or "").strip()
    if DATE_ONLY_PATTERN.fullmatch(raw_value):
        delta_days = (now.date() - dt.date()).days
        if delta_days <= 0:
            return "just now"
        if delta_days == 1:
            return "yesterday"
        if delta_days < 14:
            return f"{delta_days} days ago"
        if delta_days < 30:
            weeks = max(delta_days // 7, 1)
            suffix = "week" if weeks == 1 else "weeks"
            return f"{weeks} {suffix} ago"
        return format_display_date(dt, fallback=fallback)

    delta_seconds = int((now - dt).total_seconds())
    if delta_seconds <= 0:
        return "just now"
    if delta_seconds < 60:
        return "just now"
    if delta_seconds < 3600:
        minutes = delta_seconds // 60
        return f"{minutes}m ago"
    if delta_seconds < 86400:
        hours = delta_seconds // 3600
        return f"{hours}h ago"

    days = delta_seconds // 86400
    if days == 1:
        return "yesterday"
    if days < 14:
        return f"{days} days ago"
    if days < 30:
        weeks = max(days // 7, 1)
        suffix = "week" if weeks == 1 else "weeks"
        return f"{weeks} {suffix} ago"

    return format_display_date(dt, fallback=fallback)
