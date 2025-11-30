from __future__ import annotations

from collections import Counter
from datetime import date, timedelta, timezone
from typing import Any

from badges_config import (
    BADGES,
    BADGE_CATEGORY_LABELS,
    BADGE_CATEGORY_ORDER,
    BADGE_LABELS,
    get_badge_definition,
    normalize_badge_key,
)
from supabase_utils import (
    award_badge,
    calculate_climb_streak,
    get_all_peaks,
    get_user_badges,
    get_user_climbs,
)
from time_utils import parse_datetime_value


TRUTHY_VALUES = {"1", "true", "yes", "on", "y", "t"}
BUCKET_COMPLETION_FIELDS = (
    "bucket_list_completion",
    "bucket_completion",
    "completed_from_bucket_list",
    "removed_from_bucket_list",
    "from_bucket_list",
)


def _peak_key(value: Any) -> str:
    return str(value) if value is not None else ""


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _is_truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return _normalize_text(value) in TRUTHY_VALUES


def _climb_date_value(climb: dict) -> date | None:
    raw_value = (
        climb.get("date_climbed")
        or climb.get("climbed_at")
        or climb.get("created_at")
    )
    parsed = parse_datetime_value(raw_value)
    if parsed is None:
        return None
    return parsed.astimezone(timezone.utc).date()


def _normalize_photo_urls(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    return []


def _week_anchor_for_date(climb_date: date) -> date:
    return climb_date - timedelta(days=climb_date.isoweekday() - 1)


def _weekend_anchor_for_date(climb_date: date) -> date | None:
    weekday = climb_date.weekday()
    if weekday == 5:
        return climb_date
    if weekday == 6:
        return climb_date - timedelta(days=1)
    return None


def _longest_consecutive_run(anchors: set[date]) -> int:
    if not anchors:
        return 0

    longest_run = 0
    for anchor in sorted(anchors):
        if (anchor - timedelta(days=7)) in anchors:
            continue

        current_run = 1
        cursor = anchor
        while (cursor + timedelta(days=7)) in anchors:
            current_run += 1
            cursor += timedelta(days=7)
        longest_run = max(longest_run, current_run)

    return longest_run


def _merge_peak_snapshot(climb: dict, peaks_by_id: dict[str, dict]) -> dict:
    peak_id = climb.get("peak_id")
    peak = dict(peaks_by_id.get(_peak_key(peak_id)) or {})
    peak_name = (
        climb.get("peak_name")
        or peak.get("name")
        or (f"Peak #{peak_id}" if peak_id is not None else "Unknown Peak")
    )
    return {
        "peak_id": peak_id,
        "name": peak_name,
        "height_m": _to_float(climb.get("peak_height_m") or climb.get("height_m") or peak.get("height_m") or peak.get("height")),
        "height_ft": _to_float(climb.get("peak_height_ft") or climb.get("height_ft") or peak.get("height_ft")),
        "province": str(climb.get("peak_province") or peak.get("province") or "").strip(),
        "county": str(climb.get("peak_county") or peak.get("county") or "").strip(),
    }


def _count_bucket_completions(climbs: list[dict]) -> int:
    completions = 0

    for climb in climbs:
        explicit_count = climb.get("bucket_completion_count")
        if isinstance(explicit_count, (int, float)):
            completions += max(int(explicit_count), 0)
            continue

        if any(_is_truthy(climb.get(field_name)) for field_name in BUCKET_COMPLETION_FIELDS):
            completions += 1

    return completions


def build_user_badge_stats_from_data(
    all_peaks: list[dict[str, Any]] | None,
    climbs: list[dict[str, Any]] | None,
    earned_badges: list[dict[str, Any]] | None = None,
    *,
    user_id: str = "",
) -> dict[str, Any]:
    all_peaks = list(all_peaks or [])
    climbs = list(climbs or [])
    earned_badges = list(earned_badges or [])
    peaks_by_id = {
        _peak_key(peak.get("id")): dict(peak)
        for peak in all_peaks
        if peak.get("id") is not None
    }

    tracked_peaks_by_county = Counter(
        str((peak or {}).get("county") or "").strip()
        for peak in all_peaks
        if str((peak or {}).get("county") or "").strip()
    )

    distinct_climbed_peaks: dict[str, dict] = {}
    climbed_peak_names: set[str] = set()
    photo_count = 0
    weekly_anchors: set[date] = set()
    weekend_anchors: set[date] = set()

    for climb in climbs:
        peak_snapshot = _merge_peak_snapshot(climb, peaks_by_id)
        peak_id = peak_snapshot.get("peak_id")
        peak_name_key = _normalize_text(peak_snapshot.get("name"))
        if peak_name_key:
            climbed_peak_names.add(peak_name_key)

        photo_count += len(_normalize_photo_urls(climb.get("photo_urls")))

        climb_date = _climb_date_value(climb)
        if climb_date is not None:
            weekly_anchors.add(_week_anchor_for_date(climb_date))
            weekend_anchor = _weekend_anchor_for_date(climb_date)
            if weekend_anchor is not None:
                weekend_anchors.add(weekend_anchor)

        if peak_id is None:
            continue

        peak_key = _peak_key(peak_id)
        if peak_key not in distinct_climbed_peaks:
            distinct_climbed_peaks[peak_key] = peak_snapshot

    climbed_peaks = list(distinct_climbed_peaks.values())
    climbed_peak_count = len(climbed_peaks)
    province_counts = Counter(
        str(peak.get("province") or "").strip()
        for peak in climbed_peaks
        if str(peak.get("province") or "").strip()
    )
    county_counts = Counter(
        str(peak.get("county") or "").strip()
        for peak in climbed_peaks
        if str(peak.get("county") or "").strip()
    )
    max_height_m = max(
        (_to_float(peak.get("height_m")) or 0 for peak in climbed_peaks),
        default=0,
    )

    return {
        "all_peaks": all_peaks,
        "bucket_completion_count": _count_bucket_completions(climbs),
        "climbed_peak_count": climbed_peak_count,
        "climbed_peak_names": climbed_peak_names,
        "climbed_peaks": climbed_peaks,
        "climbs": climbs,
        "county_counts": county_counts,
        "earned_badges": earned_badges,
        "longest_weekend_streak": _longest_consecutive_run(weekend_anchors),
        "longest_weekly_streak": _longest_consecutive_run(weekly_anchors),
        "max_height_m": max_height_m,
        "photo_count": photo_count,
        "province_counts": province_counts,
        "streak": calculate_climb_streak(climbs),
        "total_peak_count": len({str((peak or {}).get("id")) for peak in all_peaks if (peak or {}).get("id") is not None}),
        "tracked_peaks_by_county": tracked_peaks_by_county,
        "user_id": user_id,
    }


def build_user_badge_stats(user_id: str) -> dict[str, Any]:
    return build_user_badge_stats_from_data(
        get_all_peaks(),
        get_user_climbs(user_id),
        get_user_badges(user_id),
        user_id=user_id,
    )


def _badge_earned_at_value(badge: dict[str, Any]) -> str:
    return str(
        badge.get("earned_at")
        or badge.get("created_at")
        or badge.get("awarded_at")
        or badge.get("inserted_at")
        or badge.get("updated_at")
        or ""
    ).strip()


def _format_progress_label(current: int, target: int, noun: str) -> str:
    safe_target = max(int(target or 0), 0)
    safe_current = max(int(current or 0), 0)
    return f"{safe_current} / {safe_target} {noun}"


def describe_badge_progress(criteria: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    criteria = dict(criteria or {})
    criteria_type = _normalize_text(criteria.get("type"))
    target_value = max(int(criteria.get("value") or 0), 0)
    current_value = 0
    target = target_value
    requirement_text = str(criteria.get("description") or "").strip()
    progress_label = ""

    if criteria_type == "peak_count":
        current_value = int(stats.get("climbed_peak_count") or 0)
        target = target_value
        requirement_text = requirement_text or f"Climb {target} distinct peaks."
        progress_label = _format_progress_label(current_value, target, "peaks")
    elif criteria_type == "all_peaks":
        current_value = int(stats.get("climbed_peak_count") or 0)
        target = int(stats.get("total_peak_count") or 0)
        requirement_text = requirement_text or "Climb every tracked Irish peak."
        progress_label = _format_progress_label(current_value, target, "peaks")
    elif criteria_type in {"height_min", "height_peak"}:
        target = max(int(float(criteria.get("value") or 0)), 0)
        current_value = int(round(float(stats.get("max_height_m") or 0)))
        requirement_text = requirement_text or f"Climb a peak at or above {target}m."
        progress_label = _format_progress_label(current_value, target, "m")
    elif criteria_type == "province_count":
        province_name = str(criteria.get("province") or "").strip()
        current_value = int((stats.get("province_counts") or {}).get(province_name, 0))
        target = target_value or 1
        if not requirement_text:
            requirement_text = (
                f"Climb {target} peak in {province_name}."
                if target == 1
                else f"Climb {target} peaks in {province_name}."
            )
        progress_label = _format_progress_label(current_value, target, "peaks")
    elif criteria_type in {"all_provinces", "province_set"}:
        provinces = criteria.get("provinces") or ("Munster", "Leinster", "Ulster", "Connacht")
        province_counts = stats.get("province_counts") or {}
        current_value = sum(1 for province in provinces if int(province_counts.get(str(province).strip(), 0)) >= 1)
        target = target_value or len(provinces)
        requirement_text = requirement_text or "Climb at least one peak in each province."
        progress_label = _format_progress_label(current_value, target, "provinces")
    elif criteria_type in {"county_complete", "county_completion"}:
        county_name = str(criteria.get("county") or "").strip()
        climbed_total = int((stats.get("county_counts") or {}).get(county_name, 0))
        tracked_total = int((stats.get("tracked_peaks_by_county") or {}).get(county_name, 0))
        current_value = climbed_total
        target = tracked_total or 1
        requirement_text = (
            f"Climb every tracked peak in {county_name}."
            if tracked_total > 0
            else f"No tracked peaks are currently counted in {county_name}."
        )
        progress_label = _format_progress_label(current_value, tracked_total, "peaks") if tracked_total > 0 else "0 / 0 peaks"
    elif criteria_type == "specific_peak":
        peak_name = str(criteria.get("peak_name") or "").strip()
        current_value = 1 if _normalize_text(peak_name) in (stats.get("climbed_peak_names") or set()) else 0
        target = 1
        requirement_text = requirement_text or f"Climb {peak_name}."
        progress_label = _format_progress_label(current_value, target, "peak")
    elif criteria_type in {"streak", "weekly_streak", "consecutive_weekends"}:
        mode = _normalize_text(criteria.get("mode"))
        if criteria_type == "weekly_streak":
            mode = "weekly"
        elif criteria_type == "consecutive_weekends":
            mode = "weekend"

        target = target_value or 1
        if mode == "weekend":
            current_value = int(stats.get("longest_weekend_streak") or 0)
            requirement_text = requirement_text or f"Climb across {target} consecutive weekends."
            progress_label = _format_progress_label(current_value, target, "weekends")
        else:
            current_value = int(stats.get("longest_weekly_streak") or 0)
            requirement_text = requirement_text or f"Climb every week for {target} straight weeks."
            progress_label = _format_progress_label(current_value, target, "weeks")
    elif criteria_type == "photo_count":
        current_value = int(stats.get("photo_count") or 0)
        target = target_value or 1
        requirement_text = requirement_text or f"Upload {target} climb photos."
        progress_label = _format_progress_label(current_value, target, "photos")
    elif criteria_type in {"bucket_completions", "bucket_list_completions"}:
        current_value = int(stats.get("bucket_completion_count") or 0)
        target = target_value or 1
        requirement_text = requirement_text or f"Complete {target} climbs from your bucket list."
        progress_label = _format_progress_label(current_value, target, "completions")
    else:
        current_value = 0
        target = target_value or 1
        requirement_text = requirement_text or "Keep climbing to unlock this badge."
        progress_label = _format_progress_label(current_value, target, "steps")

    if not requirement_text:
        requirement_text = "Keep climbing to unlock this badge."

    progress_denominator = max(int(target or 0), 1)
    progress_percent = int(round((min(max(current_value, 0), progress_denominator) / progress_denominator) * 100))

    return {
        "current_value": max(int(current_value or 0), 0),
        "target_value": max(int(target or 0), 0),
        "progress_percent": max(0, min(progress_percent, 100)),
        "progress_label": progress_label or _format_progress_label(current_value, target, "steps"),
        "requirement_text": requirement_text,
    }


def build_badge_progress_lookup(stats: dict[str, Any]) -> dict[str, dict[str, int]]:
    progress_lookup: dict[str, dict[str, int]] = {}
    for badge_definition in BADGES:
        badge_key = str((badge_definition or {}).get("key") or "").strip()
        if not badge_key:
            continue
        progress = describe_badge_progress((badge_definition or {}).get("criteria") or {}, stats)
        progress_lookup[badge_key] = {
            "current": int(progress.get("current_value") or 0),
            "target": int(progress.get("target_value") or 0),
            "percentage": int(progress.get("progress_percent") or 0),
        }
    return progress_lookup


def get_all_badge_progress(user_id: str) -> dict[str, dict[str, int]]:
    return build_badge_progress_lookup(build_user_badge_stats(user_id))


def build_achievement_catalog(stats: dict[str, Any]) -> dict[str, Any]:
    earned_badges = {}
    for badge in stats.get("earned_badges") or []:
        badge_key = normalize_badge_key((badge or {}).get("badge_key"))
        if not badge_key or badge_key in earned_badges:
            continue
        earned_badges[badge_key] = badge

    progress_lookup = build_badge_progress_lookup(stats)
    badge_cards = []
    next_badge = None
    total_badges = len(BADGES)
    earned_count = 0

    for index, badge_definition in enumerate(BADGES):
        badge_key = str((badge_definition or {}).get("key") or "").strip()
        if not badge_key:
            continue

        earned_badge = earned_badges.get(badge_key)
        is_earned = earned_badge is not None or evaluate_badge(badge_definition, stats)
        progress = describe_badge_progress(badge_definition.get("criteria") or {}, stats)
        progress_numbers = progress_lookup.get(badge_key) or {}
        earned_at = _badge_earned_at_value(earned_badge or {})
        earned_at_value = parse_datetime_value(earned_at)

        badge_card = {
            "key": badge_key,
            "label": str(badge_definition.get("name") or badge_key.replace("_", " ").title()),
            "description": str(badge_definition.get("description") or progress.get("requirement_text") or ""),
            "icon": str(badge_definition.get("icon") or "fa-award"),
            "category": str(badge_definition.get("category") or "special"),
            "is_earned": is_earned,
            "is_locked": not is_earned,
            "is_next": False,
            "earned_at": earned_at or None,
            "earned_sort": earned_at_value,
            **progress,
            "current": int(progress_numbers.get("current") or 0),
            "target": int(progress_numbers.get("target") or 0),
            "percentage": int(progress_numbers.get("percentage") or 0),
            "_order": index,
        }
        badge_cards.append(badge_card)
        if is_earned:
            earned_count += 1
            continue

        if next_badge is None:
            next_badge = badge_card
            continue

        current_rank = (
            int(next_badge.get("progress_percent") or 0),
            int(next_badge.get("current_value") or 0),
            -int(next_badge.get("_order") or 0),
        )
        candidate_rank = (
            int(badge_card.get("progress_percent") or 0),
            int(badge_card.get("current_value") or 0),
            -int(badge_card.get("_order") or 0),
        )
        if candidate_rank > current_rank:
            next_badge = badge_card

    grouped_categories = []
    for category_key in BADGE_CATEGORY_ORDER:
        category_badges = [badge for badge in badge_cards if badge.get("category") == category_key]
        if not category_badges:
            continue

        category_entry = {
            "key": category_key,
            "label": BADGE_CATEGORY_LABELS.get(category_key, category_key.replace("_", " ").title()),
            "earned_count": sum(1 for badge in category_badges if badge.get("is_earned")),
            "total_count": len(category_badges),
            "badges": category_badges,
        }
        grouped_categories.append(category_entry)

    if next_badge is not None:
        next_badge["is_next"] = True

    recently_earned = sorted(
        [badge for badge in badge_cards if badge.get("is_earned")],
        key=lambda badge: badge.get("earned_sort") or parse_datetime_value("1970-01-01T00:00:00+00:00"),
        reverse=True,
    )

    return {
        "categories": grouped_categories,
        "earned_count": earned_count,
        "next_badge": next_badge,
        "progress_lookup": progress_lookup,
        "recently_earned": recently_earned,
        "total_count": total_badges,
    }


def evaluate_badge_criteria(criteria: dict[str, Any], stats: dict[str, Any]) -> bool:
    criteria = dict(criteria or {})
    criteria_type = _normalize_text(criteria.get("type"))
    target_value = int(criteria.get("value") or 0)

    if criteria_type == "peak_count":
        return int(stats.get("climbed_peak_count") or 0) >= target_value

    if criteria_type == "all_peaks":
        total_peak_count = int(stats.get("total_peak_count") or 0)
        return total_peak_count > 0 and int(stats.get("climbed_peak_count") or 0) >= total_peak_count

    if criteria_type in {"height_min", "height_peak"}:
        return float(stats.get("max_height_m") or 0) >= float(criteria.get("value") or 0)

    if criteria_type == "province_count":
        province_name = str(criteria.get("province") or "").strip()
        return int((stats.get("province_counts") or {}).get(province_name, 0)) >= target_value

    if criteria_type in {"all_provinces", "province_set"}:
        provinces = criteria.get("provinces") or ("Munster", "Leinster", "Ulster", "Connacht")
        province_counts = stats.get("province_counts") or {}
        completed = sum(1 for province in provinces if int(province_counts.get(str(province).strip(), 0)) >= 1)
        required = target_value or len(provinces)
        return completed >= required

    if criteria_type in {"county_complete", "county_completion"}:
        county_name = str(criteria.get("county") or "").strip()
        tracked_total = int((stats.get("tracked_peaks_by_county") or {}).get(county_name, 0))
        climbed_total = int((stats.get("county_counts") or {}).get(county_name, 0))
        return tracked_total > 0 and climbed_total >= tracked_total

    if criteria_type == "specific_peak":
        peak_name = _normalize_text(criteria.get("peak_name"))
        if not peak_name:
            return False
        return peak_name in (stats.get("climbed_peak_names") or set())

    if criteria_type in {"streak", "weekly_streak", "consecutive_weekends"}:
        mode = _normalize_text(criteria.get("mode"))
        if criteria_type == "weekly_streak":
            mode = "weekly"
        elif criteria_type == "consecutive_weekends":
            mode = "weekend"

        if mode == "weekend":
            return int(stats.get("longest_weekend_streak") or 0) >= target_value
        return int(stats.get("longest_weekly_streak") or 0) >= target_value

    if criteria_type == "photo_count":
        return int(stats.get("photo_count") or 0) >= target_value

    if criteria_type in {"bucket_completions", "bucket_list_completions"}:
        return int(stats.get("bucket_completion_count") or 0) >= target_value

    return False


def evaluate_badge(badge: dict[str, Any], stats: dict[str, Any]) -> bool:
    return evaluate_badge_criteria((badge or {}).get("criteria") or {}, stats)


def check_badges(user_id: str) -> list[str]:
    stats = build_user_badge_stats(user_id)
    existing_badge_keys = {
        normalize_badge_key((badge or {}).get("badge_key"))
        for badge in (stats.get("earned_badges") or [])
        if (badge or {}).get("badge_key")
    }

    new_badge_keys: list[str] = []

    for badge in BADGES:
        badge_key = str((badge or {}).get("key") or "").strip()
        if not badge_key or badge_key in existing_badge_keys:
            continue

        if not evaluate_badge(badge, stats):
            continue

        created_badge = award_badge(user_id, badge_key)
        if created_badge is not None:
            existing_badge_keys.add(badge_key)
            new_badge_keys.append(badge_key)
            continue

        refreshed_badge_keys = {
            normalize_badge_key((earned_badge or {}).get("badge_key"))
            for earned_badge in get_user_badges(user_id)
            if (earned_badge or {}).get("badge_key")
        }
        if badge_key in refreshed_badge_keys:
            existing_badge_keys.update(refreshed_badge_keys)
            new_badge_keys.append(badge_key)

    return new_badge_keys


def describe_new_badges(badge_keys: list[str]) -> list[dict[str, str]]:
    descriptions = []
    for badge_key in badge_keys or []:
        normalized_key = normalize_badge_key(badge_key)
        badge_definition = get_badge_definition(normalized_key) or {}
        label = str(
            badge_definition.get("name")
            or BADGE_LABELS.get(normalized_key)
            or normalized_key.replace("_", " ").title()
        )
        descriptions.append(
            {
                "key": normalized_key,
                "label": label,
                "name": label,
                "description": str(badge_definition.get("description") or "Badge unlocked from your climbing progress."),
                "icon": str(badge_definition.get("icon") or "fa-award"),
            }
        )
    return descriptions
