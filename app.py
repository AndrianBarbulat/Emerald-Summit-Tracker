import re
from datetime import datetime, timezone

from flask import Flask, abort, jsonify, render_template, request, redirect, session, url_for
from werkzeug.exceptions import HTTPException

from api_routes import api
from supabase_utils import (
    get_all_peaks,
    get_peak_average_difficulty,
    get_community_recent_climbs,
    get_peak_by_id,
    get_peak_climbers_with_profiles,
    get_peak_comments_with_profiles,
    get_profile_by_display_name,
    get_user_climb_history,
    get_user_climbs,
    get_user_has_climbed,
    get_user_peak_climbs,
    get_peak_statuses,
    is_bucket_listed as get_bucket_list_entry,
    supabase,
)

app = Flask(__name__)
app.secret_key = "dev-secret-key"
app.register_blueprint(api)

FEET_PER_METER = 3.28084


def get_session_context() -> dict:
    return {
        "user": session.get("user"),
        "profile": session.get("profile"),
    }


def _is_api_request() -> bool:
    return request.path.startswith("/api/") or request.blueprint == "api"


def _json_api_error(status_code: int, message: str):
    return jsonify({"success": False, "ok": False, "error": message}), status_code


def _error_home_url() -> str:
    current_profile = session.get("profile")
    if isinstance(current_profile, dict) and current_profile.get("id"):
        return url_for("home")
    return url_for("index")


def _render_site_error(template_name: str, status_code: int):
    return render_template(
        template_name,
        home_url=_error_home_url(),
        active_page="error",
        **get_session_context(),
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
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("z", "+00:00").replace("Z", "+00:00"))
    except Exception:
        return None


def _relative_time(value: str) -> str:
    dt = _parse_datetime(value)
    if dt is None:
        return "recently"

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    delta = datetime.now(tz=timezone.utc) - dt
    total_seconds = int(delta.total_seconds())
    if total_seconds < 60:
        return "just now"
    if total_seconds < 3600:
        return f"{total_seconds // 60}m ago"
    if total_seconds < 86400:
        return f"{total_seconds // 3600}h ago"
    return f"{total_seconds // 86400}d ago"


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_short_date(value: str) -> str:
    dt = _parse_datetime(value)
    if dt is None:
        return "Recent climb"
    return dt.strftime("%d %b %Y")


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

    return {
        "total_climbs": len(climbs),
        "unique_peaks": len({climb.get("peak_id") for climb in climbs if climb.get("peak_id") is not None}),
        "total_elevation_m": total_elevation_m,
        "avg_difficulty": avg_difficulty,
        "avg_difficulty_stars": _difficulty_star_count(avg_difficulty),
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

        map_peaks.append(
            {
                "id": peak.get("id"),
                "name": peak.get("name"),
                "county": peak.get("county"),
                "province": peak.get("province"),
                "height_m": peak.get("height_m"),
                "latitude": lat,
                "longitude": lon,
                "user_status": _normalize_peak_status(peak_statuses.get(_peak_key(peak.get("id")))),
            }
        )
    return map_peaks


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
                "relative_time": _relative_time(climbed_at),
            }
        )
    return enriched


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

    return render_template(
        "index.html",
        peaks=map_peaks,
        landing_stats=landing_stats,
        peak_statuses=peak_statuses,
        recent_climbs=recent_climbs,
        status_tracking_enabled=bool(context["profile"]),
        active_page="index",
        **context,
    )


@app.route("/signup", methods=["POST"])
def signup():
    if supabase is None:
        return "Supabase is not configured", 500

    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    if not email or not password:
        return "Email and password are required", 400

    try:
        result = supabase.auth.sign_up({"email": email, "password": password})
    except Exception as exc:
        error_message = str(exc)
        if _is_display_name_conflict(error_message):
            return (
                "Signup failed: your email prefix conflicts with an existing display name. "
                "Try an email with a different prefix before '@'.",
                409,
            )
        return f"Signup failed: {exc}", 400

    if not result or not result.user:
        return "Signup failed", 400

    session["user"] = result.user.model_dump()
    session["profile"] = _fetch_profile_for_session(result.user.id, result.user.email or email)
    return redirect("/home")


# login

@app.route("/login", methods=["POST"])
def login():
    if supabase is None:
        return "Supabase is not configured", 500

    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    if not email or not password:
        return "Email and password are required", 400

    try:
        result = supabase.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as exc:
        return f"Login failed: {exc}", 401

    if not result or not result.user:
        return "Login failed", 401

    session["user"] = result.user.model_dump()
    session["profile"] = _fetch_profile_for_session(result.user.id, result.user.email or email)
    return redirect("/home")


@app.route("/home")
def home():
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    user_id = context["profile"].get("id")
    all_peaks = get_all_peaks()
    peaks_by_id = {peak.get("id"): peak for peak in all_peaks if peak.get("id") is not None}
    peak_statuses = get_peak_statuses(
        user_id,
        [peak.get("id") for peak in all_peaks if peak.get("id") is not None],
    )
    decorated_peaks = _decorate_peaks_with_statuses(all_peaks, peak_statuses)
    climbs = get_user_climbs(user_id)

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

    climbed_peaks = [
        peak for peak in decorated_peaks
        if peak.get("user_status") == "climbed"
    ]
    highest_climbed_peak = max(
        climbed_peaks,
        key=lambda peak: _to_float(peak.get("height_m") or peak.get("height")) or 0,
        default=None,
    )
    latest_climb_peak = peaks_by_id.get(climbs[0].get("peak_id")) if climbs else None
    total_peaks = len(all_peaks)
    completed_count = len(climbed_peaks)
    completion_percent = int(round((completed_count / total_peaks) * 100)) if total_peaks else 0

    dashboard_progress = {
        "completed_count": completed_count,
        "completion_percent": completion_percent,
        "highest_peak": highest_climbed_peak,
        "latest_peak": latest_climb_peak,
        "total_peaks": total_peaks,
    }

    return render_template(
        "home.html",
        active_page="dashboard",
        bucket_list_peaks=bucket_list_peaks,
        dashboard_progress=dashboard_progress,
        peak_statuses=peak_statuses,
        suggested_peaks=suggested_peaks,
        **context,
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

    return render_template(
        "my_climbs.html",
        active_page="my_climbs",
        available_years=available_years,
        climb_stats=_build_my_climb_stats(filtered_climbs),
        current_view=view_mode,
        month_options=month_options,
        my_climbs=filtered_climbs,
        search_query=search_query,
        selected_month=selected_month,
        selected_year=selected_year,
        **context,
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
    height_unit = "ft" if _prefers_imperial_units(context["profile"]) else "m"
    summit_peaks = _decorate_peaks_with_statuses(peaks, peak_statuses)

    return render_template(
        "summit_list.html",
        peaks=summit_peaks,
        action_buttons_visible=bool(context["profile"]),
        height_filter_range=_build_height_filter_range(summit_peaks, height_unit),
        height_unit=height_unit,
        peak_statuses=peak_statuses,
        status_column_visible=bool(context["profile"]),
        active_page="summits",
        **context,
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
        active_page="summit_list",
        **context,
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

    return render_template(
        "profile_public.html",
        public_profile=profile_record,
        is_profile_owner=is_owner,
        active_page="profile",
        **context,
    )


@app.route("/account")
def account_settings():
    """Account settings page - view and edit user profile"""
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    return render_template("account_settings.html", active_page="account", **context)


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
