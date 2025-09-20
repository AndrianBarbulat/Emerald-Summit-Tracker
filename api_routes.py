from datetime import date

from flask import Blueprint, jsonify, request, session

from supabase_utils import (
    TABLE_BUCKET_LIST,
    TABLE_CLIMBS,
    TABLE_COMMENTS,
    TABLE_PROFILES,
    TABLE_USER_BADGES,
    add_comment,
    add_to_bucket_list,
    award_badge,
    delete_climb,
    delete_comment,
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
    update_climb,
    update_user_profile,
)

api = Blueprint("api", __name__, url_prefix="/api")
api_bp = api

_UNSET = object()
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


def _json_error(message: str, status: int = 400):
    return jsonify({"success": False, "ok": False, "error": message}), status


def _get_current_user_id() -> str | None:
    profile = session.get("profile")
    if isinstance(profile, dict) and profile.get("id"):
        return str(profile["id"])

    user = session.get("user")
    if isinstance(user, dict) and user.get("id"):
        return str(user["id"])

    return None


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


def _clean_text(value, max_length: int, allow_empty: bool = True):
    if value is _UNSET:
        return _UNSET
    cleaned = str(value or "").strip()
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
        return date.today().isoformat(), None

    normalized = str(raw_value).strip()
    try:
        date.fromisoformat(normalized)
    except ValueError:
        return None, "Please choose a valid date."
    return normalized, None


def _normalize_climb_fields(payload: dict, require_date: bool):
    normalized_date, date_error = _normalize_date_value(
        _extract_field(payload, "date_climbed", "climbed_at", "date"),
        required=require_date,
    )
    if date_error:
        return None, date_error

    notes = _clean_text(_extract_field(payload, "notes"), 1000)
    if notes is None:
        return None, "Notes must be 1000 characters or fewer."

    weather = _clean_text(_extract_field(payload, "weather"), 120)
    if weather is None:
        return None, "Weather must be 120 characters or fewer."

    difficulty = _clean_text(_extract_field(payload, "difficulty_rating", "difficulty"), 40)
    if difficulty is None:
        return None, "Difficulty rating must be 40 characters or fewer."

    return {
        "date_climbed": normalized_date,
        "notes": notes,
        "weather": weather,
        "difficulty_rating": difficulty,
    }, None


def _build_climb_payload_variants(fields: dict) -> list[dict]:
    date_climbed = fields.get("date_climbed", _UNSET)
    notes = fields.get("notes", _UNSET)
    weather = fields.get("weather", _UNSET)
    difficulty_rating = fields.get("difficulty_rating", _UNSET)

    variants = [
        {
            "date_climbed": date_climbed,
            "notes": notes,
            "weather": weather,
            "difficulty_rating": difficulty_rating,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "weather": weather,
            "difficulty_rating": difficulty_rating,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "weather": weather,
            "difficulty": difficulty_rating,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
            "difficulty": difficulty_rating,
        },
        {
            "climbed_at": date_climbed,
            "notes": notes,
        },
        {
            "date_climbed": date_climbed,
            "notes": notes,
        },
        {
            "climbed_at": date_climbed,
        },
        {
            "date_climbed": date_climbed,
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
        variant_key = tuple(sorted(compact_variant.items()))
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
        return _json_error(field_error, 400)

    removed_from_bucket_list = _remove_bucket_list_entry_if_present(user_id, peak_id)
    existing_climb = get_user_has_climbed(user_id, peak_id)
    if existing_climb is not None:
        return _json_success(
            {
                "already_climbed": True,
                "climb": existing_climb,
                "climb_id": existing_climb.get("id"),
                "new_badges": [],
                "peak_id": peak_id,
                "removed_from_bucket_list": removed_from_bucket_list,
                **_current_user_status(user_id, peak_id),
            }
        )

    created_climb, saved_payload = _try_log_climb(user_id, peak_id, fields)
    if created_climb is None:
        return _json_error("We couldn't save that climb right now.", 500)

    return _json_success(
        {
            "climb": created_climb,
            "climb_id": created_climb.get("id"),
            "new_badges": _award_new_badges_for_user(user_id),
            "peak_id": peak_id,
            "removed_from_bucket_list": removed_from_bucket_list,
            "saved_fields": sorted(saved_payload.keys()) if saved_payload else [],
            **_current_user_status(user_id, peak_id),
        }
    )


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

    if request.method == "DELETE":
        deleted_climb = delete_climb(climb_id, user_id)
        if deleted_climb is None and get_climb_by_id(climb_id) is not None:
            return _json_error("We couldn't delete that climb right now.", 500)
        return _json_success({"climb_id": climb_id})

    payload = _get_request_data()
    fields, field_error = _normalize_climb_fields(payload, require_date=False)
    if field_error:
        return _json_error(field_error, 400)

    if all(value is _UNSET for value in fields.values()):
        return _json_error("Provide at least one climb field to update.", 400)

    updated_climb, saved_payload = _try_update_climb(climb_id, user_id, fields)
    if updated_climb is None:
        return _json_error("We couldn't update that climb right now.", 500)

    return _json_success(
        {
            "climb": updated_climb,
            "climb_id": updated_climb.get("id", climb_id),
            "saved_fields": sorted(saved_payload.keys()) if saved_payload else [],
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

    comment_text = _clean_text(_extract_field(payload, "comment_text", "text"), 2000, allow_empty=False)
    if comment_text is None:
        return _json_error("Comment text is required and must be 2000 characters or fewer.", 400)

    comment = add_comment(user_id, peak_id, comment_text)
    if comment is None:
        return _json_error("We couldn't post that comment right now.", 500)

    return _json_success({"comment": comment, "comment_id": comment.get("id")})


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
