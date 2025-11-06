import json
import re
from datetime import date, datetime, timezone

from flask import Blueprint, jsonify, request, session, url_for
from time_utils import format_time_ago, parse_datetime_value

from supabase_utils import (
    TABLE_BUCKET_LIST,
    TABLE_CLIMBS,
    TABLE_COMMENTS,
    TABLE_PROFILES,
    TABLE_USER_BADGES,
    add_comment,
    add_to_bucket_list,
    award_badge,
    calculate_climb_streak,
    delete_climb,
    delete_comment,
    extract_climb_photo_storage_paths,
    delete_profile,
    get_all_peaks,
    get_climb_by_id,
    get_comment_by_id,
    get_peak_by_id,
    get_peak_statuses,
    get_profile_by_display_name,
    get_user_badges,
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
    update_climb,
    update_user_profile,
    delete_climb_photo_uploads,
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
BADGE_RULES = [
    {"key": "first_climb", "label": "First Climb", "threshold": 1},
    {"key": "five_climbs", "label": "Five Summits", "threshold": 5},
    {"key": "ten_climbs", "label": "Ten Summits", "threshold": 10},
]
PROFILE_PREVIEW_FIELDS = ("id", "display_name", "avatar_url", "bio", "location")
PROFILE_UPDATE_FIELDS = {
    "display_name",
    "first_name",
    "last_name",
    "bio",
    "location",
    "website",
    "avatar_url",
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


def _sync_session_profile(user_id: str):
    refreshed_profile = get_user_profile(user_id)
    if refreshed_profile is not None:
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


def _profile_url_for(profile: dict | None, current_user_id: str | None) -> str | None:
    if not isinstance(profile, dict):
        return None

    display_name = str(profile.get("display_name") or "").strip()
    if not display_name:
        return None

    profile_user_id = str(profile.get("id") or "").strip()
    if _is_profile_public(profile) or (current_user_id and profile_user_id == current_user_id):
        return url_for("public_profile", display_name=display_name)

    return None


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
    climb_count = len(get_user_climbs(user_id))
    existing_badges = {
        str(badge.get("badge_key") or "").strip()
        for badge in get_user_badges(user_id)
        if badge.get("badge_key")
    }

    new_badges = []
    for rule in BADGE_RULES:
        if climb_count < rule["threshold"] or rule["key"] in existing_badges:
            continue
        created_badge = award_badge(user_id, rule["key"])
        if created_badge is not None or rule["key"] in {
            str(badge.get("badge_key") or "").strip()
            for badge in get_user_badges(user_id)
            if badge.get("badge_key")
        }:
            existing_badges.add(rule["key"])
            new_badges.append({"key": rule["key"], "label": rule["label"]})

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
    streak_data = sync_user_current_streak(user_id)
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

    updated_climb, saved_payload = _try_update_climb(climb_id, user_id, fields)
    if updated_climb is None:
        return _json_error("We couldn't update that climb right now.", 500)

    streak_data = sync_user_current_streak(user_id)
    if streak_data.get("profile") is not None:
        session["profile"] = streak_data["profile"]
    else:
        _sync_session_profile(user_id)

    return _json_success(
        {
            "climb": updated_climb,
            "climb_id": updated_climb.get("id", climb_id),
            "peak_id": peak_id,
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
    updates = {}
    for field_name in PROFILE_UPDATE_FIELDS:
        if field_name not in payload:
            continue
        cleaned_value = _clean_text(payload.get(field_name), 1000 if field_name == "bio" else 200)
        if cleaned_value is None:
            return _json_error(f"{field_name.replace('_', ' ').title()} is too long.", 400)
        updates[field_name] = cleaned_value

    if "preferences" in payload and isinstance(payload.get("preferences"), dict):
        updates["preferences"] = payload.get("preferences")

    if not updates:
        return _json_error("No supported profile fields were provided.", 400)

    display_name = updates.get("display_name")
    if "display_name" in updates:
        if not display_name:
            return _json_error("Display name cannot be empty.", 400)
        existing_profile = get_profile_by_display_name(display_name)
        if existing_profile and str(existing_profile.get("id") or "") != user_id:
            return _json_error("That display name is already taken.", 400)

    updated_profile = update_user_profile(user_id, updates) or get_user_profile(user_id)
    if updated_profile is None:
        return _json_error("We couldn't update your profile right now.", 500)

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

    preview = {
        field_name: profile.get(field_name)
        for field_name in PROFILE_PREVIEW_FIELDS
        if profile.get(field_name) is not None
    }
    if not preview.get("display_name"):
        preview["display_name"] = cleaned_name

    return _json_success({"profile": preview})


@api.route("/account/delete", methods=["POST"])
def api_account_delete():
    user_id, error_response = _require_login()
    if error_response:
        return error_response

    if supabase is None or not hasattr(supabase, "auth") or not hasattr(supabase.auth, "admin"):
        return _json_error("Account deletion is not available right now.", 500)

    cleanup_steps = [
        (TABLE_COMMENTS, "user_id"),
        (TABLE_BUCKET_LIST, "user_id"),
        (TABLE_CLIMBS, "user_id"),
        (TABLE_USER_BADGES, "user_id"),
    ]
    for table_name, column_name in cleanup_steps:
        if not _delete_rows_for_user(table_name, user_id, column_name):
            return _json_error("We couldn't fully delete your account data right now.", 500)

    delete_profile(user_id)
    if get_user_profile(user_id) is not None:
        return _json_error("We couldn't fully delete your account profile right now.", 500)

    try:
        supabase.auth.admin.delete_user(user_id)
    except Exception:
        return _json_error("We couldn't permanently delete your account right now.", 500)

    session.pop("user", None)
    session.pop("profile", None)
    return _json_success({"deleted": True})
