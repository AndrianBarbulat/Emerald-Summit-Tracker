from datetime import date

from flask import Blueprint, jsonify, request, session

from supabase_utils import (
    add_to_bucket_list,
    get_peak_by_id,
    get_user_has_climbed,
    is_bucket_listed,
    log_climb,
    remove_from_bucket_list,
)

api_bp = Blueprint("api", __name__, url_prefix="/api")

ALLOWED_DIFFICULTIES = {"easy", "moderate", "hard"}


@api_bp.route("/health", methods=["GET"])
def api_health():
    return jsonify({"status": "ok"})


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
    return request.form.to_dict() if request.form else {}


def _parse_peak_id(payload: dict) -> int | None:
    raw_peak_id = payload.get("peak_id")
    try:
        return int(raw_peak_id)
    except (TypeError, ValueError):
        return None


def _current_user_status(user_id: str, peak_id: int) -> dict:
    climbed = get_user_has_climbed(user_id, peak_id) is not None
    bucket_listed = is_bucket_listed(user_id, peak_id) is not None
    return {
        "is_climbed": climbed,
        "is_bucket_listed": bucket_listed,
        "user_status": "climbed" if climbed else ("bucket" if bucket_listed else "none"),
    }


def _log_climb_payload_variants(climbed_at: str, notes: str, difficulty: str) -> list[dict]:
    base_payload = {"climbed_at": climbed_at}
    full_payload = {**base_payload}
    if notes:
        full_payload["notes"] = notes
    if difficulty:
        full_payload["difficulty"] = difficulty

    variants = [full_payload]
    if notes and difficulty:
        variants.append({**base_payload, "notes": notes})
        variants.append({**base_payload, "difficulty": difficulty})
    variants.append(base_payload)

    deduped_variants = []
    seen_variants = set()
    for variant in variants:
        variant_key = tuple(sorted(variant.items()))
        if variant_key in seen_variants:
            continue
        seen_variants.add(variant_key)
        deduped_variants.append(variant)

    return deduped_variants


def _try_log_climb(user_id: str, peak_id: int, climbed_at: str, notes: str, difficulty: str):
    for payload in _log_climb_payload_variants(climbed_at, notes, difficulty):
        climb = log_climb(user_id, peak_id, payload)
        if climb is not None:
            return climb, payload
        existing_climb = get_user_has_climbed(user_id, peak_id)
        if existing_climb is not None:
            return existing_climb, payload
    return None, None


@api_bp.route("/log-climb", methods=["POST"])
def api_log_climb():
    user_id = _get_current_user_id()
    if not user_id:
        return jsonify({"error": "You need to log in to log climbs."}), 401

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return jsonify({"error": "A valid peak id is required."}), 400

    if get_peak_by_id(peak_id) is None:
        return jsonify({"error": "That peak could not be found."}), 404

    climbed_at = str(payload.get("climbed_at") or payload.get("date") or date.today().isoformat()).strip()
    try:
        date.fromisoformat(climbed_at)
    except ValueError:
        return jsonify({"error": "Please choose a valid climb date."}), 400

    notes = str(payload.get("notes") or "").strip()
    if len(notes) > 1000:
        return jsonify({"error": "Notes must be 1000 characters or fewer."}), 400

    difficulty = str(payload.get("difficulty") or "moderate").strip().lower()
    if difficulty and difficulty not in ALLOWED_DIFFICULTIES:
        return jsonify({"error": "Please choose an allowed difficulty."}), 400

    existing_climb = get_user_has_climbed(user_id, peak_id)
    if existing_climb is not None:
        return jsonify(
            {
                "ok": True,
                "already_climbed": True,
                "peak_id": peak_id,
                "climb": existing_climb,
                **_current_user_status(user_id, peak_id),
            }
        )

    created_climb, saved_payload = _try_log_climb(user_id, peak_id, climbed_at, notes, difficulty)
    if created_climb is None:
        return jsonify({"error": "We couldn't save that climb right now."}), 500

    return jsonify(
        {
            "ok": True,
            "peak_id": peak_id,
            "climb": created_climb,
            "saved_fields": sorted(saved_payload.keys()) if saved_payload else [],
            **_current_user_status(user_id, peak_id),
        }
    )


@api_bp.route("/bucket-list/add", methods=["POST"])
def api_bucket_list_add():
    user_id = _get_current_user_id()
    if not user_id:
        return jsonify({"error": "You need to log in to use your bucket list."}), 401

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return jsonify({"error": "A valid peak id is required."}), 400

    if get_peak_by_id(peak_id) is None:
        return jsonify({"error": "That peak could not be found."}), 404

    existing_bucket_item = is_bucket_listed(user_id, peak_id)
    if existing_bucket_item is None:
        created_bucket_item = add_to_bucket_list(user_id, peak_id)
        if created_bucket_item is None and is_bucket_listed(user_id, peak_id) is None:
            return jsonify({"error": "We couldn't add that peak to your bucket list."}), 500

    return jsonify(
        {
            "ok": True,
            "peak_id": peak_id,
            **_current_user_status(user_id, peak_id),
        }
    )


@api_bp.route("/bucket-list/remove", methods=["POST"])
def api_bucket_list_remove():
    user_id = _get_current_user_id()
    if not user_id:
        return jsonify({"error": "You need to log in to use your bucket list."}), 401

    payload = _get_request_data()
    peak_id = _parse_peak_id(payload)
    if peak_id is None:
        return jsonify({"error": "A valid peak id is required."}), 400

    if get_peak_by_id(peak_id) is None:
        return jsonify({"error": "That peak could not be found."}), 404

    if is_bucket_listed(user_id, peak_id) is not None:
        remove_from_bucket_list(user_id, peak_id)
        if is_bucket_listed(user_id, peak_id) is not None:
            return jsonify({"error": "We couldn't update your bucket list right now."}), 500

    return jsonify(
        {
            "ok": True,
            "peak_id": peak_id,
            **_current_user_status(user_id, peak_id),
        }
    )
