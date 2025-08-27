import re
from datetime import datetime, timezone

from flask import Flask, abort, jsonify, render_template, request, redirect, session

from api_routes import api_bp
from supabase_utils import (
    create_user_profile,
    get_all_peaks,
    get_community_recent_climbs,
    get_peak_by_id,
    get_profile_by_display_name,
    get_user_profile,
    supabase,
)

app = Flask(__name__)
app.secret_key = "dev-secret-key"
app.register_blueprint(api_bp)


def _sanitize_display_name(base_name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", (base_name or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_").lower()
    return cleaned or "climber"


def _next_unique_display_name(base_name: str) -> str:
    candidate = _sanitize_display_name(base_name)
    if get_profile_by_display_name(candidate) is None:
        return candidate

    for suffix in range(1, 200):
        candidate_with_suffix = f"{candidate}{suffix}"
        if get_profile_by_display_name(candidate_with_suffix) is None:
            return candidate_with_suffix

    timestamp_suffix = int(datetime.now(tz=timezone.utc).timestamp())
    return f"{candidate}_{timestamp_suffix}"


def _ensure_profile(user_id: str, email: str) -> dict:
    profile = get_user_profile(user_id)
    if profile:
        return profile

    display_base = (email or "").split("@")[0]
    unique_display_name = _next_unique_display_name(display_base)
    profile = create_user_profile(
        user_id,
        {
            "email": email,
            "display_name": unique_display_name,
        },
    )
    if profile:
        return profile

    return (
        get_user_profile(user_id)
        or {"user_id": user_id, "email": email, "display_name": unique_display_name}
    )


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
    recent_climbs = _enrich_recent_climbs(
        get_community_recent_climbs(limit=4),
        peaks_by_id,
    )

    return render_template(
        "index.html",
        map_peaks=map_peaks,
        recent_climbs=recent_climbs,
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
        return f"Signup failed: {error_message}", 400

    if not result or not result.user:
        return "Signup failed", 400

    session["user"] = result.user.model_dump()
    session["profile"] = _ensure_profile(result.user.id, email)
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
    session["profile"] = _ensure_profile(result.user.id, email)
    return redirect("/home")


@app.route("/home")
def home():
    profile = session.get("profile")
    if profile:
        return render_template("home.html", profile=profile)

    user = session.get("user")
    if user and user.get("id"):
        profile = get_user_profile(user["id"])
        if profile:
            session["profile"] = profile
            return render_template("home.html", profile=profile)

    return redirect("/")


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
        supabase.auth.sign_out()
    print("User logged out")
    return redirect("/")


@app.route("/summit-list")
def summit_list():
    if not session.get("user"):
        return redirect("/")

    peaks = get_all_peaks()
    return render_template("summit_list.html", profile=session.get("profile"), peaks=peaks)


@app.route("/peak/<int:peak_id>")
def peak_detail(peak_id: int):
    peak = get_peak_by_id(peak_id)
    if peak is None:
        abort(404)
    return render_template("peak_detail.html", profile=session.get("profile"), peak=peak)


@app.route("/account")
def account_settings():
    """Account settings page - view and edit user profile"""
    user = session.get("user")
    if not user:
        return redirect("/")

    return render_template("account_settings.html", user=user)


if __name__ == "__main__":
    app.run(debug=True)
