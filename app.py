import re
from datetime import datetime, timezone

from flask import Flask, abort, jsonify, render_template, request, redirect, session

from api_routes import api
from supabase_utils import (
    get_all_peaks,
    get_peak_average_difficulty,
    get_community_recent_climbs,
    get_peak_by_id,
    get_peak_climbers_with_profiles,
    get_peak_comments_with_profiles,
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
        user_climbs = get_user_peak_climbs(user_id, peak_id)

    peak_status = "climbed" if has_climbed else ("bucket_listed" if is_bucket_listed else "not_attempted")
    climbers = get_peak_climbers_with_profiles(peak_id, limit=5)
    comments = get_peak_comments_with_profiles(peak_id)
    avg_difficulty = get_peak_average_difficulty(peak_id)

    return render_template(
        "peak_detail.html",
        peak={
            **peak,
            "user_status": peak_status,
        },
        avg_difficulty=avg_difficulty,
        climbers=climbers,
        comments=comments,
        has_climbed=has_climbed,
        is_bucket_listed=is_bucket_listed,
        peak_status=peak_status,
        user_climbs=user_climbs,
        active_page="summit_list",
        **context,
    )


@app.route("/account")
def account_settings():
    """Account settings page - view and edit user profile"""
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    return render_template("account_settings.html", active_page="account", **context)


if __name__ == "__main__":
    app.run(debug=True)
