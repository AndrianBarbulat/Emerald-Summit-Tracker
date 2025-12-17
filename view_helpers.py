from __future__ import annotations

import re
from datetime import datetime, timezone

from flask import current_app, request, session, url_for

from badges import (
    BADGE_ICON_LOOKUP,
    BADGE_LABELS,
    DASHBOARD_BADGE_RULES,
    build_achievement_catalog,
    build_user_badge_stats,
    build_user_badge_stats_from_data,
    get_badge_definition,
    normalize_badge_key,
)
from supabase_utils import (
    calculate_climb_streak,
    get_all_peaks,
    get_peak_statuses,
    get_user_badges,
    get_user_climb_history,
)
from time_utils import format_display_date
from web_utils import (
    FEET_PER_METER,
    PROVINCE_ORDER,
    current_height_unit_for_preference as _current_height_unit_for_preference,
    format_short_date as _format_short_date,
    height_display_value as _height_display_value,
    parse_datetime as _parse_datetime,
    pluralize_weeks as _pluralize_weeks,
    relative_time as _relative_time,
    to_float as _to_float,
)
from weather import get_peak_weather

def _difficulty_numeric_value(value) -> float | None:
    if value is None or str(value).strip() == "":
        return None

    try:
        numeric = float(value)
        if 0 <= numeric <= 5:
            return numeric
        return None
    except (TypeError, ValueError):
        pass

    named_values = {
        "easy": 1.0,
        "moderate": 2.0,
        "medium": 2.0,
        "hard": 3.0,
        "challenging": 3.0,
        "very hard": 4.0,
        "strenuous": 4.0,
        "expert": 5.0,
        "extreme": 5.0,
    }
    return named_values.get(str(value or "").strip().lower())


def _difficulty_star_count(value) -> int:
    numeric_value = _difficulty_numeric_value(value)
    if numeric_value is None:
        return 0
    return max(0, min(5, int(round(numeric_value))))


def _profile_visibility_value(profile: dict | None) -> str:
    if not isinstance(profile, dict):
        return ""

    candidate_values = [
        profile.get("profile_visibility"),
        profile.get("public_profile"),
        profile.get("is_public"),
        profile.get("show_profile"),
    ]

    preferences = profile.get("preferences")
    if isinstance(preferences, dict):
        candidate_values.extend(
            [
                preferences.get("profile_visibility"),
                preferences.get("public_profile"),
                preferences.get("is_public"),
                preferences.get("show_profile"),
            ]
        )

    for value in candidate_values:
        if isinstance(value, bool):
            return "public" if value else "private"

        normalized = str(value or "").strip().lower()
        if normalized:
            return normalized

    return ""


def _is_profile_public(profile: dict | None) -> bool:
    visibility = _profile_visibility_value(profile)
    if visibility in {"private", "only me", "me", "hidden", "off", "false", "0", "none", "friends", "only friends"}:
        return False
    if visibility in {"public", "everyone", "all", "true", "1", "on", "yes"}:
        return True
    return bool(str((profile or {}).get("display_name") or "").strip())


def _profile_url_for(profile: dict | None, current_user_id: str | None) -> str | None:
    if not isinstance(profile, dict):
        return None

    display_name = str(profile.get("display_name") or "").strip()
    if not display_name:
        return None

    profile_user_id = str(profile.get("id") or "").strip()
    if current_user_id and profile_user_id == str(current_user_id):
        return url_for("my_profile")

    return url_for("public_profile", display_name=display_name)


def _build_peak_climber_entries(climbers: list[dict], current_user_id: str | None) -> list[dict]:
    unique_climbers = []
    seen_keys = set()

    for climber in climbers:
        current_climber = dict(climber or {})
        profile = dict(current_climber.get("profile") or {})
        display_name = str(current_climber.get("display_name") or profile.get("display_name") or "").strip()
        user_id = str(current_climber.get("user_id") or profile.get("id") or "").strip()
        unique_key = user_id or display_name or str(current_climber.get("id") or "")
        if not unique_key or unique_key in seen_keys:
            continue

        seen_keys.add(unique_key)
        profile_record = {
            **profile,
            "id": profile.get("id") or user_id,
            "display_name": profile.get("display_name") or display_name,
        }
        raw_date = current_climber.get("date_climbed") or current_climber.get("climbed_at") or current_climber.get("created_at")
        difficulty_rating = current_climber.get("difficulty_rating") or current_climber.get("difficulty")
        unique_climbers.append(
            {
                **current_climber,
                "date_climbed": raw_date,
                "date_label": _format_short_date(raw_date),
                "difficulty_rating": difficulty_rating,
                "difficulty_stars": _difficulty_star_count(difficulty_rating),
                "is_private_profile": bool(
                    display_name
                    and not _is_profile_public(profile_record)
                    and (not current_user_id or user_id != str(current_user_id))
                ),
                "profile_url": _profile_url_for(profile_record, current_user_id),
            }
        )

    return unique_climbers


def _build_peak_comment_entries(comments: list[dict], current_user_id: str | None) -> list[dict]:
    comment_entries = []
    for comment in comments:
        current_comment = dict(comment or {})
        profile = dict(current_comment.get("profile") or {})
        display_name = str(current_comment.get("display_name") or profile.get("display_name") or "").strip()
        user_id = str(current_comment.get("user_id") or profile.get("id") or "").strip()
        profile_record = {
            **profile,
            "id": profile.get("id") or user_id,
            "display_name": profile.get("display_name") or display_name,
        }
        created_at = current_comment.get("created_at")
        comment_entries.append(
            {
                **current_comment,
                "comment_text": current_comment.get("comment_text") or current_comment.get("text") or "",
                "relative_time": _relative_time(created_at),
                "profile_url": _profile_url_for(profile_record, current_user_id),
                "can_delete": bool(current_user_id and user_id == str(current_user_id)),
            }
        )

    return comment_entries


def _build_user_peak_climb_entries(user_climbs: list[dict]) -> list[dict]:
    climb_entries = []
    for climb in user_climbs:
        current_climb = dict(climb or {})
        raw_date = current_climb.get("date_climbed") or current_climb.get("climbed_at") or current_climb.get("created_at")
        difficulty_rating = current_climb.get("difficulty_rating") or current_climb.get("difficulty")
        climb_entries.append(
            {
                **current_climb,
                "date_climbed": raw_date,
                "date_label": _format_short_date(raw_date),
                "difficulty_rating": difficulty_rating,
                "difficulty_stars": _difficulty_star_count(difficulty_rating),
            }
        )

    return climb_entries


def _notes_preview(value: str | None, limit: int = 50) -> str:
    collapsed_text = re.sub(r"\s+", " ", str(value or "").strip())
    if not collapsed_text:
        return "No notes added"
    if len(collapsed_text) <= limit:
        return collapsed_text
    return collapsed_text[: max(limit - 3, 1)].rstrip() + "..."


def _build_my_climb_entries(climbs: list[dict]) -> list[dict]:
    climb_entries = []
    for climb in climbs:
        current_climb = dict(climb or {})
        raw_date = current_climb.get("date_climbed") or current_climb.get("climbed_at") or current_climb.get("created_at")
        parsed_date = _parse_datetime(raw_date)
        difficulty_rating = current_climb.get("difficulty_rating") or current_climb.get("difficulty")
        weather = str(current_climb.get("weather") or "").strip().lower()
        notes = str(current_climb.get("notes") or "").strip()
        peak_height = _to_float(current_climb.get("peak_height_m") or current_climb.get("height_m") or current_climb.get("height"))
        peak_height_ft = _to_float(current_climb.get("peak_height_ft") or current_climb.get("height_ft"))
        photo_urls = current_climb.get("photo_urls") if isinstance(current_climb.get("photo_urls"), list) else []

        climb_entries.append(
            {
                **current_climb,
                "date_climbed": raw_date,
                "date_label": _format_short_date(raw_date),
                "date_sort": parsed_date or datetime.min.replace(tzinfo=timezone.utc),
                "year": parsed_date.year if parsed_date else None,
                "month": parsed_date.month if parsed_date else None,
                "difficulty_rating": difficulty_rating,
                "difficulty_stars": _difficulty_star_count(difficulty_rating),
                "difficulty_value": _difficulty_numeric_value(difficulty_rating),
                "height_m": int(round(peak_height)) if peak_height is not None else None,
                "height_ft": int(round(peak_height_ft)) if peak_height_ft is not None else None,
                "weather": weather,
                "notes": notes,
                "notes_preview": _notes_preview(notes, 50),
                "has_details": bool(notes or photo_urls),
                "photo_urls": photo_urls,
            }
        )

    return sorted(climb_entries, key=lambda climb: climb["date_sort"], reverse=True)


def _build_my_climb_stats(climbs: list[dict]) -> dict:
    difficulty_values = [
        climb.get("difficulty_value")
        for climb in climbs
        if climb.get("difficulty_value") is not None
    ]
    avg_difficulty = round(sum(difficulty_values) / len(difficulty_values), 1) if difficulty_values else None
    total_elevation_m = int(
        round(
            sum(
                climb.get("height_m") or 0
                for climb in climbs
            )
        )
    )
    total_elevation_ft = int(
        round(
            sum(
                climb.get("height_ft")
                if climb.get("height_ft") is not None
                else ((climb.get("height_m") or 0) * FEET_PER_METER)
                for climb in climbs
            )
        )
    )

    return {
        "total_climbs": len(climbs),
        "unique_peaks": len({climb.get("peak_id") for climb in climbs if climb.get("peak_id") is not None}),
        "total_elevation_m": total_elevation_m,
        "total_elevation_ft": total_elevation_ft,
        "avg_difficulty": avg_difficulty,
        "avg_difficulty_stars": _difficulty_star_count(avg_difficulty),
    }


def _build_public_profile_stats(profile_record: dict, climbs: list[dict], peaks_by_id: dict[int, dict], total_peaks: int) -> dict:
    progress = _build_dashboard_progress_data(climbs, peaks_by_id, total_peaks)
    province_breakdown = progress.get("province_breakdown") or []
    favourite_province = None
    for province in province_breakdown:
        if int(province.get("count") or 0) <= 0:
            continue
        if favourite_province is None or int(province.get("count") or 0) > int(favourite_province.get("count") or 0):
            favourite_province = province

    member_since_raw = (
        profile_record.get("created_at")
        or profile_record.get("inserted_at")
        or profile_record.get("updated_at")
    )
    highest_peak = progress.get("highest_peak")

    return {
        "member_since": member_since_raw,
        "member_since_label": _format_short_date(member_since_raw) if member_since_raw else None,
        "peaks_climbed": progress.get("completed_count", 0),
        "total_elevation_m": progress.get("total_elevation_m", 0),
        "total_elevation_ft": progress.get("total_elevation_ft", 0),
        "highest_peak": highest_peak,
        "favourite_province": favourite_province,
    }


def _build_public_profile_badges(badges: list[dict]) -> list[dict]:
    unique_badges = {}
    for badge in badges:
        badge_key = normalize_badge_key(badge.get("badge_key"))
        if not badge_key or badge_key in unique_badges:
            continue
        earned_at = (
            badge.get("created_at")
            or badge.get("awarded_at")
            or badge.get("inserted_at")
            or badge.get("updated_at")
        )
        unique_badges[badge_key] = {
            "key": badge_key,
            "label": (
                str(badge.get("label") or badge.get("badge_label") or "").strip()
                or BADGE_LABELS.get(badge_key)
                or badge_key.replace("_", " ").title()
            ),
            "icon": BADGE_ICON_LOOKUP.get(badge_key, "fa-award"),
            "earned_at": earned_at,
            "earned_label": _format_short_date(earned_at) if earned_at else None,
            "earned_sort": _parse_datetime(earned_at) or datetime.min.replace(tzinfo=timezone.utc),
        }

    return sorted(
        unique_badges.values(),
        key=lambda badge: badge.get("earned_sort") or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )


def _build_distinct_climbed_peak_entries(climbs: list[dict], peaks_by_id: dict) -> list[dict]:
    distinct_peaks: dict[str, dict] = {}
    fallback_date = datetime.min.replace(tzinfo=timezone.utc)

    for climb in climbs:
        peak_id = climb.get("peak_id")
        if peak_id is None:
            continue

        climb_peak = climb.get("peak") if isinstance(climb.get("peak"), dict) else {}
        peak = dict(peaks_by_id.get(peak_id) or peaks_by_id.get(_peak_key(peak_id)) or climb_peak or {})
        raw_date = climb.get("date_climbed") or climb.get("climbed_at") or climb.get("created_at")
        date_sort = climb.get("date_sort") or _parse_datetime(raw_date) or fallback_date
        province_name = str(peak.get("province") or climb.get("peak_province") or "").strip()

        entry = {
            "peak_id": peak_id,
            "name": climb.get("peak_name") or peak.get("name") or f"Peak #{peak_id}",
            "height_m": climb.get("height_m") if climb.get("height_m") is not None else peak.get("height_m"),
            "height_ft": climb.get("height_ft") if climb.get("height_ft") is not None else peak.get("height_ft"),
            "county": climb.get("peak_county") or peak.get("county"),
            "province": province_name,
            "province_key": re.sub(r"[^a-z0-9]+", "-", province_name.lower()).strip("-") or "default",
            "date_climbed": raw_date,
            "date_sort": date_sort,
        }

        peak_key = _peak_key(peak_id)
        existing_entry = distinct_peaks.get(peak_key)
        if existing_entry is None or date_sort > existing_entry.get("date_sort", fallback_date):
            distinct_peaks[peak_key] = entry

    return sorted(
        distinct_peaks.values(),
        key=lambda peak: (-(peak.get("height_m") or 0), str(peak.get("name") or "").lower()),
    )


def _empty_public_profile_view_data(profile_record: dict | None) -> dict:
    member_since_raw = (
        (profile_record or {}).get("created_at")
        or (profile_record or {}).get("inserted_at")
        or (profile_record or {}).get("updated_at")
    )
    total_peaks = int(current_app.config.get("TOTAL_PEAK_COUNT") or 0)

    return {
        "all_climbs": [],
        "recent_climbs": [],
        "badges": [],
        "distinct_peaks": [],
        "map": {
            "markers": [],
            "unique_peaks": 0,
            "total_peaks": total_peaks,
            "completion_percent": 0,
        },
        "progress": {
            "completed_count": 0,
            "completion_percent": 0,
            "province_breakdown": [],
            "total_elevation_ft": 0,
            "total_elevation_m": 0,
            "total_peaks": total_peaks,
        },
        "stats": {
            "favourite_province": None,
            "highest_peak": None,
            "member_since": member_since_raw,
            "member_since_label": _format_short_date(member_since_raw) if member_since_raw else None,
            "peaks_climbed": 0,
            "streak_weeks": 0,
            "badge_count": 0,
            "province_breakdown": [],
            "total_elevation_ft": 0,
            "total_elevation_m": 0,
        },
        "streak": _build_dashboard_streak([]),
    }


def _build_public_profile_view_data(
    profile_record: dict,
    all_peaks: list[dict] | None = None,
    total_peaks: int | None = None,
    climbs: list[dict] | None = None,
    badges: list[dict] | None = None,
) -> dict:
    profile_user_id = str((profile_record or {}).get("id") or "").strip()
    if not profile_user_id:
        return _empty_public_profile_view_data(profile_record)

    resolved_all_peaks = list(all_peaks) if all_peaks is not None else get_all_peaks()
    resolved_total_peaks = int(total_peaks or 0) or int(current_app.config.get("TOTAL_PEAK_COUNT") or 0) or len(resolved_all_peaks)
    peaks_by_id = {
        peak.get("id"): peak
        for peak in resolved_all_peaks
        if peak.get("id") is not None
    }

    resolved_climbs = (
        _build_my_climb_entries(climbs)
        if climbs is not None
        else _build_my_climb_entries(get_user_climb_history(profile_user_id))
    )
    progress = _build_dashboard_progress_data(resolved_climbs, peaks_by_id, resolved_total_peaks)
    resolved_badges = (
        _build_public_profile_badges(badges)
        if badges is not None
        else _build_public_profile_badges(get_user_badges(profile_user_id))
    )
    streak = _build_dashboard_streak(resolved_climbs)
    stats = {
        **_build_public_profile_stats(profile_record, resolved_climbs, peaks_by_id, resolved_total_peaks),
        "streak_weeks": int(streak.get("display_weeks") or 0),
        "badge_count": len(resolved_badges),
        "province_breakdown": progress.get("province_breakdown") or [],
    }

    return {
        "all_climbs": resolved_climbs,
        "recent_climbs": resolved_climbs[:20],
        "badges": resolved_badges,
        "distinct_peaks": _build_distinct_climbed_peak_entries(resolved_climbs, peaks_by_id),
        "map": _build_my_climb_map_data(resolved_climbs, resolved_total_peaks),
        "progress": progress,
        "stats": stats,
        "streak": streak,
    }


def _build_dashboard_progress_data(climbs: list[dict], peaks_by_id: dict, total_peaks: int) -> dict:
    province_lookup = {province.lower(): province for province in PROVINCE_ORDER}
    province_counts = {province: 0 for province in PROVINCE_ORDER}
    extra_province_counts: dict[str, int] = {}
    distinct_peak_entries: dict[str, dict] = {}
    fallback_date = datetime.min.replace(tzinfo=timezone.utc)
    most_recent_climb = None

    for climb in climbs:
        peak_id = climb.get("peak_id")
        peak = dict(peaks_by_id.get(peak_id) or peaks_by_id.get(_peak_key(peak_id)) or {})
        if peak_id is None and not peak:
            continue

        raw_date = climb.get("date_climbed") or climb.get("climbed_at") or climb.get("created_at")
        date_sort = _parse_datetime(raw_date) or fallback_date
        height_m = _to_float(
            peak.get("height_m")
            or peak.get("height")
            or climb.get("peak_height_m")
            or climb.get("height_m")
            or climb.get("height")
        )
        height_ft = _to_float(
            peak.get("height_ft")
            or climb.get("peak_height_ft")
            or climb.get("height_ft")
        )
        province_name = str(peak.get("province") or climb.get("peak_province") or "").strip()
        county_name = str(peak.get("county") or climb.get("peak_county") or "").strip()
        peak_name = (
            climb.get("peak_name")
            or peak.get("name")
            or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak")
        )

        snapshot = {
            "peak_id": peak_id,
            "name": peak_name,
            "height_m": int(round(height_m)) if height_m is not None else None,
            "height_ft": int(round(height_ft)) if height_ft is not None else None,
            "province": province_name,
            "province_key": re.sub(r"[^a-z0-9]+", "-", province_name.lower()).strip("-") or "default",
            "county": county_name,
            "date_climbed": raw_date,
            "date_label": _format_short_date(raw_date),
            "relative_time": _relative_time(raw_date),
            "date_sort": date_sort,
        }

        if most_recent_climb is None or snapshot["date_sort"] > most_recent_climb["date_sort"]:
            most_recent_climb = snapshot

        if peak_id is None:
            continue

        peak_key = _peak_key(peak_id)
        existing_snapshot = distinct_peak_entries.get(peak_key)
        if existing_snapshot is None or snapshot["date_sort"] > existing_snapshot["date_sort"]:
            distinct_peak_entries[peak_key] = snapshot

    climbed_peaks = list(distinct_peak_entries.values())
    completed_count = len(climbed_peaks)
    total_peaks = max(int(total_peaks or 0), 0)
    completion_percent = int(round((completed_count / total_peaks) * 100)) if total_peaks else 0
    total_elevation_m = int(round(sum(peak.get("height_m") or 0 for peak in climbed_peaks)))
    total_elevation_ft = int(
        round(
            sum(
                peak.get("height_ft")
                if peak.get("height_ft") is not None
                else ((peak.get("height_m") or 0) * FEET_PER_METER)
                for peak in climbed_peaks
            )
        )
    )
    highest_peak = max(climbed_peaks, key=lambda peak: peak.get("height_m") or 0, default=None)

    for peak in climbed_peaks:
        normalized_province = str(peak.get("province") or "").strip().lower()
        if not normalized_province:
            continue
        province_name = province_lookup.get(normalized_province)
        if province_name:
            province_counts[province_name] += 1
            continue
        fallback_name = str(peak.get("province") or "").strip()
        extra_province_counts[fallback_name] = extra_province_counts.get(fallback_name, 0) + 1

    province_breakdown = [
        {
            "name": province_name,
            "count": province_counts.get(province_name, 0),
            "key": province_name.lower(),
        }
        for province_name in PROVINCE_ORDER
    ]
    province_breakdown.extend(
        {
            "name": province_name,
            "count": count,
            "key": re.sub(r"[^a-z0-9]+", "-", province_name.lower()).strip("-") or "default",
        }
        for province_name, count in extra_province_counts.items()
    )

    return {
        "completed_count": completed_count,
        "completion_percent": completion_percent,
        "highest_peak": highest_peak,
        "most_recent_climb": most_recent_climb,
        "remaining_count": max(total_peaks - completed_count, 0),
        "total_elevation_ft": total_elevation_ft,
        "total_elevation_m": total_elevation_m,
        "total_peaks": total_peaks,
        "province_counts": {province["name"]: province["count"] for province in province_breakdown},
        "province_breakdown": province_breakdown,
        "active_province_count": sum(1 for province in province_breakdown if province["count"] > 0),
    }


def _build_my_climb_map_data(climbs: list[dict], total_peaks: int) -> dict:
    markers_by_peak: dict[str, dict] = {}
    fallback_sort_date = datetime.min.replace(tzinfo=timezone.utc)

    for climb in climbs:
        peak = climb.get("peak") if isinstance(climb.get("peak"), dict) else {}
        peak_id = climb.get("peak_id")
        if peak_id is None:
            continue

        lat = _to_float(
            climb.get("latitude")
            or peak.get("latitude")
            or peak.get("lat")
        )
        lon = _to_float(
            climb.get("longitude")
            or climb.get("lon")
            or climb.get("lng")
            or peak.get("longitude")
            or peak.get("lon")
            or peak.get("lng")
        )
        if lat is None or lon is None:
            continue

        peak_key = _peak_key(peak_id)
        date_sort = climb.get("date_sort") or fallback_sort_date
        existing_marker = markers_by_peak.get(peak_key)

        if existing_marker is None:
            markers_by_peak[peak_key] = {
                "peak_id": peak_id,
                "name": climb.get("peak_name") or peak.get("name") or f"Peak #{peak_id}",
                "latitude": lat,
                "longitude": lon,
                "climb_count": 1,
                "latest_climb_label": climb.get("date_label") or "Unknown date",
                "latest_climb_sort": date_sort,
            }
            continue

        existing_marker["climb_count"] += 1
        if date_sort > existing_marker["latest_climb_sort"]:
            existing_marker["latest_climb_sort"] = date_sort
            existing_marker["latest_climb_label"] = climb.get("date_label") or "Unknown date"

    markers = sorted(
        markers_by_peak.values(),
        key=lambda marker: (
            marker.get("latest_climb_sort") or fallback_sort_date,
            str(marker.get("name") or "").lower(),
        ),
        reverse=True,
    )
    unique_peaks = len(markers)
    completion_percent = int(round((unique_peaks / total_peaks) * 100)) if total_peaks else 0
    completion_percent = max(0, min(completion_percent, 100))

    return {
        "markers": [
            {
                "peak_id": marker.get("peak_id"),
                "name": marker.get("name"),
                "latitude": marker.get("latitude"),
                "longitude": marker.get("longitude"),
                "climb_count": marker.get("climb_count"),
                "latest_climb_label": marker.get("latest_climb_label"),
            }
            for marker in markers
        ],
        "unique_peaks": unique_peaks,
        "total_peaks": total_peaks,
        "completion_percent": completion_percent,
    }


def _comparison_winner_flags(left_value, right_value) -> tuple[bool, bool]:
    left_number = int(left_value or 0)
    right_number = int(right_value or 0)
    if left_number > right_number:
        return True, False
    if right_number > left_number:
        return False, True
    return False, False


def _build_profile_compare_metric_rows(left_view: dict, right_view: dict) -> list[dict]:
    left_stats = left_view.get("stats") or {}
    right_stats = right_view.get("stats") or {}

    metric_rows = [
        {
            "icon": "fa-mountain",
            "kind": "number",
            "key": "peaks_climbed",
            "label": "Peaks Climbed",
            "left_value": int(left_stats.get("peaks_climbed") or 0),
            "right_value": int(right_stats.get("peaks_climbed") or 0),
        },
        {
            "icon": "fa-chart-column",
            "kind": "height",
            "key": "total_elevation",
            "label": "Total Elevation",
            "left_value": int(left_stats.get("total_elevation_m") or 0),
            "left_value_ft": int(left_stats.get("total_elevation_ft") or 0),
            "right_value": int(right_stats.get("total_elevation_m") or 0),
            "right_value_ft": int(right_stats.get("total_elevation_ft") or 0),
        },
        {
            "icon": "fa-fire",
            "kind": "weeks",
            "key": "streak",
            "label": "Streak",
            "left_value": int(left_stats.get("streak_weeks") or 0),
            "right_value": int(right_stats.get("streak_weeks") or 0),
        },
        {
            "icon": "fa-award",
            "kind": "number",
            "key": "badges",
            "label": "Badges",
            "left_value": int(left_stats.get("badge_count") or 0),
            "right_value": int(right_stats.get("badge_count") or 0),
        },
    ]

    for row in metric_rows:
        left_leads, right_leads = _comparison_winner_flags(row.get("left_value"), row.get("right_value"))
        row["left_is_leader"] = left_leads
        row["right_is_leader"] = right_leads

    return metric_rows


def _build_profile_compare_province_rows(left_view: dict, right_view: dict) -> list[dict]:
    left_breakdown = left_view.get("stats", {}).get("province_breakdown") or []
    right_breakdown = right_view.get("stats", {}).get("province_breakdown") or []
    left_lookup = {str(row.get("name") or "").strip(): row for row in left_breakdown}
    right_lookup = {str(row.get("name") or "").strip(): row for row in right_breakdown}
    ordered_names = []

    for province_name in PROVINCE_ORDER:
        if province_name in left_lookup or province_name in right_lookup:
            ordered_names.append(province_name)

    extra_names = sorted(
        {
            name
            for name in [*left_lookup.keys(), *right_lookup.keys()]
            if name and name not in ordered_names
        }
    )
    ordered_names.extend(extra_names)

    province_rows = []
    for province_name in ordered_names:
        left_count = int((left_lookup.get(province_name) or {}).get("count") or 0)
        right_count = int((right_lookup.get(province_name) or {}).get("count") or 0)
        left_leads, right_leads = _comparison_winner_flags(left_count, right_count)
        province_key = (
            (left_lookup.get(province_name) or {}).get("key")
            or (right_lookup.get(province_name) or {}).get("key")
            or re.sub(r"[^a-z0-9]+", "-", province_name.lower()).strip("-")
            or "default"
        )
        province_rows.append(
            {
                "key": province_key,
                "name": province_name,
                "left_count": left_count,
                "right_count": right_count,
                "left_is_leader": left_leads,
                "right_is_leader": right_leads,
            }
        )

    return province_rows


def _build_profile_compare_peak_overlap(left_view: dict, right_view: dict) -> dict:
    left_lookup = {
        _peak_key(peak.get("peak_id")): peak
        for peak in (left_view.get("distinct_peaks") or [])
        if peak.get("peak_id") is not None
    }
    right_lookup = {
        _peak_key(peak.get("peak_id")): peak
        for peak in (right_view.get("distinct_peaks") or [])
        if peak.get("peak_id") is not None
    }

    def _serialize_peak_list(peak_ids: set[str], source_lookup: dict[str, dict]) -> list[dict]:
        return sorted(
            [dict(source_lookup[peak_id]) for peak_id in peak_ids if peak_id in source_lookup],
            key=lambda peak: (-(peak.get("height_m") or 0), str(peak.get("name") or "").lower()),
        )

    shared_ids = set(left_lookup.keys()) & set(right_lookup.keys())
    left_only_ids = set(left_lookup.keys()) - set(right_lookup.keys())
    right_only_ids = set(right_lookup.keys()) - set(left_lookup.keys())

    return {
        "shared_count": len(shared_ids),
        "shared_peaks": _serialize_peak_list(shared_ids, left_lookup)[:6],
        "left_only_count": len(left_only_ids),
        "left_only_peaks": _serialize_peak_list(left_only_ids, left_lookup)[:6],
        "right_only_count": len(right_only_ids),
        "right_only_peaks": _serialize_peak_list(right_only_ids, right_lookup)[:6],
    }


def _build_bucket_list_entries(
    bucket_items: list[dict],
    peaks_by_id: dict[str, dict],
    peak_statuses: dict[str, str] | None = None,
) -> list[dict]:
    entries = []
    peak_statuses = peak_statuses or {}

    for bucket_item in bucket_items:
        current_item = dict(bucket_item or {})
        peak_id = current_item.get("peak_id")
        peak = dict(peaks_by_id.get(_peak_key(peak_id)) or {})
        raw_date_added = (
            current_item.get("created_at")
            or current_item.get("added_at")
            or current_item.get("date_added")
            or current_item.get("inserted_at")
        )
        parsed_date_added = _parse_datetime(raw_date_added)
        height_m = _to_float(peak.get("height_m") or peak.get("height"))
        height_ft = _to_float(peak.get("height_ft"))
        latitude = _to_float(peak.get("latitude") or peak.get("lat"))
        longitude = _to_float(peak.get("longitude") or peak.get("lon") or peak.get("lng"))
        province = peak.get("province") or current_item.get("province")
        province_key = str(province or "").strip().lower().replace(" ", "-") or "default"

        entries.append(
            {
                **current_item,
                "peak": peak,
                "peak_id": peak_id,
                "name": current_item.get("peak_name") or peak.get("name") or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak"),
                "height_m": int(round(height_m)) if height_m is not None else None,
                "height_ft": int(round(height_ft)) if height_ft is not None else None,
                "county": peak.get("county") or current_item.get("county"),
                "province": province,
                "province_key": province_key,
                "date_added": raw_date_added,
                "date_added_label": _format_short_date(raw_date_added) if raw_date_added else "Recently added",
                "date_sort": parsed_date_added or datetime.min.replace(tzinfo=timezone.utc),
                "latitude": latitude,
                "longitude": longitude,
                "user_status": _normalize_peak_status(peak_statuses.get(_peak_key(peak_id)) or "bucket_listed"),
            }
        )

    return entries


def _sort_bucket_list_entries(entries: list[dict], sort_by: str) -> list[dict]:
    normalized_sort = str(sort_by or "").strip().lower()

    if normalized_sort == "height":
        return sorted(
            entries,
            key=lambda entry: (
                1 if entry.get("height_m") is None else 0,
                -(entry.get("height_m") or 0),
                str(entry.get("name") or "").lower(),
            ),
        )

    if normalized_sort == "name":
        return sorted(
            entries,
            key=lambda entry: (
                str(entry.get("name") or "").lower(),
                str(entry.get("county") or "").lower(),
            ),
        )

    if normalized_sort == "county":
        return sorted(
            entries,
            key=lambda entry: (
                str(entry.get("county") or "").lower(),
                str(entry.get("name") or "").lower(),
            ),
        )

    return sorted(
        entries,
        key=lambda entry: (
            entry.get("date_sort") or datetime.min.replace(tzinfo=timezone.utc),
            str(entry.get("name") or "").lower(),
        ),
        reverse=True,
    )


def _build_bucket_list_map_data(entries: list[dict]) -> dict:
    markers_by_peak: dict[str, dict] = {}

    for entry in entries:
        latitude = entry.get("latitude")
        longitude = entry.get("longitude")
        if latitude is None or longitude is None:
            continue

        peak_key = _peak_key(entry.get("peak_id"))
        existing_marker = markers_by_peak.get(peak_key)
        if existing_marker is None or (entry.get("date_sort") or datetime.min.replace(tzinfo=timezone.utc)) > existing_marker["date_sort"]:
            markers_by_peak[peak_key] = {
                "peak_id": entry.get("peak_id"),
                "name": entry.get("name"),
                "height_m": entry.get("height_m"),
                "height_ft": entry.get("height_ft"),
                "county": entry.get("county"),
                "province": entry.get("province"),
                "date_added": entry.get("date_added"),
                "date_added_label": entry.get("date_added_label"),
                "date_sort": entry.get("date_sort") or datetime.min.replace(tzinfo=timezone.utc),
                "latitude": latitude,
                "longitude": longitude,
            }

    markers = sorted(
        markers_by_peak.values(),
        key=lambda marker: (
            marker.get("date_sort") or datetime.min.replace(tzinfo=timezone.utc),
            str(marker.get("name") or "").lower(),
        ),
        reverse=True,
    )

    return {
        "count": len(entries),
        "markers": [
            {
                "peak_id": marker.get("peak_id"),
                "name": marker.get("name"),
                "height_m": marker.get("height_m"),
                "height_ft": marker.get("height_ft"),
                "county": marker.get("county"),
                "province": marker.get("province"),
                "date_added": marker.get("date_added"),
                "date_added_label": marker.get("date_added_label"),
                "latitude": marker.get("latitude"),
                "longitude": marker.get("longitude"),
            }
            for marker in markers
        ],
    }


def _normalize_lookup_value(value) -> str:
    return str(value or "").strip().lower()


def _related_peak_sort_key(peak: dict) -> tuple:
    try:
        rank_value = int(peak.get("height_rank"))
    except (TypeError, ValueError):
        rank_value = 10_000

    peak_height = _to_float(peak.get("height_m") or peak.get("height"))
    normalized_height = -(peak_height or 0.0)
    peak_name = str(peak.get("name") or "").strip().lower()
    return (rank_value, normalized_height, peak_name)


def _build_related_peaks(
    current_peak: dict,
    current_user_id: str | None,
    all_peaks: list[dict] | None = None,
    peak_statuses: dict[str, str] | None = None,
) -> dict:
    all_peaks = list(all_peaks) if all_peaks is not None else get_all_peaks()
    current_peak_id = current_peak.get("id")
    range_area = str(current_peak.get("range_area") or "").strip()
    county = str(current_peak.get("county") or "").strip()

    def matching_peaks(field_name: str, expected_value: str) -> list[dict]:
        normalized_expected = _normalize_lookup_value(expected_value)
        if not normalized_expected:
            return []

        return [
            peak
            for peak in all_peaks
            if peak.get("id") != current_peak_id
            and _normalize_lookup_value(peak.get(field_name)) == normalized_expected
        ]

    range_area_matches = matching_peaks("range_area", range_area)
    county_matches = matching_peaks("county", county)

    related_label = ""
    related_peaks = []
    if len(range_area_matches) >= 3 or (range_area_matches and not county_matches):
        related_label = range_area
        related_peaks = range_area_matches
    elif county_matches:
        related_label = county
        related_peaks = county_matches
    else:
        related_label = range_area
        related_peaks = range_area_matches

    related_peaks = sorted(related_peaks, key=_related_peak_sort_key)[:5]
    if current_user_id and related_peaks:
        resolved_statuses = peak_statuses
        if resolved_statuses is None:
            resolved_statuses = get_peak_statuses(
                current_user_id,
                [peak.get("id") for peak in related_peaks if peak.get("id") is not None],
            )
        related_peaks = _decorate_peaks_with_statuses(related_peaks, resolved_statuses)
    else:
        related_peaks = [
            {
                **peak,
                "is_bucket_listed": False,
                "is_climbed": False,
                "user_status": "not_attempted",
            }
            for peak in related_peaks
        ]

    return {
        "title": f"More in {related_label}" if related_label and related_peaks else None,
        "peaks": related_peaks,
    }


def _normalize_peak_status(status: str | None) -> str:
    normalized = str(status or "").strip().lower()
    if normalized == "bucket":
        return "bucket_listed"
    if normalized == "none":
        return "not_attempted"
    if normalized in {"climbed", "bucket_listed", "not_attempted"}:
        return normalized
    return "not_attempted"


def _peak_key(peak_id) -> str:
    return str(peak_id) if peak_id is not None else ""


def _decorate_peaks_with_statuses(peaks: list[dict], peak_statuses: dict[str, str]) -> list[dict]:
    decorated_peaks = []
    for peak in peaks:
        peak_status = _normalize_peak_status(peak_statuses.get(_peak_key(peak.get("id"))))
        decorated_peaks.append(
            {
                **peak,
                "is_bucket_listed": peak_status == "bucket_listed",
                "is_climbed": peak_status == "climbed",
                "user_status": peak_status,
            }
        )

    return decorated_peaks


def _track_recently_viewed_peak(peak: dict | None) -> None:
    if not isinstance(peak, dict):
        return

    peak_id = peak.get("id")
    peak_key = _peak_key(peak_id)
    if not peak_key:
        return

    existing_entries = session.get(RECENTLY_VIEWED_SESSION_KEY)
    recent_entries = existing_entries if isinstance(existing_entries, list) else []
    filtered_entries = []
    for entry in recent_entries:
        if not isinstance(entry, dict):
            continue
        entry_peak_key = _peak_key(entry.get("peak_id"))
        if not entry_peak_key or entry_peak_key == peak_key:
            continue
        filtered_entries.append(
            {
                "peak_id": entry.get("peak_id"),
                "viewed_at": entry.get("viewed_at"),
            }
        )

    filtered_entries.insert(
        0,
        {
            "peak_id": peak_id,
            "viewed_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    session[RECENTLY_VIEWED_SESSION_KEY] = filtered_entries[:RECENTLY_VIEWED_LIMIT]
    session.modified = True


def is_profile_public(profile: dict | None) -> bool:
    return _is_profile_public(profile)


def track_recently_viewed_peak(peak: dict | None) -> None:
    _track_recently_viewed_peak(peak)


def _build_recently_viewed_peak_entries(
    peaks_by_id: dict[int, dict],
    peak_statuses: dict[str, str] | None = None,
) -> list[dict]:
    stored_entries = session.get(RECENTLY_VIEWED_SESSION_KEY)
    recent_entries = stored_entries if isinstance(stored_entries, list) else []
    if not recent_entries:
        return []

    peaks_by_key = {
        _peak_key(peak_id): peak
        for peak_id, peak in (peaks_by_id or {}).items()
    }
    normalized_statuses = peak_statuses or {}
    entries = []
    seen_peak_keys = set()

    for entry in recent_entries:
        if not isinstance(entry, dict):
            continue

        peak_key = _peak_key(entry.get("peak_id"))
        peak = peaks_by_key.get(peak_key)
        if not peak or peak_key in seen_peak_keys:
            continue

        seen_peak_keys.add(peak_key)
        height_m = _to_float(peak.get("height_m") or peak.get("height"))
        height_ft = _to_float(peak.get("height_ft"))
        viewed_at = entry.get("viewed_at")
        entries.append(
            {
                "id": peak.get("id"),
                "name": peak.get("name") or f"Peak #{peak.get('id')}",
                "county": peak.get("county"),
                "province": peak.get("province"),
                "height_m": int(round(height_m)) if height_m is not None else None,
                "height_ft": int(round(height_ft)) if height_ft is not None else None,
                "user_status": _normalize_peak_status(normalized_statuses.get(peak_key)),
                "viewed_at": viewed_at,
                "viewed_relative": _relative_time(viewed_at) if viewed_at else "",
            }
        )

    return entries[:RECENTLY_VIEWED_LIMIT]


def _build_map_peaks(peaks: list[dict], peak_statuses: dict[str, str] | None = None) -> list[dict]:
    map_peaks = []
    peak_statuses = peak_statuses or {}
    for peak in peaks:
        lat = _to_float(peak.get("latitude") or peak.get("lat"))
        lon = _to_float(peak.get("longitude") or peak.get("lon") or peak.get("lng"))
        if lat is None or lon is None:
            continue

        height_m = _to_float(peak.get("height_m") or peak.get("height"))
        user_status = _normalize_peak_status(peak_statuses.get(_peak_key(peak.get("id"))))

        map_peaks.append(
            {
                "id": peak.get("id"),
                "name": peak.get("name"),
                "county": peak.get("county"),
                "province": peak.get("province"),
                "height_m": int(round(height_m)) if height_m is not None else None,
                "latitude": lat,
                "longitude": lon,
                "is_bucket_listed": user_status == "bucket_listed",
                "is_climbed": user_status == "climbed",
                "user_status": user_status,
            }
        )
    return sorted(
        map_peaks,
        key=lambda peak: (
            str(peak.get("province") or "").lower(),
            str(peak.get("county") or "").lower(),
            str(peak.get("name") or "").lower(),
        ),
    )


def _count_distinct_values(peaks: list[dict], field_name: str) -> int:
    values = set()
    for peak in peaks:
        raw_value = peak.get(field_name)
        if raw_value is None:
            continue

        normalized = str(raw_value).strip().lower()
        if normalized:
            values.add(normalized)

    return len(values)


def _build_landing_stats(peaks: list[dict]) -> dict:
    province_count = _count_distinct_values(peaks, "province") or 4
    return {
        "peaks": len(peaks),
        "counties": _count_distinct_values(peaks, "county"),
        "provinces": province_count,
    }


def _prefers_imperial_units(profile: dict | None) -> bool:
    if not isinstance(profile, dict):
        return False

    candidate_values = [
        profile.get("unit_preference"),
        profile.get("units"),
        profile.get("measurement_system"),
        profile.get("measurement_preference"),
        profile.get("height_unit"),
        profile.get("height_units"),
        profile.get("distance_unit"),
        profile.get("distance_units"),
        profile.get("use_imperial_units"),
    ]

    preferences = profile.get("preferences")
    if isinstance(preferences, dict):
        candidate_values.extend(
            [
                preferences.get("unit_preference"),
                preferences.get("units"),
                preferences.get("measurement_system"),
                preferences.get("height_unit"),
                preferences.get("distance_unit"),
                preferences.get("use_imperial_units"),
            ]
        )

    for value in candidate_values:
        if isinstance(value, bool):
            return value

        normalized = str(value or "").strip().lower()
        if not normalized:
            continue

        if normalized in {"imperial", "feet", "foot", "ft", "us", "true", "1", "yes", "on"}:
            return True

        if normalized in {"metric", "meters", "metres", "m", "false", "0", "no", "off"}:
            return False

    return False


def _build_height_filter_range(peaks: list[dict], unit: str) -> dict[str, int | None]:
    heights_m = [
        _to_float(peak.get("height_m") or peak.get("height"))
        for peak in peaks
    ]
    heights_m = [height for height in heights_m if height is not None]
    if not heights_m:
        return {"min": None, "max": None}

    minimum_height = min(heights_m)
    maximum_height = max(heights_m)
    if unit == "ft":
        return {
            "min": int(round(minimum_height * FEET_PER_METER)),
            "max": int(round(maximum_height * FEET_PER_METER)),
        }

    return {
        "min": int(round(minimum_height)),
        "max": int(round(maximum_height)),
    }


def _build_county_groups(peaks: list[dict], climbed_peak_ids: set[str] | None = None) -> list[dict]:
    climbed_peak_keys = {
        _peak_key(peak_id)
        for peak_id in (climbed_peak_ids or set())
        if _peak_key(peak_id)
    }
    province_lookup = {province.lower(): province for province in PROVINCE_ORDER}
    counties_by_key: dict[str, dict] = {}

    for peak in peaks:
        county_name = str(peak.get("county") or "").strip()
        if not county_name:
            continue

        raw_province_name = str(peak.get("province") or "").strip()
        province_name = province_lookup.get(raw_province_name.lower(), raw_province_name or "Unknown Province")
        county_key = county_name.lower()
        current_county = counties_by_key.get(county_key)
        if current_county is None:
            current_county = {
                "name": county_name,
                "province": province_name,
                "total_peaks": 0,
                "climbed_peak_keys": set(),
                "url": url_for("summit_list", county=county_name),
            }
            counties_by_key[county_key] = current_county

        current_county["total_peaks"] += 1
        peak_key = _peak_key(peak.get("id"))
        if peak_key and peak_key in climbed_peak_keys:
            current_county["climbed_peak_keys"].add(peak_key)

    grouped_counties: dict[str, list[dict]] = {}
    for current_county in counties_by_key.values():
        total_peaks = int(current_county.get("total_peaks") or 0)
        climbed_count = len(current_county.get("climbed_peak_keys") or set())
        completion_percent = int(round((climbed_count / total_peaks) * 100)) if total_peaks else 0
        county_entry = {
            "name": current_county.get("name"),
            "province": current_county.get("province"),
            "total_peaks": total_peaks,
            "climbed_count": climbed_count,
            "completion_percent": completion_percent,
            "is_completed": bool(total_peaks and climbed_count >= total_peaks),
            "url": current_county.get("url"),
        }
        grouped_counties.setdefault(str(county_entry["province"] or "Unknown Province"), []).append(county_entry)

    ordered_provinces = [
        province_name
        for province_name in PROVINCE_ORDER
        if province_name in grouped_counties
    ]
    ordered_provinces.extend(
        sorted(
            province_name
            for province_name in grouped_counties
            if province_name not in PROVINCE_ORDER
        )
    )

    county_groups = []
    for province_name in ordered_provinces:
        province_counties = sorted(
            grouped_counties.get(province_name) or [],
            key=lambda county: str(county.get("name") or "").lower(),
        )
        total_peaks = sum(int(county.get("total_peaks") or 0) for county in province_counties)
        climbed_count = sum(int(county.get("climbed_count") or 0) for county in province_counties)
        completion_percent = int(round((climbed_count / total_peaks) * 100)) if total_peaks else 0
        county_groups.append(
            {
                "name": province_name,
                "counties": province_counties,
                "county_count": len(province_counties),
                "completed_counties": sum(1 for county in province_counties if county.get("is_completed")),
                "total_peaks": total_peaks,
                "climbed_count": climbed_count,
                "completion_percent": completion_percent,
            }
        )

    return county_groups


def _enrich_recent_climbs(recent_climbs: list[dict], peaks_by_id: dict) -> list[dict]:
    enriched = []
    for climb in recent_climbs:
        peak_id = climb.get("peak_id")
        peak = peaks_by_id.get(peak_id, {}) if peak_id is not None else {}
        climber_name = (
            climb.get("display_name")
            or climb.get("user_display_name")
            or climb.get("user_name")
            or (climb.get("user_id")[:8] if climb.get("user_id") else "Unknown")
        )
        peak_name = (
            climb.get("peak_name")
            or climb.get("name")
            or peak.get("name")
            or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak")
        )
        climbed_at = climb.get("climbed_at") or climb.get("created_at")
        enriched.append(
            {
                "climber_name": climber_name,
                "peak_name": peak_name,
                "activity_time": climbed_at,
                "relative_time": _relative_time(climbed_at),
            }
        )
    return enriched


def _build_dashboard_activity_items(
    climbs: list[dict],
    bucket_items: list[dict],
    badges: list[dict],
    peaks_by_id: dict[int, dict],
    limit: int | None = 10,
) -> list[dict]:
    activity_items = []
    fallback_date = datetime.min.replace(tzinfo=timezone.utc)

    for climb in climbs:
        peak_id = climb.get("peak_id")
        peak = peaks_by_id.get(peak_id, {}) if peak_id is not None else {}
        activity_date = climb.get("date_climbed") or climb.get("climbed_at") or climb.get("created_at")
        activity_items.append(
            {
                "type": "climbed",
                "action_type": "climbed",
                "label": "Climbed",
                "href": url_for("peak_detail", peak_id=peak_id) if peak_id is not None else None,
                "peak_id": peak_id,
                "name": (
                    climb.get("peak_name")
                    or peak.get("name")
                    or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak")
                ),
                "description": "You reached the summit.",
                "activity_time": activity_date,
                "relative_time": _relative_time(activity_date),
                "tag_class": "is-success",
                "timestamp": _parse_datetime(activity_date) or fallback_date,
            }
        )

    for bucket_item in bucket_items:
        peak_id = bucket_item.get("peak_id")
        peak = peaks_by_id.get(peak_id, {}) if peak_id is not None else {}
        activity_date = (
            bucket_item.get("created_at")
            or bucket_item.get("added_at")
            or bucket_item.get("date_added")
            or bucket_item.get("inserted_at")
        )
        activity_items.append(
            {
                "type": "bucket_listed",
                "action_type": "bucket_listed",
                "label": "Bucket List",
                "href": url_for("peak_detail", peak_id=peak_id) if peak_id is not None else None,
                "peak_id": peak_id,
                "name": peak.get("name") or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak"),
                "description": "Added to your bucket list.",
                "activity_time": activity_date,
                "relative_time": _relative_time(activity_date),
                "tag_class": "is-warning",
                "timestamp": _parse_datetime(activity_date) or fallback_date,
            }
        )

    for badge in badges:
        badge_key = normalize_badge_key(badge.get("badge_key"))
        badge_label = (
            str(badge.get("label") or badge.get("badge_label") or "").strip()
            or BADGE_LABELS.get(badge_key)
            or badge_key.replace("_", " ").title()
            or "New Badge"
        )
        activity_date = (
            badge.get("created_at")
            or badge.get("awarded_at")
            or badge.get("inserted_at")
            or badge.get("updated_at")
        )
        activity_items.append(
            {
                "type": "badge",
                "action_type": "badge",
                "label": "Badge",
                "href": url_for("achievements"),
                "name": badge_label,
                "description": "Badge unlocked from your climbing progress.",
                "activity_time": activity_date,
                "relative_time": _relative_time(activity_date),
                "tag_class": "is-info",
                "timestamp": _parse_datetime(activity_date) or fallback_date,
            }
        )

    sorted_items = sorted(
        activity_items,
        key=lambda activity: activity.get("timestamp") or fallback_date,
        reverse=True,
    )
    if limit is None:
        return sorted_items
    return sorted_items[:max(int(limit or 0), 0)]


def _filter_dashboard_activity_items(
    activity_items: list[dict],
    selected_type: str,
    date_from: str = "",
    date_to: str = "",
) -> list[dict]:
    normalized_type = str(selected_type or "all").strip().lower() or "all"
    type_map = {
        "all": None,
        "climbs": "climbed",
        "bucket_list": "bucket_listed",
        "badges": "badge",
    }
    if normalized_type not in type_map:
        normalized_type = "all"

    try:
        start_date = datetime.fromisoformat(str(date_from or "").strip()).date() if str(date_from or "").strip() else None
    except ValueError:
        start_date = None
    try:
        end_date = datetime.fromisoformat(str(date_to or "").strip()).date() if str(date_to or "").strip() else None
    except ValueError:
        end_date = None

    if start_date and end_date and start_date > end_date:
        start_date, end_date = end_date, start_date

    target_type = type_map[normalized_type]
    filtered_items = []
    for activity in activity_items:
        if target_type and str(activity.get("type") or "").strip().lower() != target_type:
            continue

        activity_dt = _parse_datetime(activity.get("activity_time"))
        activity_date = activity_dt.date() if activity_dt else None
        if start_date and (activity_date is None or activity_date < start_date):
            continue
        if end_date and (activity_date is None or activity_date > end_date):
            continue

        filtered_items.append(activity)

    return filtered_items


def _build_dashboard_streak(climbs: list[dict]) -> dict:
    streak = calculate_climb_streak(climbs)
    weeks = int(streak.get("display_weeks") or 0)
    last_climb_at = streak.get("last_climb_at")
    status = streak.get("status") or "inactive"

    if status == "active":
        return {
            **streak,
            "heading": f"Current streak: {_pluralize_weeks(weeks)}",
            "caption": "You have already logged a climb this week. Keep the momentum going.",
            "tone_class": "is-success",
        }

    if status == "at_risk":
        return {
            **streak,
            "heading": f"Streak at risk! Climb this week to keep your {_pluralize_weeks(weeks)} alive.",
            "caption": (
                f"Last climb {format_time_ago(last_climb_at)}."
                if last_climb_at
                else "Your last climb was last week."
            ),
            "tone_class": "is-warning",
        }

    return {
        **streak,
        "heading": "Current streak: 0 weeks",
        "caption": "Log a climb this week to start a new streak.",
        "tone_class": "is-light",
    }


def _build_leaderboard_profile_record(row: dict | None) -> dict:
    current_row = dict(row or {})
    profile = dict(current_row.get("profile") or {})
    return {
        **profile,
        "id": profile.get("id") or current_row.get("user_id"),
        "display_name": profile.get("display_name") or current_row.get("display_name"),
        "avatar_url": profile.get("avatar_url") or current_row.get("avatar_url"),
    }


def _leaderboard_height_label(height_m, height_unit: str, height_ft=None, fallback: str = "-") -> str:
    value, unit = _height_display_value(height_m, height_unit, height_ft)
    if value is None:
        return fallback
    return f"{value:,}{unit}"


def _leaderboard_metric_meta(row: dict, tab_key: str, height_unit: str) -> dict:
    if tab_key == "elevation":
        return {
            "label": _leaderboard_height_label(row.get("total_elevation_m"), height_unit),
            "summary": _leaderboard_height_label(row.get("total_elevation_m"), height_unit),
        }

    if tab_key == "streaks":
        streak_weeks = max(int(row.get("current_streak") or 0), 0)
        streak_label = _pluralize_weeks(streak_weeks)
        return {
            "label": streak_label,
            "summary": streak_label,
        }

    peak_count = max(int(row.get("peak_count") or 0), 0)
    peak_label = f"{peak_count:,} peak" if peak_count == 1 else f"{peak_count:,} peaks"
    return {
        "label": peak_label,
        "summary": peak_label,
    }


def _build_leaderboard_share_payload(
    row: dict,
    tab_key: str,
    display_name: str,
    metric_meta: dict,
) -> dict:
    current_row = dict(row or {})
    rank_value = max(int(current_row.get("rank") or 0), 0)
    share_display_name = str(display_name or "").strip()
    if rank_value <= 0 or not share_display_name:
        return {}

    if tab_key == "elevation":
        share_summary = f"with {metric_meta.get('summary') or '0m'} of elevation logged!"
    elif tab_key == "streaks":
        streak_weeks = max(int(current_row.get("current_streak") or 0), 0)
        share_summary = f"with a current streak of {_pluralize_weeks(streak_weeks)}!"
    else:
        peak_count = max(int(current_row.get("peak_count") or 0), 0)
        share_summary = (
            "with 1 peak climbed!"
            if peak_count == 1
            else f"with {peak_count:,} peaks climbed!"
        )

    share_url = url_for(
        "leaderboard",
        highlight=share_display_name,
        tab=tab_key,
        _external=True,
    )
    share_text = f"{share_display_name} is ranked #{rank_value} on Emerald Peak Explorer {share_summary}"
    share_title = f"{share_display_name} is ranked #{rank_value} on Emerald Peak Explorer"
    return {
        "linkedin_url": "https://www.linkedin.com/sharing/share-offsite/?" + urlencode({"url": share_url}),
        "text": share_text,
        "title": share_title,
        "twitter_url": "https://twitter.com/intent/tweet?" + urlencode(
            {
                "text": share_text,
                "url": share_url,
            }
        ),
        "url": share_url,
    }


def _prepare_public_leaderboard_rows(rows: list[dict]) -> list[dict]:
    public_rows = []
    for row in rows:
        profile_record = _build_leaderboard_profile_record(row)
        if not _is_profile_public(profile_record):
            continue
        public_rows.append(
            {
                **dict(row or {}),
                "profile": profile_record,
            }
        )

    return [
        {
            **row,
            "rank": index + 1,
        }
        for index, row in enumerate(public_rows)
    ]


def _build_leaderboard_entry(
    row: dict,
    tab_key: str,
    current_user_id: str | None,
    height_unit: str,
    highlighted_user_id: str | None = None,
) -> dict:
    current_row = dict(row or {})
    profile = _build_leaderboard_profile_record(current_row)
    user_id = str(current_row.get("user_id") or profile.get("id") or "").strip()
    display_name = str(current_row.get("display_name") or profile.get("display_name") or "Climber").strip() or "Climber"
    is_current_user = bool(current_user_id and user_id == str(current_user_id))
    is_highlighted = bool(highlighted_user_id and user_id == str(highlighted_user_id))
    highest_peak = dict(current_row.get("highest_peak") or {})
    highest_peak_name = str(highest_peak.get("name") or "").strip()
    highest_peak_height_label = _leaderboard_height_label(
        highest_peak.get("height_m"),
        height_unit,
        highest_peak.get("height_ft"),
        fallback="",
    )
    metric_meta = _leaderboard_metric_meta(current_row, tab_key, height_unit)
    share_payload = _build_leaderboard_share_payload(
        current_row,
        tab_key,
        str(profile.get("display_name") or display_name).strip() or display_name,
        metric_meta,
    )

    return {
        **current_row,
        "display_name": display_name,
        "highest_peak": {
            **highest_peak,
            "label": (
                f"{highest_peak_name} ({highest_peak_height_label})"
                if highest_peak_name and highest_peak_height_label
                else highest_peak_name
            ),
            "url": url_for("peak_detail", peak_id=highest_peak.get("id"))
            if highest_peak.get("id") is not None
            else None,
        },
        "is_current_user": is_current_user,
        "is_highlighted": is_highlighted,
        "metric_label": metric_meta["label"],
        "metric_summary": metric_meta["summary"],
        "profile": profile,
        "profile_preview_name": None if is_current_user else display_name,
        "profile_url": url_for("my_profile") if is_current_user else url_for("public_profile", display_name=display_name),
        "share": share_payload,
        "user_id": user_id,
    }


def _build_leaderboard_tab_context(
    rows: list[dict],
    tab_key: str,
    current_user_id: str | None,
    height_unit: str,
    highlighted_user_id: str | None = None,
    limit: int = 25,
) -> dict:
    public_rows = _prepare_public_leaderboard_rows(rows)
    top_rows = public_rows[:limit]
    current_user_row = None
    highlighted_row = None

    if current_user_id:
        current_user_row = next(
            (row for row in public_rows if str(row.get("user_id") or "") == str(current_user_id)),
            None,
        )
    if highlighted_user_id:
        highlighted_row = next(
            (row for row in public_rows if str(row.get("user_id") or "") == str(highlighted_user_id)),
            None,
        )

    entries = [
        _build_leaderboard_entry(row, tab_key, current_user_id, height_unit, highlighted_user_id)
        for row in top_rows
    ]
    own_entry = (
        _build_leaderboard_entry(current_user_row, tab_key, current_user_id, height_unit, highlighted_user_id)
        if current_user_row and int(current_user_row.get("rank") or 0) > limit
        else None
    )
    highlight_entry = (
        _build_leaderboard_entry(highlighted_row, tab_key, current_user_id, height_unit, highlighted_user_id)
        if highlighted_row and int(highlighted_row.get("rank") or 0) > limit
        else None
    )
    if own_entry and highlight_entry and str(own_entry.get("user_id") or "") == str(highlight_entry.get("user_id") or ""):
        highlight_entry = None

    highlighted_entry = next((entry for entry in entries if entry.get("is_highlighted")), None)
    if highlighted_entry is None and own_entry and own_entry.get("is_highlighted"):
        highlighted_entry = own_entry
    if highlighted_entry is None and highlight_entry and highlight_entry.get("is_highlighted"):
        highlighted_entry = highlight_entry

    return {
        "entries": entries,
        "highlight_entry": highlight_entry,
        "highlighted_entry": highlighted_entry,
        "own_entry": own_entry,
        "total_ranked": len(public_rows),
    }


def _build_leaderboard_community_stat_cards(stats: dict, height_unit: str) -> list[dict]:
    community_stats = dict(stats or {})
    most_popular_peak = dict(community_stats.get("most_popular_peak") or {})
    total_registered_users = max(int(community_stats.get("total_registered_users") or 0), 0)
    total_climbs_logged = max(int(community_stats.get("total_climbs_logged") or 0), 0)
    popular_peak_name = str(most_popular_peak.get("name") or "").strip()
    popular_peak_climbs = max(int(most_popular_peak.get("total_climbs") or 0), 0)

    if popular_peak_climbs == 1:
        popular_peak_meta = "1 climb logged"
    elif popular_peak_climbs > 1:
        popular_peak_meta = f"{popular_peak_climbs:,} climbs logged"
    else:
        popular_peak_meta = "Waiting for the first climb log"

    return [
        {
            "icon": "fa-user-group",
            "label": "Registered Users",
            "meta": "Climbers with accounts",
            "value": f"{total_registered_users:,}",
        },
        {
            "icon": "fa-shoe-prints",
            "label": "Climbs Logged",
            "meta": "Every summit entry recorded",
            "value": f"{total_climbs_logged:,}",
        },
        {
            "icon": "fa-mountain",
            "label": "Most Popular Peak",
            "meta": popular_peak_meta,
            "url": (
                url_for("peak_detail", peak_id=most_popular_peak.get("id"))
                if most_popular_peak.get("id") is not None
                else None
            ),
            "value": popular_peak_name or "No climbs yet",
        },
        {
            "icon": "fa-chart-column",
            "label": "Total Elevation Logged",
            "meta": "Across every recorded climb",
            "value": _leaderboard_height_label(
                community_stats.get("total_elevation_m"),
                height_unit,
                fallback=f"0{height_unit}",
            ),
        },
    ]


def _build_leaderboard_popular_peak_entries(rows: list[dict], limit: int = 10) -> list[dict]:
    entries = []
    for row in rows[:max(int(limit or 0), 0)]:
        current_row = dict(row or {})
        climb_count = max(int(current_row.get("total_climbs") or 0), 0)
        peak_name = str(current_row.get("name") or "").strip() or "Unnamed peak"
        entries.append(
            {
                **current_row,
                "count_label": "1 climb logged" if climb_count == 1 else f"{climb_count:,} climbs logged",
                "name": peak_name,
                "url": (
                    url_for("peak_detail", peak_id=current_row.get("id"))
                    if current_row.get("id") is not None
                    else None
                ),
            }
        )
    return entries


def _build_leaderboard_page_meta(active_tab: str, leaderboard_tabs: list[dict]) -> dict:
    description = "See the public climbers leading the way by distinct peaks, total elevation, and current streak."
    meta = {
        "description": description,
        "title": "Leaderboard | Emerald Peak Explorer",
        "url": request.url,
    }
    active_tab_context = next(
        (tab for tab in leaderboard_tabs if str(tab.get("key") or "") == str(active_tab or "")),
        None,
    )
    highlighted_entry = dict((active_tab_context or {}).get("highlighted_entry") or {})
    highlighted_share = dict(highlighted_entry.get("share") or {})
    if highlighted_share:
        meta["description"] = str(highlighted_share.get("text") or description).strip() or description
        meta["title"] = str(highlighted_share.get("title") or meta["title"]).strip() or meta["title"]
        meta["url"] = str(highlighted_share.get("url") or meta["url"]).strip() or meta["url"]
    return meta


def _build_peak_detail_meta(peak: dict | None) -> dict:
    current_peak = dict(peak or {})
    peak_name = str(current_peak.get("name") or "Peak").strip() or "Peak"
    height_value = _to_float(current_peak.get("height_m") or current_peak.get("height"))
    county_name = str(current_peak.get("county") or "Unknown county").strip() or "Unknown county"
    province_name = str(current_peak.get("province") or "Unknown province").strip() or "Unknown province"

    try:
        rank_value = int(current_peak.get("height_rank"))
    except (TypeError, ValueError):
        rank_value = None

    description = f"{peak_name} is "
    if height_value is not None:
        description += f"{int(round(height_value))}m"
    else:
        description += "of unknown height"
    description += f" in {county_name}, {province_name}."
    if rank_value is not None and rank_value > 0:
        description += f" Ranked #{rank_value}."

    return {
        "description": description,
        "title": f"{peak_name} — Emerald Peak Explorer",
        "url": request.url,
    }


def _build_dashboard_onboarding_steps() -> list[dict]:
    return [
        {
            "description": "Find your first summit and see what catches your eye.",
            "href": url_for("summit_list"),
            "label": "Step",
            "name": "Browse Summit List",
            "tag_class": "is-info",
        },
        {
            "description": "Save a few peaks so your future adventures have a shortlist.",
            "href": url_for("summit_list"),
            "label": "Step",
            "name": "Add to Bucket List",
            "tag_class": "is-warning",
        },
        {
            "description": "Open the climb modal and celebrate your first summit entry.",
            "href": "#",
            "label": "Step",
            "name": "Log First Climb",
            "tag_class": "is-success",
            "trigger_modal": True,
        },
    ]


def _build_dashboard_achievements(
    badges: list[dict],
    badge_progress_lookup: dict | None = None,
    next_badge_candidate: dict | None = None,
) -> dict:
    earned_badges = {}
    for badge in badges:
        badge_key = normalize_badge_key(badge.get("badge_key"))
        if badge_key:
            earned_badges[badge_key] = badge

    achievement_cards = []
    next_badge = None
    for rule in DASHBOARD_BADGE_RULES:
        earned_badge = earned_badges.get(rule["key"])
        progress_meta = dict((badge_progress_lookup or {}).get(rule["key"]) or {})
        progress_count = int(progress_meta.get("current") or 0)
        progress_target = int(progress_meta.get("target") or rule["threshold"] or 0)
        progress_percent = int(progress_meta.get("percentage") or 0)
        is_earned = earned_badge is not None or (progress_target > 0 and progress_count >= progress_target)
        progress_count_clamped = min(progress_count, progress_target) if progress_target > 0 else progress_count
        is_next = (
            not is_earned
            and isinstance(next_badge_candidate, dict)
            and str(next_badge_candidate.get("key") or "") == rule["key"]
        )

        achievement = {
            "key": rule["key"],
            "label": rule["label"],
            "threshold": progress_target or rule["threshold"],
            "icon": rule["icon"],
            "is_earned": is_earned,
            "is_next": is_next,
            "progress_count": progress_count_clamped,
            "progress_percent": progress_percent,
            "progress_label": f"{progress_count_clamped} / {progress_target or rule['threshold']}",
            "earned_label": "Earned" if is_earned else "Up next" if is_next else "Locked",
            "earned_at": (
                earned_badge.get("created_at")
                or earned_badge.get("awarded_at")
                or earned_badge.get("inserted_at")
                if isinstance(earned_badge, dict)
                else None
            ),
        }
        achievement_cards.append(achievement)

    if isinstance(next_badge_candidate, dict) and not next_badge_candidate.get("is_earned"):
        next_badge = {
            "key": str(next_badge_candidate.get("key") or ""),
            "label": str(next_badge_candidate.get("label") or "Next Badge"),
            "icon": str(next_badge_candidate.get("icon") or "fa-award"),
            "progress_count": int(next_badge_candidate.get("current") or next_badge_candidate.get("current_value") or 0),
            "threshold": int(next_badge_candidate.get("target") or next_badge_candidate.get("target_value") or 1),
            "progress_percent": int(next_badge_candidate.get("percentage") or next_badge_candidate.get("progress_percent") or 0),
            "progress_label": str(next_badge_candidate.get("progress_label") or ""),
            "requirement_text": str(next_badge_candidate.get("requirement_text") or ""),
        }

    return {
        "badges": achievement_cards,
        "earned_count": sum(1 for achievement in achievement_cards if achievement["is_earned"]),
        "next_badge": next_badge,
    }


def _build_dashboard_bucket_preview(bucket_items: list[dict], decorated_peaks: list[dict], limit: int = 5) -> list[dict]:
    peaks_by_id = {
        _peak_key(peak.get("id")): peak
        for peak in decorated_peaks
        if peak.get("id") is not None
    }
    fallback_date = datetime.min.replace(tzinfo=timezone.utc)
    preview_items = []

    sorted_bucket_items = sorted(
        bucket_items,
        key=lambda item: _parse_datetime(
            item.get("created_at")
            or item.get("added_at")
            or item.get("date_added")
            or item.get("inserted_at")
        ) or fallback_date,
        reverse=True,
    )

    for item in sorted_bucket_items:
        peak = dict(peaks_by_id.get(_peak_key(item.get("peak_id"))) or {})
        if not peak:
            continue

        added_at = (
            item.get("created_at")
            or item.get("added_at")
            or item.get("date_added")
            or item.get("inserted_at")
        )
        province_name = str(peak.get("province") or "").strip()
        preview_items.append(
            {
                **peak,
                "added_at": added_at,
                "added_label": _format_short_date(added_at),
                "added_relative": _relative_time(added_at),
                "province_key": re.sub(r"[^a-z0-9]+", "-", province_name.lower()).strip("-") or "default",
            }
        )
        if len(preview_items) >= limit:
            break

    return preview_items


def _dashboard_peak_sort_key(peak: dict) -> tuple:
    return (
        _to_float(peak.get("height_rank")) if _to_float(peak.get("height_rank")) is not None else float("inf"),
        -(_to_float(peak.get("height_m") or peak.get("height")) or 0),
        str(peak.get("name") or "").lower(),
    )


def _build_dashboard_suggestions(
    decorated_peaks: list[dict],
    bucket_items: list[dict],
    climbs: list[dict],
    community_climbs: list[dict],
    limit: int = 5,
    popular_only: bool = False,
) -> list[dict]:
    decorated_by_id = {
        _peak_key(peak.get("id")): peak
        for peak in decorated_peaks
        if peak.get("id") is not None
    }
    selected_peak_ids = set()
    suggestions = []
    fallback_date = datetime.min.replace(tzinfo=timezone.utc)

    def add_suggestion(peak: dict | None, reason: str, source: str):
        if not isinstance(peak, dict):
            return False
        peak_id = peak.get("id")
        peak_key = _peak_key(peak_id)
        if not peak_key or peak_key in selected_peak_ids:
            return False
        if _normalize_peak_status(peak.get("user_status")) == "climbed":
            return False

        suggestions.append(
            {
                **peak,
                "suggestion_reason": reason,
                "suggestion_source": source,
            }
        )
        selected_peak_ids.add(peak_key)
        return True

    sorted_bucket_items = sorted(
        bucket_items,
        key=lambda item: _parse_datetime(
            item.get("created_at")
            or item.get("added_at")
            or item.get("date_added")
            or item.get("inserted_at")
        ) or fallback_date,
        reverse=True,
    )
    for item in sorted_bucket_items:
        peak = decorated_by_id.get(_peak_key(item.get("peak_id")))
        if add_suggestion(peak, "Already on your bucket list", "bucket_listed") and len(suggestions) >= limit:
            return suggestions[:limit]

    popular_counts: dict[str, int] = {}
    for climb in community_climbs:
        peak_id = climb.get("peak_id")
        peak_key = _peak_key(peak_id)
        if peak_key:
            popular_counts[peak_key] = popular_counts.get(peak_key, 0) + 1

    popular_candidates = sorted(
        [
            peak for peak in decorated_peaks
            if _peak_key(peak.get("id")) in popular_counts and _normalize_peak_status(peak.get("user_status")) != "climbed"
        ],
        key=lambda peak: (
            -popular_counts.get(_peak_key(peak.get("id")), 0),
            *_dashboard_peak_sort_key(peak),
        ),
    )
    for peak in popular_candidates:
        climb_total = popular_counts.get(_peak_key(peak.get("id")), 0)
        reason = f"Popular with the community ({climb_total} recent climb{'s' if climb_total != 1 else ''})"
        if add_suggestion(peak, reason, "popular") and len(suggestions) >= limit:
            return suggestions[:limit]

    if popular_only:
        if len(suggestions) >= limit:
            return suggestions[:limit]

        fallback_candidates = sorted(
            [
                peak for peak in decorated_peaks
                if _normalize_peak_status(peak.get("user_status")) != "climbed"
            ],
            key=_dashboard_peak_sort_key,
        )
        for peak in fallback_candidates:
            if add_suggestion(peak, "Popular first climbs to get started", "popular_fallback") and len(suggestions) >= limit:
                break
        return suggestions[:limit]

    latest_climb = climbs[0] if climbs else None
    latest_county = ""
    if latest_climb:
        latest_peak = decorated_by_id.get(_peak_key(latest_climb.get("peak_id"))) or {}
        latest_county = str(latest_peak.get("county") or latest_climb.get("peak_county") or "").strip()

    if latest_county:
        county_candidates = sorted(
            [
                peak for peak in decorated_peaks
                if str(peak.get("county") or "").strip().lower() == latest_county.lower()
                and _normalize_peak_status(peak.get("user_status")) != "climbed"
            ],
            key=_dashboard_peak_sort_key,
        )
        for peak in county_candidates:
            if add_suggestion(peak, f"More to explore in {latest_county}", "same_county") and len(suggestions) >= limit:
                return suggestions[:limit]

    fallback_candidates = sorted(
        [
            peak for peak in decorated_peaks
            if _normalize_peak_status(peak.get("user_status")) != "climbed"
        ],
        key=_dashboard_peak_sort_key,
    )
    for peak in fallback_candidates:
        if add_suggestion(peak, "A strong next summit pick", "curated") and len(suggestions) >= limit:
            break

    return suggestions[:limit]


def _build_dashboard_community_feed(activities: list[dict], current_user_id: str, limit: int = 6) -> list[dict]:
    action_meta = {
        "badge": {
            "icon_class": "fa-trophy",
            "icon_tone_class": "is-gold",
            "text": "earned",
        },
        "bucket_list": {
            "icon_class": "fa-bookmark",
            "icon_tone_class": "is-warning",
            "text": "saved",
        },
        "climb": {
            "icon_class": "fa-mountain",
            "icon_tone_class": "is-success",
            "text": "climbed",
        },
    }
    community_items = []
    for activity in activities:
        profile = dict(activity.get("profile") or {})
        if not _is_profile_public(profile):
            continue

        action_type = str(activity.get("action_type") or "climb").strip().lower() or "climb"
        meta = action_meta.get(action_type, action_meta["climb"])
        peak_id = activity.get("peak_id")
        display_name = str(
            activity.get("display_name")
            or profile.get("display_name")
            or "Climber"
        ).strip() or "Climber"
        target_name = str(
            activity.get("target_name")
            or activity.get("peak_name")
            or activity.get("badge_name")
            or (f"Peak #{peak_id}" if peak_id is not None else "Achievement")
        ).strip() or "Activity"
        activity_time = activity.get("activity_time") or activity.get("created_at")
        user_id = str(activity.get("user_id") or profile.get("id") or "").strip()

        if action_type in {"climb", "bucket_list"} and peak_id is not None:
            target_url = url_for("peak_detail", peak_id=peak_id)
        elif action_type == "badge":
            target_url = url_for("achievements")
        else:
            target_url = None

        community_items.append(
            {
                "action_text": str(activity.get("action_text") or meta["text"]).strip() or meta["text"],
                "action_type": action_type,
                "display_name": display_name,
                "icon_class": meta["icon_class"],
                "icon_tone_class": meta["icon_tone_class"],
                "profile_url": _profile_url_for(profile, current_user_id),
                "profile_preview_name": None if current_user_id and user_id == str(current_user_id) else display_name,
                "profile": profile,
                "activity_time": activity_time,
                "relative_time": _relative_time(activity_time),
                "target_name": target_name,
                "target_url": target_url,
            }
        )
        if len(community_items) >= limit:
            break

    return community_items


def _build_dashboard_peak_search_data(peaks: list[dict]) -> list[dict]:
    search_data = []
    for peak in peaks:
        peak_id = peak.get("id")
        if peak_id is None:
            continue

        if peak.get("user_status") == "climbed":
            continue

        height_m = _to_float(peak.get("height_m") or peak.get("height"))
        height_ft = _to_float(peak.get("height_ft"))
        search_data.append(
            {
                "id": peak_id,
                "name": peak.get("name") or f"Peak #{peak_id}",
                "height_m": int(round(height_m)) if height_m is not None else None,
                "height_ft": int(round(height_ft)) if height_ft is not None else None,
                "county": peak.get("county"),
                "province": peak.get("province"),
            }
        )

    return sorted(
        search_data,
        key=lambda peak: (
            str(peak.get("name") or "").lower(),
            str(peak.get("county") or "").lower(),
        ),
    )


def _build_site_search_meta(*parts: str) -> str:
    return " · ".join(part for part in (str(part or "").strip() for part in parts) if part)


def _build_site_search_sections(search_catalog: dict, current_user_id: str | None) -> list[dict]:
    peak_results = []
    for peak in search_catalog.get("peaks") or []:
        peak_id = peak.get("id")
        if peak_id is None:
            continue

        peak_results.append(
            {
                "kind": "peak",
                "meta": _build_site_search_meta(peak.get("county"), peak.get("province")),
                "title": str(peak.get("name") or f"Peak #{peak_id}").strip() or f"Peak #{peak_id}",
                "url": url_for("peak_detail", peak_id=peak_id),
            }
        )

    user_results = []
    for profile in search_catalog.get("users") or []:
        display_name = str(profile.get("display_name") or "").strip()
        if not display_name:
            continue

        profile_record = {
            "id": profile.get("id"),
            "display_name": display_name,
        }
        user_results.append(
            {
                "avatar_url": profile.get("avatar_url"),
                "kind": "user",
                "meta": str(profile.get("location") or "").strip() or "Public profile",
                "profile_preview_name": None if str(profile.get("id") or "").strip() == str(current_user_id or "").strip() else display_name,
                "title": display_name,
                "url": _profile_url_for(profile_record, current_user_id),
            }
        )

    county_results = []
    for county in search_catalog.get("counties") or []:
        county_name = str(county.get("name") or "").strip()
        if not county_name:
            continue

        peak_count = int(county.get("peak_count") or 0)
        county_results.append(
            {
                "kind": "county",
                "meta": _build_site_search_meta(
                    county.get("province"),
                    f"{peak_count} peak" if peak_count == 1 else f"{peak_count} peaks",
                ),
                "title": county_name,
                "url": url_for("summit_list", county=county_name),
            }
        )

    sections = [
        {
            "icon": "fa-mountain",
            "key": "peaks",
            "label": "Peaks",
            "results": peak_results,
        },
        {
            "icon": "fa-user-group",
            "key": "users",
            "label": "Users",
            "results": user_results,
        },
        {
            "icon": "fa-map-pin",
            "key": "counties",
            "label": "Counties",
            "results": county_results,
        },
    ]
    for section in sections:
        section["count"] = len(section.get("results") or [])
    return sections


def build_index_page_context(page_data: dict, profile: dict | None) -> dict:
    all_peaks = page_data.get("all_peaks") or []
    peaks_by_id = page_data.get("peaks_by_id") or {}
    peak_statuses = page_data.get("peak_statuses") or {}
    return {
        "landing_stats": _build_landing_stats(all_peaks),
        "peak_statuses": peak_statuses,
        "peaks": _build_map_peaks(all_peaks, peak_statuses),
        "recent_climbs": _enrich_recent_climbs(page_data.get("recent_climbs") or [], peaks_by_id),
        "status_tracking_enabled": bool(profile),
    }


def build_home_page_context(page_data: dict, user_id: str) -> dict:
    all_peaks = page_data.get("all_peaks") or []
    peaks_by_id = page_data.get("peaks_by_id") or {}
    total_peaks = int(current_app.config.get("TOTAL_PEAK_COUNT") or 0) or len(all_peaks)
    peak_statuses = page_data.get("peak_statuses") or {}
    decorated_peaks = _decorate_peaks_with_statuses(all_peaks, peak_statuses)
    climbs = page_data.get("climbs") or []
    bucket_items = page_data.get("bucket_items") or []
    badges = page_data.get("badges") or []
    community_feed = page_data.get("community_feed") or []
    community_climbs = page_data.get("community_climbs") or []
    user_id = str(user_id or "").strip()
    badge_stats = build_user_badge_stats_from_data(all_peaks, climbs, badges, user_id=user_id)
    badge_catalog = build_achievement_catalog(badge_stats)
    is_new_user_dashboard = not climbs and not bucket_items and not badges
    dashboard_community_activity = _build_dashboard_community_feed(
        community_feed,
        user_id,
        limit=6,
    )
    dashboard_achievements = _build_dashboard_achievements(
        badges,
        badge_catalog.get("progress_lookup"),
        badge_catalog.get("next_badge"),
    )
    dashboard_recent_activity = _build_dashboard_activity_items(climbs, bucket_items, badges, peaks_by_id)
    if is_new_user_dashboard:
        dashboard_recent_activity = _build_dashboard_onboarding_steps()
    dashboard_peak_search_data = _build_dashboard_peak_search_data(decorated_peaks)
    dashboard_streak = _build_dashboard_streak(climbs)
    suggested_peaks = _build_dashboard_suggestions(
        decorated_peaks,
        bucket_items,
        climbs,
        community_climbs,
        limit=3 if is_new_user_dashboard else 5,
        popular_only=is_new_user_dashboard,
    )
    bucket_list_peaks = _build_dashboard_bucket_preview(bucket_items, decorated_peaks, limit=5)
    dashboard_progress = _build_dashboard_progress_data(climbs, peaks_by_id, total_peaks)
    if is_new_user_dashboard:
        dashboard_progress["intro_message"] = "Your adventure starts here. Log your first peak!"
    else:
        dashboard_progress["intro_message"] = f"{dashboard_progress.get('remaining_count', 0)} summits left on the full Irish list."
    dashboard_quick_stats = {
        "bucket_list_count": len(bucket_items),
        "peaks_climbed": dashboard_progress.get("completed_count", 0),
        "streak_weeks": int(dashboard_streak.get("display_weeks") or 0),
        "total_elevation_m": dashboard_progress.get("total_elevation_m", 0),
    }
    return {
        "bucket_list_peaks": bucket_list_peaks,
        "dashboard_achievements": dashboard_achievements,
        "dashboard_community_activity": dashboard_community_activity,
        "dashboard_is_new_user": is_new_user_dashboard,
        "dashboard_peak_search_data": dashboard_peak_search_data,
        "dashboard_progress": dashboard_progress,
        "dashboard_quick_stats": dashboard_quick_stats,
        "dashboard_recent_activity": dashboard_recent_activity,
        "dashboard_recently_viewed_peaks": _build_recently_viewed_peak_entries(peaks_by_id, peak_statuses),
        "dashboard_streak": dashboard_streak,
        "peak_statuses": peak_statuses,
        "suggested_peaks": suggested_peaks,
    }


def build_achievements_page_context(page_data: dict, user_id: str) -> dict:
    user_id = str(user_id or "").strip()
    badge_stats = build_user_badge_stats_from_data(
        page_data.get("all_peaks") or [],
        page_data.get("climbs") or [],
        page_data.get("badges") or [],
        user_id=user_id,
    )
    achievements_catalog = build_achievement_catalog(badge_stats)
    climbs = badge_stats.get("climbs") or []
    return {
        "achievements_catalog": achievements_catalog,
        "achievements_streak": badge_stats.get("streak") or _build_dashboard_streak(climbs),
        "achievements_total_climbs": len(climbs),
    }


def build_leaderboard_page_context(page_data: dict, current_user_id: str | None, height_unit: str, requested_tab: str) -> dict:
    highlighted_profile = dict(page_data.get("highlighted_profile") or {})
    highlighted_user_id = str(highlighted_profile.get("id") or "").strip() or None
    tab_definitions = [
        {
            "description": "Distinct public peaks climbed across Ireland.",
            "icon": "fa-mountain",
            "key": "peaks",
            "label": "Most Peaks",
            "rows": page_data.get("leaderboard_peaks") or [],
        },
        {
            "description": "Total elevation gained from distinct climbed peaks.",
            "icon": "fa-chart-column",
            "key": "elevation",
            "label": "Most Elevation",
            "rows": page_data.get("leaderboard_elevation") or [],
        },
        {
            "description": "Longest current climbing streak measured in weeks.",
            "icon": "fa-fire",
            "key": "streaks",
            "label": "Longest Streak",
            "rows": page_data.get("leaderboard_streaks") or [],
        },
    ]
    allowed_tabs = {definition["key"] for definition in tab_definitions}
    active_tab = requested_tab if requested_tab in allowed_tabs else "peaks"
    leaderboard_tabs = [
        {
            **definition,
            **_build_leaderboard_tab_context(
                definition["rows"],
                definition["key"],
                current_user_id,
                height_unit,
                highlighted_user_id,
            ),
        }
        for definition in tab_definitions
    ]
    return {
        "active_leaderboard_tab": active_tab,
        "leaderboard_community_stats": _build_leaderboard_community_stat_cards(
            page_data.get("leaderboard_community_stats") or {},
            height_unit,
        ),
        "leaderboard_popular_peaks": _build_leaderboard_popular_peak_entries(
            page_data.get("leaderboard_popular_peaks") or []
        ),
        "leaderboard_share_meta": _build_leaderboard_page_meta(active_tab, leaderboard_tabs),
        "leaderboard_tabs": leaderboard_tabs,
    }


def build_counties_page_context(page_data: dict) -> dict:
    climbed_peak_ids = page_data.get("climbed_peak_ids") or set()
    county_groups = _build_county_groups(page_data.get("peaks") or [], climbed_peak_ids=climbed_peak_ids)
    county_rows = [
        county
        for province in county_groups
        for county in (province.get("counties") or [])
    ]
    counted_peaks_total = sum(int(county.get("total_peaks") or 0) for county in county_rows)
    return {
        "county_groups": county_groups,
        "county_overview": {
            "climbed_peaks": len({_peak_key(peak_id) for peak_id in climbed_peak_ids if _peak_key(peak_id)}),
            "completed_counties": sum(1 for county in county_rows if county.get("is_completed")),
            "total_counties": len(county_rows),
            "total_peaks": counted_peaks_total,
        },
    }


def build_search_page_context(search_catalog: dict, current_user_id: str | None) -> dict:
    search_sections = _build_site_search_sections(search_catalog, current_user_id)
    return {
        "search_query": search_catalog.get("query") or "",
        "search_sections": search_sections,
        "total_search_results": sum(int(section.get("count") or 0) for section in search_sections),
    }


def build_map_page_context(page_data: dict, profile: dict | None) -> dict:
    all_peaks = page_data.get("all_peaks") or []
    peak_statuses = page_data.get("peak_statuses") or {}
    map_peaks = _build_map_peaks(all_peaks, peak_statuses)
    height_unit = _current_height_unit_for_preference(profile)
    return {
        "county_count": _count_distinct_values(map_peaks, "county"),
        "height_filter_range": _build_height_filter_range(peaks=map_peaks, unit=height_unit),
        "height_unit": height_unit,
        "peaks": map_peaks,
        "province_count": _count_distinct_values(map_peaks, "province"),
        "status_tracking_enabled": bool(profile),
    }


def build_my_climbs_page_context(page_data: dict, view_mode: str, selected_year: str, selected_month: str, search_query: str) -> dict:
    all_climbs = _build_my_climb_entries(page_data.get("climb_history") or [])
    available_years = sorted({climb["year"] for climb in all_climbs if climb.get("year")}, reverse=True)
    month_options = [
        {"value": month_number, "label": datetime(2000, month_number, 1).strftime("%B")}
        for month_number in range(1, 13)
    ]
    filtered_climbs = []
    normalized_query = search_query.lower()
    selected_year_value = int(selected_year) if selected_year.isdigit() else None
    selected_month_value = int(selected_month) if selected_month.isdigit() else None

    for climb in all_climbs:
        if selected_year_value and climb.get("year") != selected_year_value:
            continue
        if selected_month_value and climb.get("month") != selected_month_value:
            continue
        if normalized_query and normalized_query not in str(climb.get("peak_name") or "").lower():
            continue
        filtered_climbs.append(climb)

    total_peaks = int(current_app.config.get("TOTAL_PEAK_COUNT") or 0)
    return {
        "available_years": available_years,
        "climb_stats": _build_my_climb_stats(filtered_climbs),
        "current_view": view_mode,
        "month_options": month_options,
        "my_climb_map": _build_my_climb_map_data(filtered_climbs, total_peaks),
        "my_climbs": filtered_climbs,
        "search_query": search_query,
        "selected_month": selected_month,
        "selected_year": selected_year,
    }


def build_my_activity_page_context(page_data: dict, selected_type: str, date_from: str, date_to: str, current_page: int) -> dict:
    all_activity = _build_dashboard_activity_items(
        page_data.get("climbs") or [],
        page_data.get("bucket_items") or [],
        page_data.get("badges") or [],
        page_data.get("peaks_by_id") or {},
        limit=None,
    )
    filtered_activity = _filter_dashboard_activity_items(
        all_activity,
        selected_type,
        date_from=date_from,
        date_to=date_to,
    )
    per_page = 50
    filtered_total = len(filtered_activity)
    total_pages = max(1, (filtered_total + per_page - 1) // per_page) if filtered_total else 1
    normalized_page = min(max(int(current_page or 1), 1), total_pages)
    start_index = (normalized_page - 1) * per_page
    end_index = start_index + per_page
    activity_type_options = [
        {"value": "all", "label": "All activity"},
        {"value": "climbs", "label": "Climbs"},
        {"value": "bucket_list", "label": "Bucket List"},
        {"value": "badges", "label": "Badges"},
    ]
    allowed_types = {option["value"] for option in activity_type_options}
    return {
        "activity_items": filtered_activity[start_index:end_index],
        "activity_type_options": activity_type_options,
        "current_page": normalized_page,
        "date_from": date_from,
        "date_to": date_to,
        "page_end": min(end_index, filtered_total),
        "page_start": (start_index + 1) if filtered_total else 0,
        "per_page": per_page,
        "selected_type": selected_type if selected_type in allowed_types else "all",
        "total_activity_count": len(all_activity),
        "total_filtered_count": filtered_total,
        "total_pages": total_pages,
    }


def build_my_bucket_list_page_context(page_data: dict, current_view: str, current_sort: str) -> dict:
    sort_options = [
        {"value": "date_added", "label": "Date Added"},
        {"value": "height", "label": "Height"},
        {"value": "name", "label": "Name"},
        {"value": "county", "label": "County"},
    ]
    peaks_by_id = {
        _peak_key(peak.get("id")): peak
        for peak in (page_data.get("all_peaks") or [])
        if peak.get("id") is not None
    }
    bucket_entries = _sort_bucket_list_entries(
        _build_bucket_list_entries(
            page_data.get("bucket_items") or [],
            peaks_by_id,
            page_data.get("peak_statuses") or {},
        ),
        current_sort,
    )
    return {
        "bucket_count": len(bucket_entries),
        "bucket_entries": bucket_entries,
        "bucket_map": _build_bucket_list_map_data(bucket_entries),
        "current_sort": current_sort,
        "current_view": current_view,
        "sort_options": sort_options,
    }


def build_summit_list_page_context(page_data: dict, profile: dict | None) -> dict:
    height_unit = _current_height_unit_for_preference(profile)
    summit_peaks = _decorate_peaks_with_statuses(
        page_data.get("peaks") or [],
        page_data.get("peak_statuses") or {},
    )
    return {
        "action_buttons_visible": bool(profile),
        "height_filter_range": _build_height_filter_range(peaks=summit_peaks, unit=height_unit),
        "height_unit": height_unit,
        "peak_statuses": page_data.get("peak_statuses") or {},
        "peaks": summit_peaks,
        "status_column_visible": bool(profile),
    }


def build_peak_detail_page_context(page_data: dict, current_user_id: str | None) -> dict:
    peak = dict(page_data.get("peak") or {})
    peak_latitude = _to_float(peak.get("latitude") or peak.get("lat"))
    peak_longitude = _to_float(peak.get("longitude") or peak.get("lon") or peak.get("lng"))
    has_climbed = page_data.get("has_climbed_entry") is not None
    is_bucket_listed = page_data.get("bucket_entry") is not None
    peak_status = "climbed" if has_climbed else ("bucket_listed" if is_bucket_listed else "not_attempted")
    climbers = _build_peak_climber_entries(page_data.get("climber_rows") or [], current_user_id)
    comments = _build_peak_comment_entries(page_data.get("comments") or [], current_user_id)
    related_peaks_data = _build_related_peaks(
        peak,
        current_user_id,
        all_peaks=page_data.get("all_peaks") or [],
        peak_statuses=page_data.get("related_peak_statuses") or {},
    )
    return {
        "avg_difficulty": page_data.get("avg_difficulty"),
        "avg_difficulty_stars": _difficulty_star_count(page_data.get("avg_difficulty")),
        "all_climbers": climbers,
        "climbers": climbers[:5],
        "comments": comments,
        "current_user_id": current_user_id,
        "has_climbed": has_climbed,
        "is_bucket_listed": is_bucket_listed,
        "peak": {
            **peak,
            "latitude": peak_latitude,
            "longitude": peak_longitude,
            "user_status": peak_status,
        },
        "peak_share_meta": _build_peak_detail_meta(
            {
                **peak,
                "height_m": peak.get("height_m") or peak.get("height"),
                "height_rank": peak.get("height_rank"),
            }
        ),
        "peak_status": peak_status,
        "peak_weather": get_peak_weather(peak.get("id"), peak.get("name") or "this peak", peak_latitude, peak_longitude),
        "related_peaks": related_peaks_data["peaks"],
        "related_peaks_title": related_peaks_data["title"],
        "total_climbers": len(climbers),
        "user_climbs": _build_user_peak_climb_entries(page_data.get("user_peak_climbs") or []),
    }


def build_public_profile_page_context(page_data: dict, current_user_id: str | None, current_view: str) -> dict:
    profile_record = dict(page_data.get("profile_record") or {})
    profile_user_id = str(profile_record.get("id") or "").strip()
    is_owner = bool(current_user_id and profile_user_id == str(current_user_id))
    is_private_profile = bool(not is_owner and not _is_profile_public(profile_record))
    public_profile_view = _empty_public_profile_view_data(profile_record)
    compare_with_me_url = None

    if not is_private_profile and profile_user_id:
        all_peaks = page_data.get("all_peaks") or []
        total_peaks = int(current_app.config.get("TOTAL_PEAK_COUNT") or 0) or len(all_peaks)
        public_profile_view = _build_public_profile_view_data(
            profile_record,
            all_peaks=all_peaks,
            total_peaks=total_peaks,
            climbs=page_data.get("profile_climbs") or [],
            badges=page_data.get("profile_badges") or [],
        )

        current_profile = dict(page_data.get("current_profile") or {})
        current_display_name = str(current_profile.get("display_name") or "").strip()
        if current_display_name and not is_owner and _is_profile_public(current_profile):
            compare_with_me_url = url_for(
                "compare_profiles",
                name1=current_display_name,
                name2=str(profile_record.get("display_name") or "").strip(),
            )

    return {
        "compare_with_me_url": compare_with_me_url,
        "current_profile_view": current_view,
        "is_private_profile": is_private_profile,
        "is_profile_owner": is_owner,
        "public_profile": profile_record,
        "public_profile_badges": public_profile_view["badges"],
        "public_profile_map": public_profile_view["map"],
        "public_profile_recent_climbs": public_profile_view["recent_climbs"],
        "public_profile_stats": public_profile_view["stats"],
    }


def build_badge_share_page_context(page_data: dict, badge_key: str, display_name: str, is_logged_in: bool) -> dict | None:
    profile_record = dict(page_data.get("profile_record") or {})
    profile_user_id = str(profile_record.get("id") or "").strip()
    normalized_badge_key = normalize_badge_key(badge_key)
    badge_definition = get_badge_definition(normalized_badge_key)
    if not profile_user_id or badge_definition is None:
        return None

    earned_badges = _build_public_profile_badges(page_data.get("earned_badges") or [])
    earned_badge = next(
        (badge for badge in earned_badges if str(badge.get("key") or "") == normalized_badge_key),
        None,
    )
    if earned_badge is None:
        return None

    badge_label = str(earned_badge.get("label") or badge_definition.get("name") or "Badge").strip()
    display_name_value = str(profile_record.get("display_name") or display_name or "Climber").strip() or "Climber"
    earned_date_label = (
        format_display_date(earned_badge.get("earned_at"), fallback="Recently")
        if earned_badge.get("earned_at")
        else "Recently"
    )
    return {
        "badge_share_badge": {
            **earned_badge,
            "description": str(badge_definition.get("description") or ""),
        },
        "badge_share_cta_url": url_for("home") if is_logged_in else url_for("index"),
        "badge_share_description": f"{display_name_value} earned the {badge_label} badge on Emerald Peak Explorer.",
        "badge_share_display_name": display_name_value,
        "badge_share_earned_date": earned_date_label,
        "badge_share_title": f"{badge_label} | Emerald Peak Explorer",
        "badge_share_url": request.url,
    }


def build_compare_profiles_page_context(page_data: dict) -> dict:
    left_profile = dict(page_data.get("left_profile") or {})
    right_profile = dict(page_data.get("right_profile") or {})
    all_peaks = page_data.get("all_peaks") or []
    total_peaks = int(current_app.config.get("TOTAL_PEAK_COUNT") or 0) or len(all_peaks)
    left_view = _build_public_profile_view_data(
        left_profile,
        all_peaks=all_peaks,
        total_peaks=total_peaks,
        climbs=page_data.get("left_climbs") or [],
        badges=page_data.get("left_badges") or [],
    )
    right_view = _build_public_profile_view_data(
        right_profile,
        all_peaks=all_peaks,
        total_peaks=total_peaks,
        climbs=page_data.get("right_climbs") or [],
        badges=page_data.get("right_badges") or [],
    )
    return {
        "compare_left": left_view,
        "compare_left_profile": left_profile,
        "compare_metric_rows": _build_profile_compare_metric_rows(left_view, right_view),
        "compare_peak_overlap": _build_profile_compare_peak_overlap(left_view, right_view),
        "compare_province_rows": _build_profile_compare_province_rows(left_view, right_view),
        "compare_right": right_view,
        "compare_right_profile": right_profile,
    }
