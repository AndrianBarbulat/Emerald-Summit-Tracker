import re
from datetime import datetime, timezone

from flask import Flask, abort, jsonify, render_template, request, redirect, session

from api_routes import api_bp
from supabase_utils import (
    get_all_peaks,
    get_community_recent_climbs,
    get_peak_by_id,
    supabase,
)

app = Flask(__name__)
app.secret_key = "dev-secret-key"
app.register_blueprint(api_bp)


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


def _build_map_peaks(peaks: list[dict]) -> list[dict]:
    map_peaks = []
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
                "height_m": peak.get("height_m"),
                "latitude": lat,
                "longitude": lon,
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
    all_peaks = get_all_peaks()
    peaks_by_id = {peak.get("id"): peak for peak in all_peaks if peak.get("id") is not None}
    map_peaks = _build_map_peaks(all_peaks)
    landing_stats = _build_landing_stats(all_peaks)
    recent_climbs = _enrich_recent_climbs(
        get_community_recent_climbs(limit=4),
        peaks_by_id,
    )

    return render_template(
        "index.html",
        map_peaks=map_peaks,
        landing_stats=landing_stats,
        recent_climbs=recent_climbs,
        active_page="index",
        **get_session_context(),
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
    return render_template("home.html", active_page="dashboard", **context)


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
    if not context["profile"]:
        return redirect("/")

    peaks = get_all_peaks()
    return render_template("summit_list.html", peaks=peaks, active_page="summits", **context)


@app.route("/peak/<int:peak_id>")
def peak_detail(peak_id: int):
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    peak = get_peak_by_id(peak_id)
    if peak is None:
        abort(404)
    return render_template("peak_detail.html", peak=peak, active_page="summits", **context)


@app.route("/account")
def account_settings():
    """Account settings page - view and edit user profile"""
    context = get_session_context()
    if not context["profile"]:
        return redirect("/")

    return render_template("account_settings.html", active_page="account", **context)


if __name__ == "__main__":
    app.run(debug=True)
