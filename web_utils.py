from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from flask import g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.exceptions import HTTPException

from badges import COUNTY_PEAK_COUNTS, configure_county_badges
from supabase_utils import get_all_peaks, get_county_peak_counts, get_peak_count, get_user_badges
from time_utils import format_display_date, format_time_ago, parse_datetime_value


FEET_PER_METER = 3.28084
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
BADGE_NOTIFICATION_SEEN_SESSION_KEY = "badge_notifications_last_seen_at"
RECENTLY_VIEWED_SESSION_KEY = "recently_viewed_peaks"
RECENTLY_VIEWED_LIMIT = 3
PROVINCE_ORDER = ("Munster", "Leinster", "Ulster", "Connacht")


def get_session_context() -> dict:
    return {
        "user": session.get("user"),
        "profile": session.get("profile"),
    }


def prime_total_peak_count_cache(app) -> None:
    cached_count = get_peak_count()
    if cached_count is None:
        cached_count = len(get_all_peaks())
    app.config["TOTAL_PEAK_COUNT"] = max(int(cached_count or 0), 0)


def prime_county_peak_count_cache(app) -> None:
    county_peak_counts = get_county_peak_counts()
    configure_county_badges(county_peak_counts)
    app.config["COUNTY_PEAK_COUNTS"] = dict(COUNTY_PEAK_COUNTS)


def set_active_page(page_name: str | None) -> None:
    g.active_page = page_name or ""


def badge_earned_at_value(badge: dict | None) -> str:
    if not isinstance(badge, dict):
        return ""
    return str(
        badge.get("earned_at")
        or badge.get("created_at")
        or badge.get("awarded_at")
        or badge.get("inserted_at")
        or badge.get("updated_at")
        or ""
    ).strip()


def mark_badge_notifications_seen() -> None:
    session[BADGE_NOTIFICATION_SEEN_SESSION_KEY] = datetime.now(tz=timezone.utc).isoformat()


def get_badge_notification_state(profile: dict | None) -> dict:
    if not isinstance(profile, dict):
        return {
            "has_unseen_badge_notifications": False,
            "unseen_badge_notification_count": 0,
        }

    user_id = str(profile.get("id") or "").strip()
    if not user_id:
        return {
            "has_unseen_badge_notifications": False,
            "unseen_badge_notification_count": 0,
        }

    last_seen_at = session.get(BADGE_NOTIFICATION_SEEN_SESSION_KEY)
    last_seen_dt = parse_datetime_value(last_seen_at)
    unseen_count = 0

    for badge in get_user_badges(user_id):
        earned_at = badge_earned_at_value(badge)
        earned_dt = parse_datetime_value(earned_at)
        if earned_dt is None:
            continue
        if last_seen_dt is None or earned_dt > last_seen_dt:
            unseen_count += 1

    return {
        "has_unseen_badge_notifications": unseen_count > 0,
        "unseen_badge_notification_count": unseen_count,
    }


def is_api_request() -> bool:
    return request.path.startswith("/api/") or request.blueprint == "api"


def json_api_error(status_code: int, message: str):
    return jsonify({"success": False, "ok": False, "error": True, "message": message, "fields": {}}), status_code


def request_wants_json() -> bool:
    accept_header = str(request.headers.get("Accept") or "").lower()
    requested_with = str(request.headers.get("X-Requested-With") or "").lower()
    return request.is_json or "application/json" in accept_header or requested_with == "xmlhttprequest"


def form_json_error(message: str, status_code: int = 400, fields: dict | None = None):
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


def form_error_response(message: str, status_code: int = 400, fields: dict | None = None):
    if request_wants_json():
        return form_json_error(message, status_code, fields=fields)
    return message, status_code


def form_success_response(redirect_url: str):
    if request_wants_json():
        return jsonify({"success": True, "ok": True, "redirect_to": redirect_url}), 200
    return redirect(redirect_url)


def looks_like_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.fullmatch(str(value or "").strip()))


def is_email_registered_error(error_message: str) -> bool:
    normalized_message = str(error_message or "").strip().lower()
    return "already registered" in normalized_message or "user already exists" in normalized_message


def is_invalid_login_error(error_message: str) -> bool:
    normalized_message = str(error_message or "").strip().lower()
    return "invalid login credentials" in normalized_message or "invalid email or password" in normalized_message


def error_home_url() -> str:
    current_profile = session.get("profile")
    if isinstance(current_profile, dict) and current_profile.get("id"):
        return url_for("home")
    return url_for("index")


def render_site_error(template_name: str, status_code: int):
    set_active_page("error")
    return render_template(
        template_name,
        home_url=error_home_url(),
    ), status_code


def parse_datetime(value: str):
    return parse_datetime_value(value)


def relative_time(value: str) -> str:
    return format_time_ago(value)


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def format_short_date(value: str) -> str:
    return format_display_date(value, fallback="Recent climb")


def pluralize_weeks(value: int) -> str:
    weeks = max(int(value or 0), 0)
    return f"{weeks} week" if weeks == 1 else f"{weeks} weeks"


def prefers_imperial_units(profile: dict | None) -> bool:
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


def current_height_unit_for_preference(unit_preference=None) -> str:
    if isinstance(unit_preference, str):
        normalized = unit_preference.strip().lower()
        if normalized in {"imperial", "feet", "foot", "ft"}:
            return "ft"
        if normalized in {"metric", "meters", "metres", "m"}:
            return "m"

    if prefers_imperial_units(unit_preference):
        return "ft"

    return "m"


def height_display_value(height_m, unit_preference=None, height_ft=None):
    preferred_unit = current_height_unit_for_preference(unit_preference)
    metric_value = to_float(height_m)
    imperial_value = to_float(height_ft)

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


def count_distinct_values(items: list[dict], field_name: str) -> int:
    values = set()
    for item in items:
        raw_value = item.get(field_name)
        if raw_value is None:
            continue

        normalized = str(raw_value).strip().lower()
        if normalized:
            values.add(normalized)

    return len(values)


def build_height_filter_range(peaks: list[dict], unit: str) -> dict[str, int | None]:
    heights_m = [
        to_float(peak.get("height_m") or peak.get("height"))
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


def register_template_filters(app) -> None:
    @app.template_filter("timeago")
    def timeago_filter(value) -> str:
        return format_time_ago(value)

    @app.template_filter("display_date")
    def display_date_filter(value) -> str:
        return format_display_date(value, fallback="Recently")

    @app.template_filter("format_height")
    def format_height_filter(height_m, unit_preference=None, height_ft=None) -> str:
        value, unit = height_display_value(height_m, unit_preference, height_ft)
        if value is None:
            return "-"
        return f"{value}{unit}"


def register_context_processors(app) -> None:
    @app.context_processor
    def inject_common_data() -> dict:
        profile = session.get("profile")
        user = session.get("user")
        unit_preference = "imperial" if prefers_imperial_units(profile) else "metric"
        badge_notification_state = get_badge_notification_state(profile)

        return {
            "active_page": getattr(g, "active_page", ""),
            **badge_notification_state,
            "current_height_unit": "ft" if unit_preference == "imperial" else "m",
            "profile": profile,
            "total_peak_count": int(app.config.get("TOTAL_PEAK_COUNT") or 0),
            "unit_preference": unit_preference,
            "user": user,
        }


def register_error_handlers(app) -> None:
    @app.errorhandler(404)
    def handle_not_found(error):
        if is_api_request():
            return json_api_error(404, "Resource not found.")
        return render_site_error("404.html", 404)

    @app.errorhandler(403)
    def handle_forbidden(error):
        if is_api_request():
            return json_api_error(403, "You do not have permission to access this resource.")
        return render_site_error("403.html", 403)

    @app.errorhandler(405)
    def handle_method_not_allowed(error):
        if is_api_request():
            return json_api_error(405, "Method not allowed.")
        if isinstance(error, HTTPException):
            return error
        return json_api_error(405, "Method not allowed.")

    @app.errorhandler(500)
    def handle_internal_error(error):
        if is_api_request():
            return json_api_error(500, "Internal server error.")
        app.logger.error("Unhandled application error: %s", error)
        return render_site_error("500.html", 500)


def register_blueprint_with_legacy_endpoints(app, blueprint) -> None:
    app.register_blueprint(blueprint)
    blueprint_prefix = f"{blueprint.name}."

    for rule in list(app.url_map.iter_rules()):
        endpoint = str(rule.endpoint or "")
        if not endpoint.startswith(blueprint_prefix):
            continue

        alias_endpoint = endpoint.split(".", 1)[1]
        if not alias_endpoint or alias_endpoint in app.view_functions:
            continue

        view_func = app.view_functions.get(endpoint)
        if view_func is None:
            continue

        app.add_url_rule(
            rule.rule,
            endpoint=alias_endpoint,
            view_func=view_func,
            defaults=rule.defaults,
            methods=sorted(rule.methods or []),
            provide_automatic_options=False,
        )
