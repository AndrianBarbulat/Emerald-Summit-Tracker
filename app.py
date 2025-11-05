import re
from datetime import datetime, timezone

from flask import Flask, abort, jsonify, render_template, request, redirect, session, url_for, g
from werkzeug.exceptions import HTTPException

from api_routes import api
from supabase_utils import (
    get_all_peaks,
    get_peak_average_difficulty,
    get_peak_count,
    get_community_recent_climbs,
    get_peak_by_id,
    get_peak_climbers_with_profiles,
    get_peak_comments_with_profiles,
    get_profile_by_display_name,
    get_user_bucket_list,
    get_user_climb_history,
    get_user_climbs,
    get_user_has_climbed,
    get_user_peak_climbs,
    get_peak_statuses,
    is_bucket_listed as get_bucket_list_entry,
    supabase,
)
from time_utils import format_display_date, format_time_ago, parse_datetime_value

app = Flask(__name__)
app.secret_key = "dev-secret-key"
app.register_blueprint(api)

FEET_PER_METER = 3.28084
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def get_session_context() -> dict:
    return {
        "user": session.get("user"),
        "profile": session.get("profile"),
    }


def _prime_total_peak_count_cache() -> None:
    cached_count = get_peak_count()
    if cached_count is None:
        cached_count = len(get_all_peaks())
    app.config["TOTAL_PEAK_COUNT"] = max(int(cached_count or 0), 0)


def _set_active_page(page_name: str | None) -> None:
    g.active_page = page_name or ""


_prime_total_peak_count_cache()


def _is_api_request() -> bool:
    return request.path.startswith("/api/") or request.blueprint == "api"


def _json_api_error(status_code: int, message: str):
    return jsonify({"success": False, "ok": False, "error": True, "message": message, "fields": {}}), status_code


def _request_wants_json() -> bool:
    accept_header = str(request.headers.get("Accept") or "").lower()
    requested_with = str(request.headers.get("X-Requested-With") or "").lower()
    return request.is_json or "application/json" in accept_header or requested_with == "xmlhttprequest"


def _form_json_error(message: str, status_code: int = 400, fields: dict | None = None):
    normalized_fields = {
        str(field_name): str(field_message).strip()
        for field_name, field_message in (fields or {}).items()
        if str(field_name or "").strip() and str(field_message or "").strip()
    }
    return jsonify(
        {
            "success": False,
            "ok": False,
            "error": True,
            "message": message,
            "fields": normalized_fields,
        }
    ), status_code


def _form_error_response(message: str, status_code: int = 400, fields: dict | None = None):
    if _request_wants_json():
        return _form_json_error(message, status_code, fields=fields)
    return message, status_code


def _form_success_response(redirect_url: str):
    if _request_wants_json():
        return jsonify({"success": True, "ok": True, "redirect_to": redirect_url}), 200
    return redirect(redirect_url)


def _looks_like_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.fullmatch(str(value or "").strip()))


def _is_email_registered_error(error_message: str) -> bool:
    normalized_message = str(error_message or "").strip().lower()
    return "already registered" in normalized_message or "user already exists" in normalized_message


def _is_invalid_login_error(error_message: str) -> bool:
    normalized_message = str(error_message or "").strip().lower()
    return "invalid login credentials" in normalized_message or "invalid email or password" in normalized_message


def _error_home_url() -> str:
    current_profile = session.get("profile")
    if isinstance(current_profile, dict) and current_profile.get("id"):
        return url_for("home")
    return url_for("index")


def _render_site_error(template_name: str, status_code: int):
    _set_active_page("error")
    return render_template(
        template_name,
        home_url=_error_home_url(),
    ), status_code


def _minimal_profile(user_id: str, email: str) -> dict:
    email_value = (email or "").strip().lower()
    display_name = email_value.split("@")[0] if "@" in email_value else "climber"
    return {
        "id": user_id,
        "email": email_value,
        "display_name": display_name or "climber",
    }


def _sanitize_display_name(email: str) -> str:
    base = (email or "").split("@")[0].strip().lower()
    cleaned = re.sub(r"[^a-z0-9._-]+", "_", base)
    cleaned = re.sub(r"_+", "_", cleaned).strip("._-")
    return cleaned or "climber"


def _profile_row_by_id(user_id: str):
    try:
        response = (
            supabase.table("profiles")
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        data = response.data or []
        return data[0] if data else None
    except Exception as exc:
        app.logger.exception("Profile lookup failed for user_id=%s: %s", user_id, exc)
        return None


def _try_create_profile_row(user_id: str, email: str, display_name: str):
    payload_variants = [
        {"id": user_id, "email": email, "display_name": display_name},
        {"id": user_id, "display_name": display_name},
        {"id": user_id},
    ]
    last_error = ""

    for payload in payload_variants:
        try:
            response = supabase.table("profiles").insert(payload).execute()
            data = response.data or []
            if data:
                return data[0], ""
        except Exception as exc:
            last_error = str(exc)
            if _is_display_name_conflict(last_error):
                return None, last_error
            continue

    return None, last_error


def _fetch_profile_for_session(user_id: str, email: str) -> dict:
    if supabase is None:
        return _minimal_profile(user_id, email)

    existing_profile = _profile_row_by_id(user_id)
    if existing_profile:
        return existing_profile

    normalized_email = (email or "").strip().lower()
    base_name = _sanitize_display_name(normalized_email)
    id_suffix = (user_id or "")[:8] or "user"
    candidate_names = [
        base_name,
        f"{base_name}_{id_suffix}",
        f"{base_name}_{int(datetime.now(tz=timezone.utc).timestamp())}",
    ]

    for candidate in candidate_names:
        created, create_error = _try_create_profile_row(user_id, normalized_email, candidate)
        if created:
            return created
        if create_error and _is_display_name_conflict(create_error):
            app.logger.warning(
                "Profile create conflict for user_id=%s display_name=%s. Retrying with a new suffix.",
                user_id,
                candidate,
            )
            continue
        if create_error:
            app.logger.warning("Profile create failed for user_id=%s: %s", user_id, create_error)
            break

    existing_profile = _profile_row_by_id(user_id)
    if existing_profile:
        return existing_profile

    app.logger.warning("Profile row not found for user_id=%s. Using minimal profile.", user_id)
    return _minimal_profile(user_id, email)


def _is_display_name_conflict(error_message: str) -> bool:
    message = (error_message or "").lower()
    return (
        "display_name" in message
        or "profiles_display_name_key" in message
        or ("duplicate key" in message and "profile" in message)
    )


def _parse_datetime(value: str):
    return parse_datetime_value(value)


def _relative_time(value: str) -> str:
    return format_time_ago(value)


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_short_date(value: str) -> str:
    return format_display_date(value, fallback="Recent climb")


@app.template_filter("timeago")
def timeago_filter(value) -> str:
    return format_time_ago(value)


def _current_height_unit_for_preference(unit_preference=None) -> str:
    if isinstance(unit_preference, str):
        normalized = unit_preference.strip().lower()
        if normalized in {"imperial", "feet", "foot", "ft"}:
            return "ft"
        if normalized in {"metric", "meters", "metres", "m"}:
            return "m"

    if _prefers_imperial_units(unit_preference):
        return "ft"

    return "m"


def _height_display_value(height_m, unit_preference=None, height_ft=None):
    preferred_unit = _current_height_unit_for_preference(unit_preference)
    metric_value = _to_float(height_m)
    imperial_value = _to_float(height_ft)

    if preferred_unit == "ft":
        if imperial_value is not None:
            return int(round(imperial_value)), "ft"
        if metric_value is not None:
            return int(round(metric_value * FEET_PER_METER)), "ft"
        return None, "ft"

    if metric_value is not None:
        return int(round(metric_value)), "m"
    if imperial_value is not None:
        return int(round(imperial_value / FEET_PER_METER)), "m"
    return None, "m"


@app.template_filter("format_height")
def format_height_filter(height_m, unit_preference=None, height_ft=None) -> str:
    value, unit = _height_display_value(height_m, unit_preference, height_ft)
    if value is None:
        return "-"
    return f"{value}{unit}"


@app.context_processor
def inject_common_data() -> dict:
    profile = session.get("profile")
    user = session.get("user")
    unit_preference = "imperial" if _prefers_imperial_units(profile) else "metric"

    return {
        "active_page": getattr(g, "active_page", ""),
        "current_height_unit": "ft" if unit_preference == "imperial" else "m",
        "profile": profile,
        "total_peak_count": int(app.config.get("TOTAL_PEAK_COUNT") or 0),
        "unit_preference": unit_preference,
        "user": user,
    }


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
    if _is_profile_public(profile) or (current_user_id and profile_user_id == str(current_user_id)):
        return url_for("public_profile", display_name=display_name)

    return None


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
    return collapsed_text[: max(limit - 1, 1)].rstrip() + "…"


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


def _build_dashboard_progress_data(climbs: list[dict], peaks_by_id: dict, total_peaks: int) -> dict:
    province_order = ("Munster", "Leinster", "Ulster", "Connacht")
    province_lookup = {province.lower(): province for province in province_order}
    province_counts = {province: 0 for province in province_order}
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
        for province_name in province_order
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


def _build_related_peaks(current_peak: dict, current_user_id: str | None) -> dict:
    all_peaks = get_all_peaks()
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
        peak_statuses = get_peak_statuses(
            current_user_id,
            [peak.get("id") for peak in related_peaks if peak.get("id") is not None],
        )
        related_peaks = _decorate_peaks_with_statuses(related_peaks, peak_statuses)
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
    peaks_by_id: dict[int, dict],
    limit: int = 4,
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
                "label": "Climbed",
                "peak_id": peak_id,
                "peak_name": (
                    climb.get("peak_name")
                    or peak.get("name")
                    or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak")
                ),
                "message": "You reached the summit!",
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
                "label": "Bucket List",
                "peak_id": peak_id,
                "peak_name": peak.get("name") or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak"),
                "message": "Added to your bucket list",
                "activity_time": activity_date,
                "relative_time": _relative_time(activity_date),
                "tag_class": "is-warning",
                "timestamp": _parse_datetime(activity_date) or fallback_date,
            }
        )

    return sorted(
        activity_items,
        key=lambda activity: activity.get("timestamp") or fallback_date,
        reverse=True,
    )[:limit]


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


@app.route("/")
def index():
    context = get_session_context()
    all_peaks = get_all_peaks()
    peaks_by_id = {peak.get("id"): peak for peak in all_peaks if peak.get("id") is not None}
    user_id = context["profile"].get("id") if context["profile"] else None
    peak_statuses = get_peak_statuses(
        user_id,
        [peak.get("id") for peak in all_peaks if peak.get("id") is not None],
    )
    map_peaks = _build_map_peaks(all_peaks, peak_statuses)
    landing_stats = _build_landing_stats(all_peaks)
    recent_climbs = _enrich_recent_climbs(
        get_community_recent_climbs(limit=4),
        peaks_by_id,
    )

    _set_active_page("index")
    return render_template(
        "index.html",
        peaks=map_peaks,
        landing_stats=landing_stats,
        peak_statuses=peak_statuses,
        recent_climbs=recent_climbs,
        status_tracking_enabled=bool(context["profile"]),
    )


@app.route("/signup", methods=["POST"])
def signup():
    if supabase is None:
        return _form_error_response("Account service is unavailable right now.", 500)

    display_name = (request.form.get("display_name") or "").strip()
    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    confirm_password = request.form.get("confirm_password") or ""
    field_errors = {}

    if not display_name:
        field_errors["display_name"] = "Full name is required."
    elif len(display_name) > 120:
        field_errors["display_name"] = "Full name must be 120 characters or fewer."

    if not email:
        field_errors["email"] = "Email is required."
    elif not _looks_like_email(email):
        field_errors["email"] = "Please enter a valid email address."

    if not password:
        field_errors["password"] = "Password is required."

    if not confirm_password:
        field_errors["confirm_password"] = "Please confirm your password."
    elif password and confirm_password != password:
        field_errors["confirm_password"] = "Passwords must match."

    if field_errors:
        return _form_error_response(
            next(iter(field_errors.values())),
            400,
            fields=field_errors,
        )

    try:
        result = supabase.auth.sign_up({"email": email, "password": password})
    except Exception as exc:
        error_message = str(exc)
        if _is_email_registered_error(error_message):
            return _form_error_response(
                "Email already registered",
                409,
                fields={"email": "Email already registered"},
            )
        if _is_display_name_conflict(error_message):
            return _form_error_response(
                "Signup failed: your email prefix conflicts with an existing display name. "
                "Try an email with a different prefix before '@'.",
                409,
                fields={"email": "Try an email with a different prefix before '@'."},
            )
        return _form_error_response("We could not create your account right now.", 400)

    if not result or not result.user:
        return _form_error_response("We could not create your account right now.", 400)

    session["user"] = result.user.model_dump()
    session["profile"] = _fetch_profile_for_session(result.user.id, result.user.email or email)
    return _form_success_response("/home")


# login

@app.route("/login", methods=["POST"])
def login():
    if supabase is None:
        return _form_error_response("Account service is unavailable right now.", 500)

    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    field_errors = {}

    if not email:
        field_errors["email"] = "Email is required."
    elif not _looks_like_email(email):
        field_errors["email"] = "Please enter a valid email address."

    if not password:
        field_errors["password"] = "Password is required."

    if field_errors:
        return _form_error_response(
            next(iter(field_errors.values())),
            400,
            fields=field_errors,
        )

    try:
        result = supabase.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as exc:
        error_message = str(exc)
        if _is_invalid_login_error(error_message):
            return _form_error_response(
                "Invalid email or password",
                401,
                fields={
                    "email": "Invalid email or password",
                    "password": "Invalid email or password",
                },
            )
        return _form_error_response("We could not log you in right now.", 401)

    if not result or not result.user:
        return _form_error_response(
            "Invalid email or password",
            401,
            fields={
                "email": "Invalid email or password",
                "password": "Invalid email or password",
            },
        )

    session["user"] = result.user.model_dump()
    session["profile"] = _fetch_profile_for_session(result.user.id, result.user.email or email)
    return _form_success_response("/home")


@app.route("/home")
def home():
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    user_id = context["profile"].get("id")
    all_peaks = get_all_peaks()
    peaks_by_id = {peak.get("id"): peak for peak in all_peaks if peak.get("id") is not None}
    total_peaks = app.config.get("TOTAL_PEAK_COUNT") or len(all_peaks)
    peak_statuses = get_peak_statuses(
        user_id,
        [peak.get("id") for peak in all_peaks if peak.get("id") is not None],
    )
    decorated_peaks = _decorate_peaks_with_statuses(all_peaks, peak_statuses)
    climbs = get_user_climbs(user_id)
    bucket_items = get_user_bucket_list(user_id)
    dashboard_recent_activity = _build_dashboard_activity_items(climbs, bucket_items, peaks_by_id)
    dashboard_peak_search_data = _build_dashboard_peak_search_data(decorated_peaks)

    suggested_peaks = sorted(
        [
            peak for peak in decorated_peaks
            if peak.get("user_status") != "climbed"
        ],
        key=lambda peak: (
            0 if peak.get("user_status") == "bucket_listed" else 1,
            _to_float(peak.get("height_rank")) if _to_float(peak.get("height_rank")) is not None else float("inf"),
            -(_to_float(peak.get("height_m") or peak.get("height")) or 0),
            str(peak.get("name") or ""),
        ),
    )[:3]
    bucket_list_peaks = [
        peak for peak in decorated_peaks
        if peak.get("user_status") == "bucket_listed"
    ][:4]
    dashboard_progress = _build_dashboard_progress_data(climbs, peaks_by_id, total_peaks)

    _set_active_page("dashboard")
    return render_template(
        "home.html",
        bucket_list_peaks=bucket_list_peaks,
        dashboard_peak_search_data=dashboard_peak_search_data,
        dashboard_progress=dashboard_progress,
        dashboard_recent_activity=dashboard_recent_activity,
        peak_statuses=peak_statuses,
        suggested_peaks=suggested_peaks,
    )


@app.route("/map")
def explore_map():
    context = get_session_context()
    all_peaks = get_all_peaks()
    user_id = context["profile"].get("id") if context["profile"] else None
    peak_ids = [peak.get("id") for peak in all_peaks if peak.get("id") is not None]
    peak_statuses = get_peak_statuses(user_id, peak_ids)
    map_peaks = _build_map_peaks(all_peaks, peak_statuses)
    height_unit = _current_height_unit_for_preference(context["profile"])

    _set_active_page("map")
    return render_template(
        "map.html",
        county_count=_count_distinct_values(map_peaks, "county"),
        height_filter_range=_build_height_filter_range(map_peaks, height_unit),
        height_unit=height_unit,
        peaks=map_peaks,
        province_count=_count_distinct_values(map_peaks, "province"),
        status_tracking_enabled=bool(context["profile"]),
    )


@app.route("/my-climbs")
def my_climbs():
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    user_id = context["profile"].get("id")
    view_mode = "map" if (request.args.get("view") or "").strip().lower() == "map" else "list"
    selected_year = (request.args.get("year") or "").strip()
    selected_month = (request.args.get("month") or "").strip()
    search_query = (request.args.get("q") or "").strip()

    all_climbs = _build_my_climb_entries(get_user_climb_history(user_id))
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

    total_peaks = int(app.config.get("TOTAL_PEAK_COUNT") or 0)
    my_climb_map = _build_my_climb_map_data(filtered_climbs, total_peaks)

    _set_active_page("my_climbs")
    return render_template(
        "my_climbs.html",
        available_years=available_years,
        climb_stats=_build_my_climb_stats(filtered_climbs),
        current_view=view_mode,
        month_options=month_options,
        my_climb_map=my_climb_map,
        my_climbs=filtered_climbs,
        search_query=search_query,
        selected_month=selected_month,
        selected_year=selected_year,
    )


@app.route("/my-bucket-list")
def my_bucket_list():
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    user_id = context["profile"].get("id")
    current_view = "map" if (request.args.get("view") or "").strip().lower() == "map" else "list"
    current_sort = (request.args.get("sort") or "date_added").strip().lower() or "date_added"
    sort_options = [
        {"value": "date_added", "label": "Date Added"},
        {"value": "height", "label": "Height"},
        {"value": "name", "label": "Name"},
        {"value": "county", "label": "County"},
    ]
    allowed_sorts = {option["value"] for option in sort_options}
    if current_sort not in allowed_sorts:
        current_sort = "date_added"

    all_peaks = get_all_peaks()
    peaks_by_id = {
        _peak_key(peak.get("id")): peak
        for peak in all_peaks
        if peak.get("id") is not None
    }
    bucket_items = get_user_bucket_list(user_id)
    peak_ids = [item.get("peak_id") for item in bucket_items if item.get("peak_id") is not None]
    peak_statuses = get_peak_statuses(user_id, peak_ids)
    bucket_entries = _sort_bucket_list_entries(
        _build_bucket_list_entries(bucket_items, peaks_by_id, peak_statuses),
        current_sort,
    )
    bucket_map = _build_bucket_list_map_data(bucket_entries)

    _set_active_page("my_bucket_list")
    return render_template(
        "my_bucket_list.html",
        bucket_count=len(bucket_entries),
        bucket_entries=bucket_entries,
        bucket_map=bucket_map,
        current_sort=current_sort,
        current_view=current_view,
        sort_options=sort_options,
    )


# get current user
@app.route("/current_user")
def current_user():
    if supabase is None:
        return "Supabase is not configured", 500

    user = supabase.auth.get_user()
    if user:
        return jsonify(user)
    else:
        return "No user is currently logged in."


# logout
@app.route("/logout")
def logout():
    if supabase is not None:
        try:
            supabase.auth.sign_out()
        except Exception as exc:
            app.logger.warning("Supabase sign out failed: %s", exc)
    session.pop("user", None)
    session.pop("profile", None)
    print("User logged out")
    return redirect("/")


@app.route("/summit-list")
def summit_list():
    context = get_session_context()
    peaks = get_all_peaks()
    user_id = context["profile"].get("id") if context["profile"] else None
    peak_statuses = get_peak_statuses(
        user_id,
        [peak.get("id") for peak in peaks if peak.get("id") is not None],
    )
    height_unit = _current_height_unit_for_preference(context["profile"])
    summit_peaks = _decorate_peaks_with_statuses(peaks, peak_statuses)

    _set_active_page("summits")
    return render_template(
        "summit_list.html",
        peaks=summit_peaks,
        action_buttons_visible=bool(context["profile"]),
        height_filter_range=_build_height_filter_range(summit_peaks, height_unit),
        height_unit=height_unit,
        peak_statuses=peak_statuses,
        status_column_visible=bool(context["profile"]),
    )


@app.route("/peak/<int:peak_id>")
def peak_detail(peak_id: int):
    context = get_session_context()
    peak = get_peak_by_id(peak_id)
    if peak is None:
        abort(404)

    user_id = context["profile"].get("id") if context["profile"] else None
    has_climbed = False
    is_bucket_listed = False
    user_climbs = []

    if user_id:
        has_climbed = get_user_has_climbed(user_id, peak_id) is not None
        is_bucket_listed = get_bucket_list_entry(user_id, peak_id) is not None
        user_climbs = _build_user_peak_climb_entries(get_user_peak_climbs(user_id, peak_id))

    peak_status = "climbed" if has_climbed else ("bucket_listed" if is_bucket_listed else "not_attempted")
    climber_rows = get_peak_climbers_with_profiles(peak_id, limit=None)
    climbers = _build_peak_climber_entries(climber_rows, user_id)
    comments = _build_peak_comment_entries(get_peak_comments_with_profiles(peak_id), user_id)
    avg_difficulty = get_peak_average_difficulty(peak_id)
    peak_latitude = _to_float(peak.get("latitude") or peak.get("lat"))
    peak_longitude = _to_float(peak.get("longitude") or peak.get("lon") or peak.get("lng"))
    total_climbers = len(climbers)
    related_peaks_data = _build_related_peaks(peak, user_id)

    _set_active_page("summit_list")
    return render_template(
        "peak_detail.html",
        peak={
            **peak,
            "latitude": peak_latitude,
            "longitude": peak_longitude,
            "user_status": peak_status,
        },
        avg_difficulty=avg_difficulty,
        climbers=climbers[:5],
        comments=comments,
        current_user_id=user_id,
        total_climbers=total_climbers,
        all_climbers=climbers,
        avg_difficulty_stars=_difficulty_star_count(avg_difficulty),
        has_climbed=has_climbed,
        is_bucket_listed=is_bucket_listed,
        peak_status=peak_status,
        related_peaks=related_peaks_data["peaks"],
        related_peaks_title=related_peaks_data["title"],
        user_climbs=user_climbs,
    )


@app.route("/profile/me")
def my_profile():
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    display_name = str(context["profile"].get("display_name") or "").strip()
    if not display_name:
        return redirect("/account")

    return redirect(url_for("public_profile", display_name=display_name))


@app.route("/profile/<display_name>")
def public_profile(display_name: str):
    context = get_session_context()
    profile_record = get_profile_by_display_name(display_name)
    if profile_record is None:
        abort(404)

    current_user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    is_owner = bool(current_user_id and str(profile_record.get("id") or "") == current_user_id)
    if not is_owner and not _is_profile_public(profile_record):
        abort(404)

    _set_active_page("profile")
    return render_template(
        "profile_public.html",
        public_profile=profile_record,
        is_profile_owner=is_owner,
    )


@app.route("/account")
def account_settings():
    """Account settings page - view and edit user profile"""
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    _set_active_page("account")
    return render_template("account_settings.html")


@app.errorhandler(404)
def handle_not_found(error):
    if _is_api_request():
        return _json_api_error(404, "Resource not found.")
    return _render_site_error("404.html", 404)


@app.errorhandler(403)
def handle_forbidden(error):
    if _is_api_request():
        return _json_api_error(403, "You do not have permission to access this resource.")
    return _render_site_error("403.html", 403)


@app.errorhandler(405)
def handle_method_not_allowed(error):
    if _is_api_request():
        return _json_api_error(405, "Method not allowed.")
    if isinstance(error, HTTPException):
        return error
    return _json_api_error(405, "Method not allowed.")


@app.errorhandler(500)
def handle_internal_error(error):
    if _is_api_request():
        return _json_api_error(500, "Internal server error.")
    app.logger.error("Unhandled application error: %s", error)
    return _render_site_error("500.html", 500)


if __name__ == "__main__":
    app.run(debug=True)
