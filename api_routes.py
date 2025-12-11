import json
import re
from datetime import date, datetime, timezone

from badges import check_badges, describe_new_badges
from flask import Blueprint, current_app, jsonify, request, session, url_for
from time_utils import format_display_date, format_time_ago, parse_datetime_value

from supabase_utils import (
    TABLE_BUCKET_LIST,
    TABLE_CLIMBS,
    TABLE_COMMENTS,
    TABLE_PROFILES,
    TABLE_USER_BADGES,
    add_comment,
    add_to_bucket_list,
    calculate_climb_streak,
    clear_shared_data_cache,
    delete_climb,
    delete_comment,
    extract_climb_photo_storage_paths,
    extract_profile_avatar_storage_path,
    delete_profile,
    get_all_peaks,
    get_climb_by_id,
    get_comment_by_id,
    get_peak_by_id,
    get_peak_statuses,
    get_profile_by_display_name,
    get_user_rank,
    get_user_bucket_list,
    get_user_climbs,
    get_user_has_climbed,
    get_user_profile,
    is_bucket_listed,
    log_climb,
    remove_from_bucket_list,
    supabase,
    sync_user_current_streak,
    upload_climb_photos,
    upload_profile_avatar,
    update_climb,
    update_user_profile,
    delete_climb_photo_uploads,
    delete_profile_avatar_upload,
)

api = Blueprint("api", __name__, url_prefix="/api")
api_bp = api

_UNSET = object()
ALLOWED_CLIMB_WEATHER = {
    "sunny",
    "cloudy",
    "overcast",
    "rainy",
    "windy",
    "snowy",
    "foggy",
    "mixed",
}
ALLOWED_DIFFICULTY_VALUES = {
    "1",
    "2",
    "3",
    "4",
    "5",
    "easy",
    "moderate",
    "hard",
}
PROFILE_PREVIEW_FIELDS = ("id", "display_name", "avatar_url", "bio", "location")
DISPLAY_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,30}$")
PROFILE_UPDATE_FIELDS = {
    "avatar_url",
    "display_name",
    "first_name",
    "last_name",
    "bio",
    "is_public",
    "location",
    "profile_visibility",
    "website",
    "unit_preference",
    "units",
    "measurement_system",
    "measurement_preference",
    "height_unit",
    "height_units",
    "distance_unit",
    "distance_units",
    "use_imperial_units",
}
PROFILE_SCALAR_TEXT_UPDATE_FIELDS = PROFILE_UPDATE_FIELDS - {
    "avatar_url",
    "is_public",
    "profile_visibility",
    "unit_preference",
}
LEADERBOARD_RANK_SESSION_KEY = "leaderboard_ranks"
LEADERBOARD_RANK_CATEGORIES = ("peaks", "elevation", "streaks")


@api.route("/health", methods=["GET"])
def api_health():
    return _json_success({"status": "ok"})


def _json_success(payload: dict | None = None, status: int = 200):
    data = {"success": True, "ok": True}
    if payload:
        data.update(payload)
    return jsonify(data), status


def _json_error(message: str, status: int = 400, fields: dict | None = None):
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
    ), status


def _get_current_user_id() -> str | None:
    profile = session.get("profile")
    if isinstance(profile, dict) and profile.get("id"):
        return str(profile["id"])

    user = session.get("user")
    if isinstance(user, dict) and user.get("id"):
        return str(user["id"])

    return None


def _get_current_user_email() -> str:
    user = session.get("user")
    if isinstance(user, dict) and user.get("email"):
        return str(user["email"]).strip().lower()

    profile = session.get("profile")
    if isinstance(profile, dict):
        for field_name in ("email", "email_address"):
            if profile.get(field_name):
                return str(profile[field_name]).strip().lower()

    return ""


def _sync_session_profile(user_id: str):
    refreshed_profile = get_user_profile(user_id)
    if refreshed_profile is not None:
        refreshed_profile = _serialize_profile_payload(refreshed_profile)
        session["profile"] = refreshed_profile
    return refreshed_profile


def _serialize_streak(streak_data: dict | None) -> dict:
    streak_data = streak_data or {}
    display_weeks = int(streak_data.get("display_weeks") or streak_data.get("current_streak") or 0)
    status = str(streak_data.get("status") or "inactive")
    last_climb_at = streak_data.get("last_climb_at")

    if status == "active":
        heading = f"Current streak: {display_weeks} week" if display_weeks == 1 else f"Current streak: {display_weeks} weeks"
        caption = "You have already logged a climb this week. Keep going."
    elif status == "at_risk":
        streak_label = f"{display_weeks} week" if display_weeks == 1 else f"{display_weeks} weeks"
        heading = f"Streak at risk! Climb this week to keep your {streak_label} alive."
        caption = f"Last climb {format_time_ago(last_climb_at)}." if last_climb_at else "Your last climb was last week."
    else:
        heading = "Current streak: 0 weeks"
        caption = "Log a climb this week to start a new streak."

    return {
        "caption": caption,
        "current_streak": display_weeks,
        "display_weeks": display_weeks,
        "heading": heading,
        "last_climb_at": last_climb_at,
        "status": status,
    }


def _get_request_data() -> dict:
    payload = request.get_json(silent=True)
    if isinstance(payload, dict):
        return payload
    if request.form:
        return request.form.to_dict()
    return {}


def _require_login():
    user_id = _get_current_user_id()
    if not user_id:
        return None, _json_error("You need to log in first.", 401)
    return user_id, None


def _normalize_leaderboard_rank(value) -> int | None:
    try:
        rank_value = int(value)
    except (TypeError, ValueError):
        return None
    return rank_value if rank_value > 0 else None


def _get_user_leaderboard_ranks(user_id: str) -> dict:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return {category: None for category in LEADERBOARD_RANK_CATEGORIES}

    return {
        category: _normalize_leaderboard_rank(get_user_rank(normalized_user_id, category))
        for category in LEADERBOARD_RANK_CATEGORIES
    }


def _store_session_leaderboard_ranks(ranks: dict | None) -> None:
    session[LEADERBOARD_RANK_SESSION_KEY] = {
        category: _normalize_leaderboard_rank((ranks or {}).get(category))
        for category in LEADERBOARD_RANK_CATEGORIES
    }


def _build_rank_improvement_payload(previous_ranks: dict | None, new_ranks: dict | None) -> dict:
    candidates = []
    for category_index, category in enumerate(LEADERBOARD_RANK_CATEGORIES):
        previous_rank = _normalize_leaderboard_rank((previous_ranks or {}).get(category))
        new_rank = _normalize_leaderboard_rank((new_ranks or {}).get(category))
        if new_rank is None:
            continue
        if previous_rank is not None and new_rank >= previous_rank:
            continue

        candidates.append(
            {
                "category": category,
                "new_rank": new_rank,
                "previous_rank": previous_rank,
                "score": (
                    1 if previous_rank is not None else 0,
                    (previous_rank - new_rank) if previous_rank is not None else 0,
                    -new_rank,
                    -category_index,
                ),
            }
        )

    if not candidates:
        return {}

    best_candidate = max(candidates, key=lambda candidate: candidate["score"])
    return {
        "new_rank": best_candidate["new_rank"],
        "previous_rank": best_candidate["previous_rank"],
        "rank_category": best_candidate["category"],
        "rank_improved": True,
    }


def _parse_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_peak_id(payload: dict) -> int | None:
    return _parse_int(payload.get("peak_id"))


def _strip_html_tags(value) -> str:
    raw_text = str(value or "")
    without_tags = re.sub(r"</?[A-Za-z][^>]*?>", "", raw_text)
    return without_tags.strip()


def _clean_text(value, max_length: int, allow_empty: bool = True, strip_html: bool = False):
    if value is _UNSET:
        return _UNSET
    cleaned = _strip_html_tags(value) if strip_html else str(value or "").strip()
    if not cleaned and not allow_empty:
        return None
    if len(cleaned) > max_length:
        return None
    return cleaned


def _normalize_profile_visibility(value) -> str | None:
    if isinstance(value, bool):
        return "public" if value else "private"

    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"public", "everyone", "all", "true", "1", "on", "yes"}:
        return "public"
    if normalized in {"private", "hidden", "off", "false", "0", "only me", "me"}:
        return "private"
    return None


def _normalize_unit_preference(value) -> str | None:
    if isinstance(value, bool):
        return "imperial" if value else "metric"

    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"imperial", "feet", "foot", "ft", "us", "true", "1", "yes", "on"}:
        return "imperial"
    if normalized in {"metric", "meters", "metres", "m", "false", "0", "no", "off"}:
        return "metric"
    return None


def _profile_unit_preference_value(profile: dict | None) -> str:
    if not isinstance(profile, dict):
        return "metric"

    candidate_values = [
        profile.get("unit_preference"),
        profile.get("units"),
        profile.get("measurement_system"),
        profile.get("measurement_preference"),
        profile.get("height_unit"),
        profile.get("height_units"),
        profile.get("use_imperial_units"),
    ]

    preferences = profile.get("preferences")
    if isinstance(preferences, dict):
        candidate_values.extend(
            [
                preferences.get("unit_preference"),
                preferences.get("units"),
                preferences.get("measurement_system"),
                preferences.get("measurement_preference"),
                preferences.get("height_unit"),
                preferences.get("height_units"),
                preferences.get("use_imperial_units"),
            ]
        )

    for value in candidate_values:
        normalized_unit = _normalize_unit_preference(value)
        if normalized_unit:
            return normalized_unit

    return "metric"


def _merge_profile_preference_updates(existing_profile: dict, updates: dict, preference_updates: dict) -> dict:
    if not preference_updates:
        return updates

    merged_updates = dict(updates)
    current_preferences = existing_profile.get("preferences")
    merged_preferences = dict(current_preferences) if isinstance(current_preferences, dict) else {}
    pending_preferences = merged_updates.get("preferences")
    if isinstance(pending_preferences, dict):
        merged_preferences.update(pending_preferences)
    merged_preferences.update(preference_updates)
    merged_updates["preferences"] = merged_preferences
    return merged_updates


def _prepare_profile_settings_updates(existing_profile: dict, updates: dict) -> dict:
    prepared_updates = dict(updates)
    preference_updates = {}

    if "profile_visibility" in prepared_updates:
        normalized_visibility = prepared_updates.pop("profile_visibility")
        visibility_fields = [
            field_name
            for field_name in ("profile_visibility", "public_profile", "is_public", "show_profile")
            if field_name in existing_profile
        ]
        if visibility_fields:
            for field_name in visibility_fields:
                prepared_updates[field_name] = (
                    normalized_visibility
                    if field_name == "profile_visibility"
                    else normalized_visibility == "public"
                )
        elif "preferences" in existing_profile:
            preference_updates["profile_visibility"] = normalized_visibility
        else:
            prepared_updates["profile_visibility"] = normalized_visibility

    if "unit_preference" in prepared_updates:
        normalized_unit = prepared_updates.pop("unit_preference")
        is_imperial = normalized_unit == "imperial"
        unit_fields = {
            field_name
            for field_name in (
                "unit_preference",
                "units",
                "measurement_system",
                "measurement_preference",
                "height_unit",
                "height_units",
                "use_imperial_units",
            )
            if field_name in existing_profile
        }

        if unit_fields:
            if "unit_preference" in unit_fields:
                prepared_updates["unit_preference"] = normalized_unit
            elif "measurement_system" in unit_fields:
                prepared_updates["measurement_system"] = normalized_unit
            elif "measurement_preference" in unit_fields:
                prepared_updates["measurement_preference"] = normalized_unit
            elif "units" in unit_fields:
                prepared_updates["units"] = normalized_unit

            if "height_unit" in unit_fields:
                prepared_updates["height_unit"] = "ft" if is_imperial else "m"
            if "height_units" in unit_fields:
                prepared_updates["height_units"] = "ft" if is_imperial else "m"
            if "use_imperial_units" in unit_fields:
                prepared_updates["use_imperial_units"] = is_imperial
        elif "preferences" in existing_profile:
            preference_updates["unit_preference"] = normalized_unit
        else:
            prepared_updates["unit_preference"] = normalized_unit

    return _merge_profile_preference_updates(existing_profile, prepared_updates, preference_updates)


def _extract_field(payload: dict, *names):
    for name in names:
        if name in payload:
            return payload.get(name)
    return _UNSET


def _normalize_date_value(raw_value, required: bool):
    if raw_value is _UNSET or raw_value is None or str(raw_value).strip() == "":
        if not required:
            return _UNSET, None
        return None, "Please choose a climb date."

    normalized = str(raw_value).strip()
    try:
        parsed_date = date.fromisoformat(normalized)
    except ValueError:
        return None, "Please choose a valid date."
    if parsed_date > date.today():
        return None, "Climb date cannot be in the future."
    return normalized, None


def _normalize_climb_fields(payload: dict, require_date: bool):
    normalized_date, date_error = _normalize_date_value(
        _extract_field(payload, "date_climbed", "climbed_at", "date"),
        required=require_date,
    )
    if date_error:
        return None, {"date_climbed": date_error}

    notes = _clean_text(_extract_field(payload, "notes"), 500, strip_html=True)
    if notes is None:
        return None, {"notes": "Notes must be 500 characters or fewer."}

    weather = _clean_text(_extract_field(payload, "weather"), 120)
    if weather is None:
        return None, {"weather": "Weather must be 120 characters or fewer."}
    if weather not in {_UNSET, ""}:
        weather = str(weather).strip().lower()
        if weather not in ALLOWED_CLIMB_WEATHER:
            return None, {"weather": "Please choose a valid weather option."}

    difficulty = _clean_text(_extract_field(payload, "difficulty_rating", "difficulty"), 40)
    if difficulty is None:
        return None, {"difficulty_rating": "Difficulty rating must be 1 to 5."}
    if difficulty not in {_UNSET, ""}:
        difficulty = str(difficulty).strip().lower()
        if difficulty.isdigit():
            difficulty_value = int(difficulty)
            if difficulty_value < 1 or difficulty_value > 5:
                return None, {"difficulty_rating": "Difficulty rating must be between 1 and 5."}
            difficulty = str(difficulty_value)
        else:
            return None, {"difficulty_rating": "Difficulty rating must be between 1 and 5."}

    return {
        "date_climbed": normalized_date,
        "notes": notes,
        "weather": weather,
        "difficulty_rating": difficulty,
    }, None


def _parse_datetime_value(value):
    return parse_datetime_value(value)


def _relative_time_label(value) -> str:
    return format_time_ago(value)


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


def _serialize_profile_payload(profile: dict | None) -> dict:
    serialized_profile = dict(profile or {})
    serialized_profile["is_public"] = _is_profile_public(serialized_profile)
    serialized_profile["profile_visibility"] = "public" if serialized_profile["is_public"] else "private"
    serialized_profile["unit_preference"] = _profile_unit_preference_value(serialized_profile)
    return serialized_profile


def _profile_url_for(profile: dict | None, current_user_id: str | None) -> str | None:
    if not isinstance(profile, dict):
        return None

    display_name = str(profile.get("display_name") or "").strip()
    if not display_name:
        return None

    profile_user_id = str(profile.get("id") or "").strip()
    if current_user_id and profile_user_id == current_user_id:
        return url_for("my_profile")

    return url_for("public_profile", display_name=display_name)


def _serialize_comment(comment: dict | None, current_user_id: str | None) -> dict:
    current_comment = dict(comment or {})
    profile = get_user_profile(current_user_id) or {} if current_user_id and str(current_comment.get("user_id") or "") == current_user_id else {}
    display_name = (
        current_comment.get("display_name")
        or profile.get("display_name")
        or (str(current_comment.get("user_id") or "")[:8] if current_comment.get("user_id") else "Climber")
    )
    created_at = current_comment.get("created_at") or datetime.now(tz=timezone.utc).isoformat()
    profile_record = {
        **profile,
        "id": profile.get("id") or current_comment.get("user_id"),
        "display_name": profile.get("display_name") or display_name,
    }
    return {
        **current_comment,
        "avatar_url": profile.get("avatar_url") or current_comment.get("avatar_url"),
        "comment_text": current_comment.get("comment_text") or current_comment.get("text") or "",
        "created_at": created_at,
        "display_name": display_name,
        "relative_time": _relative_time_label(created_at),
        "can_delete": bool(current_user_id and str(current_comment.get("user_id") or "") == current_user_id),
        "profile_url": _profile_url_for(profile_record, current_user_id),
    }


def _validate_climb_photo_uploads():
    max_photo_count = 3
    max_photo_size_bytes = 5 * 1024 * 1024
    uploaded_files = []

    if not request.files:
        return uploaded_files, None

    for uploaded_file in request.files.getlist("photos"):
        if not uploaded_file or not getattr(uploaded_file, "filename", ""):
            continue
        uploaded_files.append(uploaded_file)

    if len(uploaded_files) > max_photo_count:
        return None, "You can upload up to 3 photos."

    for uploaded_file in uploaded_files:
        if not str(uploaded_file.mimetype or "").lower().startswith("image/"):
            return None, "Please upload image files only."

        current_position = 0
        try:
            current_position = uploaded_file.stream.tell()
        except Exception:
            current_position = 0

        try:
            uploaded_file.stream.seek(0, 2)
            file_size = uploaded_file.stream.tell()
        except Exception:
            file_size = uploaded_file.content_length or 0
        finally:
            try:
                uploaded_file.stream.seek(current_position)
            except Exception:
                pass

        if file_size > max_photo_size_bytes:
            return None, "Each photo must be 5MB or smaller."

    return uploaded_files, None


def _variant_value_key(value):
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True)
    return value


def _build_climb_payload_variants(fields: dict) -> list[dict]:
    date_climbed = fields.get("date_climbed", _UNSET)
    notes = fields.get("notes", _UNSET)
    weather = fields.get("weather", _UNSET)
    difficulty_rating = fields.get("difficulty_rating", _UNSET)
    photo_urls = fields.get("photo_urls", _UNSET)

    variants = [
        {
            "date_climbed": date_climbed,
            "notes": notes,
            "weather": weather,
            "difficulty_rating": difficulty_rating,
            "photo_urls": photo_urls,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "weather": weather,
            "difficulty_rating": difficulty_rating,
            "photo_urls": photo_urls,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "weather": weather,
            "difficulty": difficulty_rating,
            "photo_urls": photo_urls,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "difficulty": difficulty_rating,
            "photo_urls": photo_urls,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "photo_urls": photo_urls,
        },
        {
            "date_climbed": date_climbed,
            "notes": notes,
            "photo_urls": photo_urls,
        },
        {
            "climbed_at": date_climbed,
            "photo_urls": photo_urls,
        },
        {
            "date_climbed": date_climbed,
            "photo_urls": photo_urls,
        },
    ]

    deduped_variants = []
    seen_variants = set()
    for variant in variants:
        compact_variant = {
            key: value
            for key, value in variant.items()
            if value is not _UNSET and (value != "" or key in {"notes", "weather"})
        }
        if not compact_variant:
            continue
        variant_key = tuple(
            (key, _variant_value_key(value))
            for key, value in sorted(compact_variant.items())
        )
        if variant_key in seen_variants:
            continue
        seen_variants.add(variant_key)
        deduped_variants.append(compact_variant)

    return deduped_variants


def _try_log_climb(user_id: str, peak_id: int, fields: dict):
    for payload in _build_climb_payload_variants(fields):
        climb = log_climb(user_id, peak_id, payload)
        if climb is not None:
            return climb, payload
        existing_climb = get_user_has_climbed(user_id, peak_id)
        if existing_climb is not None:
            return existing_climb, payload
    return None, None


def _try_update_climb(climb_id: int, user_id: str, fields: dict):
    for payload in _build_climb_payload_variants(fields):
        climb = update_climb(climb_id, user_id, payload)
        if climb is not None:
            return climb, payload
        existing_climb = get_climb_by_id(climb_id)
        if existing_climb is not None and str(existing_climb.get("user_id") or "") == user_id:
            return existing_climb, payload
    return None, None


def _current_user_status(user_id: str, peak_id: int) -> dict:
    peak_status = get_peak_statuses(user_id, [peak_id]).get(str(peak_id), "not_attempted")
    return {
        "is_climbed": peak_status == "climbed",
        "is_bucket_listed": peak_status == "bucket_listed",
        "user_status": peak_status,
    }


def _remove_bucket_list_entry_if_present(user_id: str, peak_id: int) -> bool:
    if is_bucket_listed(user_id, peak_id) is None:
        return False

    remove_from_bucket_list(user_id, peak_id)
    return is_bucket_listed(user_id, peak_id) is None


def _award_new_badges_for_user(user_id: str) -> list[dict]:
    new_badges = describe_new_badges(check_badges(user_id))
    display_name = str((session.get("profile") or {}).get("display_name") or "").strip()
    if not display_name:
        return new_badges

    for badge in new_badges:
        badge_key = str((badge or {}).get("key") or "").strip()
        if not badge_key:
            continue
        badge["share_url"] = url_for(
            "badge_share",
            badge_key=badge_key,
            display_name=display_name,
            _external=True,
        )
    return new_badges


def _augment_peaks_for_user(peaks: list[dict], user_id: str | None) -> list[dict]:
    if not user_id:
        return peaks

    peak_statuses = get_peak_statuses(
        user_id,
        [peak.get("id") for peak in peaks if peak.get("id") is not None],
    )

    augmented = []
    for peak in peaks:
        peak_key = str(peak.get("id") or "")
        user_status = peak_statuses.get(peak_key, "not_attempted")
        is_climbed = user_status == "climbed"
        is_bucket_listed = user_status == "bucket_listed"
        augmented.append(
            {
                **peak,
                "is_climbed": is_climbed,
                "is_bucket_listed": is_bucket_listed,
                "user_status": user_status,
            }
        )

    return augmented


def _delete_rows_for_user(table_name: str, user_id: str, column_name: str = "user_id") -> bool:
    if supabase is None:
        return False

    try:
        supabase.table(table_name).delete().eq(column_name, user_id).execute()
        return True
    except Exception:
        return False


def _log_account_cleanup_issue(user_id: str, message: str, exc: Exception | None = None) -> None:
    if exc is not None:
        current_app.logger.warning("Account cleanup issue for user %s: %s (%s)", user_id, message, exc)
        return
    current_app.logger.warning("Account cleanup issue for user %s: %s", user_id, message)


def _collect_account_photo_storage_paths(climbs: list[dict]) -> list[str]:
    storage_paths = []
    seen_paths = set()

    for climb in climbs:
        for storage_path in extract_climb_photo_storage_paths((climb or {}).get("photo_urls")):
            if not storage_path or storage_path in seen_paths:
                continue
            seen_paths.add(storage_path)
            storage_paths.append(storage_path)

    return storage_paths


def _best_effort_delete_profile_data(user_id: str) -> tuple[bool, list[str]]:
    warnings = []

    deleted_profile = delete_profile(user_id)
    if deleted_profile is not None or get_user_profile(user_id) is None:
        return True, warnings

    warnings.append("We could not remove the profile row cleanly, so fallback cleanup was used.")
    _log_account_cleanup_issue(user_id, warnings[-1])

    for table_name, column_name in (
        (TABLE_COMMENTS, "user_id"),
        (TABLE_BUCKET_LIST, "user_id"),
        (TABLE_CLIMBS, "user_id"),
        (TABLE_USER_BADGES, "user_id"),
    ):
        if _delete_rows_for_user(table_name, user_id, column_name):
            continue
        warning = f"We could not fully delete rows from {table_name}."
        warnings.append(warning)
        _log_account_cleanup_issue(user_id, warning)

    deleted_profile = delete_profile(user_id)
    if deleted_profile is not None or get_user_profile(user_id) is None:
        return True, warnings

    warning = "The profile record could not be deleted."
    warnings.append(warning)
    _log_account_cleanup_issue(user_id, warning)
    return False, warnings


@api.route("/log-climb", methods=["POST"])
def api_log_climb():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return _json_error("A valid peak id is required.", 400)

    if get_peak_by_id(peak_id) is None:
        return _json_error("That peak could not be found.", 400)

    fields, field_error = _normalize_climb_fields(payload, require_date=True)
    if field_error:
        return _json_error(
            next(iter(field_error.values()), "Please correct the highlighted fields."),
            400,
            fields=field_error,
        )

    existing_climb = get_user_has_climbed(user_id, peak_id)
    if existing_climb is not None:
        removed_from_bucket_list = _remove_bucket_list_entry_if_present(user_id, peak_id)
        streak = _serialize_streak(calculate_climb_streak(get_user_climbs(user_id)))
        _store_session_leaderboard_ranks(_get_user_leaderboard_ranks(user_id))
        return _json_success(
            {
                "already_climbed": True,
                "climb": existing_climb,
                "climb_id": existing_climb.get("id"),
                "new_badges": [],
                "photo_count_received": 0,
                "peak_id": peak_id,
                "removed_from_bucket_list": removed_from_bucket_list,
                "streak": streak,
                **_current_user_status(user_id, peak_id),
            }
        )

    uploaded_photos, photo_error = _validate_climb_photo_uploads()
    if photo_error:
        return _json_error(photo_error, 400, fields={"photos": photo_error})

    previous_leaderboard_ranks = _get_user_leaderboard_ranks(user_id)
    warning_messages = []
    uploaded_photo_urls = []
    uploaded_storage_paths = []
    if uploaded_photos:
        upload_result = upload_climb_photos(user_id, peak_id, uploaded_photos)
        uploaded_photo_urls = upload_result.get("photo_urls") or []
        uploaded_storage_paths = upload_result.get("storage_paths") or []
        if upload_result.get("error"):
            warning_messages.append(str(upload_result["error"]))
        elif uploaded_photo_urls:
            fields["photo_urls"] = uploaded_photo_urls

    created_climb, saved_payload = _try_log_climb(user_id, peak_id, fields)
    if created_climb is None and fields.get("photo_urls"):
        fallback_fields = dict(fields)
        fallback_fields.pop("photo_urls", None)
        created_climb, saved_payload = _try_log_climb(user_id, peak_id, fallback_fields)
        if created_climb is not None:
            delete_climb_photo_uploads(uploaded_storage_paths)
            warning_messages.append(
                "Your climb was saved, but the photo gallery could not be attached to this log."
            )

    if created_climb is None:
        return _json_error("We couldn't save that climb right now.", 500)

    removed_from_bucket_list = _remove_bucket_list_entry_if_present(user_id, peak_id)
    if removed_from_bucket_list:
        updated_bucket_completion_climb = update_climb(
            created_climb.get("id"),
            user_id,
            {"bucket_list_completion": True},
        )
        if updated_bucket_completion_climb is not None:
            created_climb = updated_bucket_completion_climb

    streak_data = sync_user_current_streak(user_id)
    clear_shared_data_cache()
    current_leaderboard_ranks = _get_user_leaderboard_ranks(user_id)
    _store_session_leaderboard_ranks(current_leaderboard_ranks)
    rank_improvement_payload = _build_rank_improvement_payload(
        previous_leaderboard_ranks,
        current_leaderboard_ranks,
    )
    if streak_data.get("profile") is not None:
        session["profile"] = streak_data["profile"]
    else:
        _sync_session_profile(user_id)
    success_payload = {
        "climb": created_climb,
        "climb_id": created_climb.get("id"),
        "new_badges": _award_new_badges_for_user(user_id),
        "photo_count_received": len(uploaded_photos or []),
        "photo_upload_count": len(created_climb.get("photo_urls") or []),
        "peak_id": peak_id,
        "removed_from_bucket_list": removed_from_bucket_list,
        "saved_fields": sorted(saved_payload.keys()) if saved_payload else [],
        "streak": _serialize_streak(streak_data),
        **_current_user_status(user_id, peak_id),
    }
    success_payload.update(rank_improvement_payload)
    if warning_messages:
        success_payload["warning"] = warning_messages[0]
        success_payload["warnings"] = warning_messages

    return _json_success(success_payload)


@api.route("/bucket-list/add", methods=["POST"])
def api_bucket_list_add():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return _json_error("A valid peak id is required.", 400)

    if get_peak_by_id(peak_id) is None:
        return _json_error("That peak could not be found.", 400)

    if is_bucket_listed(user_id, peak_id) is None:
        created_bucket_item = add_to_bucket_list(user_id, peak_id)
        if created_bucket_item is None and is_bucket_listed(user_id, peak_id) is None:
            return _json_error("We couldn't add that peak to your bucket list.", 500)

    clear_shared_data_cache()
    return _json_success(
        {
            "peak_id": peak_id,
            **_current_user_status(user_id, peak_id),
        }
    )


@api.route("/bucket-list/remove", methods=["POST"])
def api_bucket_list_remove():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return _json_error("A valid peak id is required.", 400)

    if get_peak_by_id(peak_id) is None:
        return _json_error("That peak could not be found.", 400)

    if is_bucket_listed(user_id, peak_id) is not None:
        remove_from_bucket_list(user_id, peak_id)
        if is_bucket_listed(user_id, peak_id) is not None:
            return _json_error("We couldn't update your bucket list right now.", 500)

    clear_shared_data_cache()
    return _json_success(
        {
            "peak_id": peak_id,
            **_current_user_status(user_id, peak_id),
        }
    )


@api.route("/peaks", methods=["GET"])
def api_peaks():
    province = (request.args.get("province") or "").strip() or None
    county = (request.args.get("county") or "").strip() or None
    sort_by = (request.args.get("sort_by") or "height_rank").strip() or "height_rank"
    search = (request.args.get("search") or request.args.get("q") or "").strip().lower()
    min_height = _parse_int(request.args.get("min_height"))
    max_height = _parse_int(request.args.get("max_height"))

    peaks = get_all_peaks(
        province=province,
        county=county,
        min_height=min_height,
        max_height=max_height,
        sort_by=sort_by,
    )
    if search:
        peaks = [
            peak for peak in peaks
            if search in str(peak.get("name") or "").lower()
        ]

    peaks = _augment_peaks_for_user(peaks, _get_current_user_id())
    return _json_success({"count": len(peaks), "peaks": peaks})


@api.route("/climb/<int:climb_id>", methods=["PUT", "DELETE"])
def api_climb(climb_id: int):
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    climb = get_climb_by_id(climb_id)
    if climb is None:
        return _json_error("That climb could not be found.", 400)

    if str(climb.get("user_id") or "") != user_id:
        return _json_error("You can only modify your own climbs.", 400)

    peak_id = _parse_int(climb.get("peak_id"))

    if request.method == "DELETE":
        photo_storage_paths = extract_climb_photo_storage_paths(climb.get("photo_urls"))
        deleted_climb = delete_climb(climb_id, user_id)
        if deleted_climb is None and get_climb_by_id(climb_id) is not None:
            return _json_error("We couldn't delete that climb right now.", 500)

        photos_deleted = delete_climb_photo_uploads(photo_storage_paths)
        streak_data = sync_user_current_streak(user_id)
        clear_shared_data_cache()
        current_leaderboard_ranks = _get_user_leaderboard_ranks(user_id)
        _store_session_leaderboard_ranks(current_leaderboard_ranks)
        if streak_data.get("profile") is not None:
            session["profile"] = streak_data["profile"]
        else:
            _sync_session_profile(user_id)
        payload = {
            "climb_id": climb_id,
            "deleted_photo_count": len(photo_storage_paths) if photos_deleted else 0,
            "streak": _serialize_streak(streak_data),
        }
        if photo_storage_paths and not photos_deleted:
            payload["warning"] = "Climb removed, but we couldn't delete one or more uploaded photos."

        if peak_id is not None:
            payload.update(
                {
                    "peak_id": peak_id,
                    **_current_user_status(user_id, peak_id),
                }
            )
        return _json_success(payload)

    payload = _get_request_data()
    fields, field_error = _normalize_climb_fields(payload, require_date=False)
    if field_error:
        return _json_error(
            next(iter(field_error.values()), "Please correct the highlighted fields."),
            400,
            fields=field_error,
        )

    if all(value is _UNSET for value in fields.values()):
        return _json_error("Provide at least one climb field to update.", 400)

    previous_leaderboard_ranks = _get_user_leaderboard_ranks(user_id)
    updated_climb, saved_payload = _try_update_climb(climb_id, user_id, fields)
    if updated_climb is None:
        return _json_error("We couldn't update that climb right now.", 500)

    streak_data = sync_user_current_streak(user_id)
    clear_shared_data_cache()
    current_leaderboard_ranks = _get_user_leaderboard_ranks(user_id)
    _store_session_leaderboard_ranks(current_leaderboard_ranks)
    rank_improvement_payload = _build_rank_improvement_payload(
        previous_leaderboard_ranks,
        current_leaderboard_ranks,
    )
    if streak_data.get("profile") is not None:
        session["profile"] = streak_data["profile"]
    else:
        _sync_session_profile(user_id)

    return _json_success(
        {
            "climb": updated_climb,
            "climb_id": updated_climb.get("id", climb_id),
            "peak_id": peak_id,
            **rank_improvement_payload,
            "saved_fields": sorted(saved_payload.keys()) if saved_payload else [],
            "streak": _serialize_streak(streak_data),
            **(_current_user_status(user_id, peak_id) if peak_id is not None else {}),
        }
    )


@api.route("/peak-comment", methods=["POST"])
def api_peak_comment_create():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return _json_error("A valid peak id is required.", 400)

    if get_peak_by_id(peak_id) is None:
        return _json_error("That peak could not be found.", 400)

    comment_text = _clean_text(
        _extract_field(payload, "comment_text", "text"),
        2000,
        allow_empty=False,
        strip_html=True,
    )
    if comment_text is None:
        return _json_error(
            "Comment text is required and must be 2000 characters or fewer.",
            400,
            fields={"comment_text": "Comment text is required and must be 2000 characters or fewer."},
        )

    comment = add_comment(user_id, peak_id, comment_text)
    if comment is None:
        return _json_error("We couldn't post that comment right now.", 500)

    return _json_success(
        {
            "comment": _serialize_comment(comment, user_id),
            "comment_id": comment.get("id"),
        }
    )


@api.route("/peak-comment/<int:comment_id>/delete", methods=["POST"])
def api_peak_comment_delete(comment_id: int):
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    comment = get_comment_by_id(comment_id)
    if comment is None:
        return _json_error("That comment could not be found.", 400)

    if str(comment.get("user_id") or "") != user_id:
        return _json_error("You can only delete your own comments.", 400)

    deleted_comment = delete_comment(comment_id, user_id)
    if deleted_comment is None and get_comment_by_id(comment_id) is not None:
        return _json_error("We couldn't delete that comment right now.", 500)

    return _json_success({"comment_id": comment_id})


@api.route("/profile/update", methods=["POST"])
def api_profile_update():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    payload = _get_request_data()
    avatar_file = request.files.get("avatar")
    updates = {}
    for field_name in PROFILE_SCALAR_TEXT_UPDATE_FIELDS:
        if field_name not in payload:
            continue
        max_length = 500 if field_name == "bio" else 200
        cleaned_value = _clean_text(
            payload.get(field_name),
            max_length,
            strip_html=field_name in {"bio", "location", "website"},
        )
        if cleaned_value is None:
            return _json_error(f"{field_name.replace('_', ' ').title()} is too long.", 400)
        updates[field_name] = cleaned_value

    raw_avatar_url = _extract_field(payload, "avatar_url")
    if raw_avatar_url is not _UNSET:
        cleaned_avatar_url = _clean_text(raw_avatar_url, 2000)
        if cleaned_avatar_url is None:
            return _json_error(
                "Avatar URL is too long.",
                400,
                fields={"avatar_url": "Avatar URL must be 2000 characters or fewer."},
            )
        updates["avatar_url"] = cleaned_avatar_url

    raw_visibility = _extract_field(payload, "profile_visibility", "is_public")
    if raw_visibility is not _UNSET:
        normalized_visibility = _normalize_profile_visibility(raw_visibility)
        if normalized_visibility is None:
            return _json_error(
                "Choose whether your profile should be public or private.",
                400,
                fields={
                    "is_public": "Choose public or private visibility.",
                    "profile_visibility": "Choose public or private visibility.",
                },
            )
        updates["profile_visibility"] = normalized_visibility

    raw_unit_preference = _extract_field(payload, "unit_preference")
    if raw_unit_preference is not _UNSET:
        normalized_unit_preference = _normalize_unit_preference(raw_unit_preference)
        if normalized_unit_preference is None:
            return _json_error(
                "Choose either metric or imperial units.",
                400,
                fields={"unit_preference": "Choose either metric or imperial units."},
            )
        updates["unit_preference"] = normalized_unit_preference

    if "preferences" in payload and isinstance(payload.get("preferences"), dict):
        updates["preferences"] = payload.get("preferences")

    if not updates and avatar_file is None:
        return _json_error("No supported profile fields were provided.", 400)

    display_name = updates.get("display_name")
    if "display_name" in updates:
        if not display_name:
            return _json_error("Display name is required.", 400, fields={"display_name": "Display name is required."})
        if not DISPLAY_NAME_PATTERN.match(display_name):
            return _json_error(
                "Display name must be 3-30 characters and use only letters, numbers, or underscores.",
                400,
                fields={"display_name": "Use 3-30 letters, numbers, or underscores."},
            )
        existing_profile = get_profile_by_display_name(display_name)
        if existing_profile and str(existing_profile.get("id") or "") != user_id:
            return _json_error("That display name is already taken.", 400, fields={"display_name": "That display name is already taken."})

    if "bio" in updates and len(str(updates.get("bio") or "")) > 500:
        return _json_error("Bio must be 500 characters or fewer.", 400, fields={"bio": "Bio must be 500 characters or fewer."})

    existing_profile = get_user_profile(user_id) or {}
    updates = _prepare_profile_settings_updates(existing_profile, updates)
    uploaded_avatar_path = None
    if avatar_file is not None and str(getattr(avatar_file, "filename", "") or "").strip():
        upload_result = upload_profile_avatar(
            user_id,
            avatar_file,
            existing_avatar_url=existing_profile.get("avatar_url"),
        )
        if upload_result.get("error"):
            return _json_error(
                str(upload_result["error"]),
                400,
                fields={"avatar": str(upload_result["error"])},
            )
        uploaded_avatar_path = upload_result.get("storage_path")
        updates["avatar_url"] = upload_result.get("avatar_url")

    updated_profile = update_user_profile(user_id, updates)
    if updated_profile is None:
        refreshed_profile = get_user_profile(user_id)
        profile_matches_updates = bool(refreshed_profile) and all(
            refreshed_profile.get(field_name) == field_value
            for field_name, field_value in updates.items()
        )
        updated_profile = refreshed_profile if profile_matches_updates else None

    if updated_profile is None:
        if uploaded_avatar_path:
            delete_profile_avatar_upload(uploaded_avatar_path)
        return _json_error("We couldn't update your profile right now.", 500)

    updated_profile = _serialize_profile_payload(updated_profile)
    session["profile"] = updated_profile
    return _json_success({"profile": updated_profile})


@api.route("/profile/preview/<display_name>", methods=["GET"])
def api_profile_preview(display_name: str):
    cleaned_name = str(display_name or "").strip()
    if not cleaned_name:
        return _json_error("A display name is required.", 400)

    profile = get_profile_by_display_name(cleaned_name)
    if profile is None:
        return _json_error("That profile could not be found.", 400)

    if not _is_profile_public(profile):
        return _json_error("Profile preview is unavailable.", 400)

    climbs = get_user_climbs(str(profile.get("id") or ""))
    unique_peak_ids = {
        str(climb.get("peak_id")).strip()
        for climb in climbs
        if climb.get("peak_id") is not None and str(climb.get("peak_id")).strip()
    }
    member_since_raw = (
        profile.get("created_at")
        or profile.get("inserted_at")
        or profile.get("updated_at")
    )
    preview = {
        "display_name": str(profile.get("display_name") or cleaned_name).strip() or cleaned_name,
        "avatar_url": profile.get("avatar_url"),
        "location": profile.get("location") or "",
        "peaks_climbed_count": len(unique_peak_ids),
        "member_since": format_display_date(member_since_raw, fallback="Recently") if member_since_raw else "Recently",
    }

    return _json_success(preview)


@api.route("/account/password-reset", methods=["POST"])
def api_account_password_reset():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    user_email = _get_current_user_email()
    if not user_email:
        return _json_error("We could not find an email address for this account.", 400)

    if supabase is None or not hasattr(supabase, "auth"):
        return _json_error("Password reset is not available right now.", 500)

    try:
        reset_method = getattr(supabase.auth, "reset_password_for_email", None) or getattr(supabase.auth, "reset_password_email", None)
        if reset_method is None:
            return _json_error("Password reset is not available right now.", 500)
        reset_method(user_email)
    except Exception as exc:
        current_app.logger.warning("Password reset email failed for user %s: %s", user_id, exc)
        return _json_error("We couldn't send a password reset email right now.", 500)

    return _json_success(
        {
            "email": user_email,
            "message": f"We've sent a password reset email to {user_email}.",
        }
    )


@api.route("/account/delete", methods=["POST"])
def api_account_delete():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    payload = _get_request_data()
    confirmation_value = str(payload.get("confirm") or "").strip()
    if confirmation_value != "DELETE":
        return _json_error(
            "Type DELETE to confirm account deletion.",
            400,
            fields={"confirm": "Type DELETE to confirm account deletion."},
        )

    if supabase is None or not hasattr(supabase, "auth") or not hasattr(supabase.auth, "admin"):
        return _json_error("Account deletion is not available right now.", 500)

    current_profile = get_user_profile(user_id) or (session.get("profile") if isinstance(session.get("profile"), dict) else {})
    user_climbs = get_user_climbs(user_id)
    warnings = []

    photo_storage_paths = _collect_account_photo_storage_paths(user_climbs)
    if photo_storage_paths and not delete_climb_photo_uploads(photo_storage_paths):
        warning = "One or more climb photos could not be deleted from storage."
        warnings.append(warning)
        _log_account_cleanup_issue(user_id, warning)

    avatar_storage_path = extract_profile_avatar_storage_path((current_profile or {}).get("avatar_url"))
    if avatar_storage_path and not delete_profile_avatar_upload(avatar_storage_path):
        warning = "Your avatar file could not be deleted from storage."
        warnings.append(warning)
        _log_account_cleanup_issue(user_id, warning)

    profile_deleted, profile_warnings = _best_effort_delete_profile_data(user_id)
    warnings.extend(profile_warnings)

    auth_deleted = False
    try:
        supabase.auth.admin.delete_user(user_id)
        auth_deleted = True
    except Exception as exc:
        warning = "Your authentication account could not be fully deleted."
        warnings.append(warning)
        _log_account_cleanup_issue(user_id, warning, exc)

    if not profile_deleted and not auth_deleted:
        return _json_error("We couldn't delete your account right now.", 500)

    try:
        sign_out_method = getattr(supabase.auth, "sign_out", None)
        if callable(sign_out_method):
            sign_out_method()
    except Exception as exc:
        _log_account_cleanup_issue(user_id, "The active session could not be signed out cleanly.", exc)

    clear_shared_data_cache()
    session.clear()

    return _json_success(
        {
            "deleted": True,
            "partial_failure": bool(warnings),
            "redirect": url_for("index"),
            "redirect_url": url_for("index"),
            "warnings": warnings,
        }
    )
