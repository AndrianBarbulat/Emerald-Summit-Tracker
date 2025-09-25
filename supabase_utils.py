import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import Client, create_client
from werkzeug.utils import secure_filename

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

TABLE_PEAKS = "IrelandPeacks"
TABLE_PROFILES = "profiles"
TABLE_CLIMBS = os.getenv("SUPABASE_CLIMBS_TABLE") or os.getenv("SUPABASE_USER_CLIMBED_PEAKS_TABLE") or "climbs"
TABLE_BUCKET_LIST = "bucket_list"
TABLE_USER_BADGES = "user_badges"
TABLE_COMMENTS = "peak_comments"
STORAGE_BUCKET_SUMMIT_PHOTOS = os.getenv("SUPABASE_SUMMIT_PHOTOS_BUCKET") or "summit-photos"


def _build_client() -> Optional[Client]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception:
        return None


supabase: Optional[Client] = _build_client()


def _table(name: str):
    if supabase is None:
        return None
    try:
        return supabase.table(name)
    except Exception:
        return None


def _storage_bucket(name: str):
    if supabase is None:
        return None
    try:
        return supabase.storage.from_(name)
    except Exception:
        return None


def _normalize_photo_urls(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []

        try:
            parsed = json.loads(stripped)
        except Exception:
            parsed = None

        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item or "").strip()]

        if "," in stripped:
            return [item.strip() for item in stripped.split(",") if item.strip()]

        return [stripped]

    return []


def _normalize_climb_record(climb: Dict[str, Any]) -> Dict[str, Any]:
    current_climb = dict(climb or {})
    current_climb["date_climbed"] = (
        current_climb.get("date_climbed")
        or current_climb.get("climbed_at")
        or current_climb.get("created_at")
    )
    current_climb["difficulty_rating"] = (
        current_climb.get("difficulty_rating")
        or current_climb.get("difficulty")
    )
    current_climb["photo_urls"] = _normalize_photo_urls(current_climb.get("photo_urls"))
    return current_climb


def _build_storage_photo_path(user_id: str, peak_id: Any, original_filename: str, index: int) -> str:
    safe_name = secure_filename(original_filename or "") or f"photo-{index}.jpg"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{user_id}/{peak_id}/{timestamp}_{index}_{safe_name}"


def upload_climb_photos(user_id: str, peak_id: Any, uploaded_files: List[Any]) -> Dict[str, Any]:
    if not uploaded_files:
        return {"photo_urls": [], "storage_paths": [], "error": None}

    bucket = _storage_bucket(STORAGE_BUCKET_SUMMIT_PHOTOS)
    if bucket is None:
        return {
            "photo_urls": [],
            "storage_paths": [],
            "error": "Your climb was saved, but the photos could not be uploaded right now.",
        }

    uploaded_paths: List[str] = []
    public_urls: List[str] = []

    try:
        for index, uploaded_file in enumerate(uploaded_files, start=1):
            storage_path = _build_storage_photo_path(
                user_id=user_id,
                peak_id=peak_id,
                original_filename=getattr(uploaded_file, "filename", ""),
                index=index,
            )

            try:
                uploaded_file.stream.seek(0)
            except Exception:
                pass

            file_bytes = uploaded_file.read()
            if not isinstance(file_bytes, (bytes, bytearray)):
                file_bytes = bytes(file_bytes or b"")

            bucket.upload(
                storage_path,
                bytes(file_bytes),
                {"content-type": str(getattr(uploaded_file, "mimetype", "") or "application/octet-stream")},
            )

            uploaded_paths.append(storage_path)
            public_urls.append(bucket.get_public_url(storage_path))
        return {"photo_urls": public_urls, "storage_paths": uploaded_paths, "error": None}
    except Exception:
        delete_climb_photo_uploads(uploaded_paths)
        return {
            "photo_urls": [],
            "storage_paths": [],
            "error": "Your climb was saved, but one or more photos could not be uploaded.",
        }


def delete_climb_photo_uploads(storage_paths: List[str]) -> bool:
    if not storage_paths:
        return True

    bucket = _storage_bucket(STORAGE_BUCKET_SUMMIT_PHOTOS)
    if bucket is None:
        return False

    try:
        bucket.remove(storage_paths)
        return True
    except Exception:
        return False


def get_all_peaks(
    province: Optional[str] = None,
    county: Optional[str] = None,
    min_height: Optional[int] = None,
    max_height: Optional[int] = None,
    sort_by: str = "height_rank",
) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_PEAKS)
        if query is None:
            return []

        query = query.select("*")
        if province:
            query = query.eq("province", province)
        if county:
            query = query.eq("county", county)
        if min_height is not None:
            query = query.gte("height_m", min_height)
        if max_height is not None:
            query = query.lte("height_m", max_height)

        allowed_sort_fields = {
            "height_rank",
            "prominence_rank",
            "height_m",
            "prominence_m",
            "name",
            "county",
            "province",
        }
        sort_column = sort_by if sort_by in allowed_sort_fields else "height_rank"
        response = query.order(sort_column).execute()
        return response.data or []
    except Exception:
        return []


def get_peak_by_id(peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_PEAKS)
        if query is None:
            return None
        response = query.select("*").eq("id", peak_id).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_peak_count() -> Optional[int]:
    try:
        query = _table(TABLE_PEAKS)
        if query is None:
            return None
        response = query.select("id", count="exact").execute()
        return response.count
    except Exception:
        return None


def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.select("*").eq("id", user_id).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def update_user_profile(user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.update(data).eq("id", user_id).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_profile_by_display_name(display_name: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.select("*").eq("display_name", display_name).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def create_user_profile(user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        payload = {"id": user_id, **(data or {})}
        response = query.insert(payload).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_user_climbs(user_id: str) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return []
        response = query.select("*").eq("user_id", user_id).order("climbed_at", desc=True).execute()
        return [_normalize_climb_record(climb) for climb in (response.data or [])]
    except Exception:
        return []


def log_climb(user_id: str, peak_id: Any, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        payload = {"user_id": user_id, "peak_id": peak_id, **(data or {})}
        response = query.insert(payload).execute()
        return _normalize_climb_record(response.data[0]) if response.data else None
    except Exception:
        return None


def update_climb(climb_id: Any, user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.update(data).eq("id", climb_id).eq("user_id", user_id).execute()
        return _normalize_climb_record(response.data[0]) if response.data else None
    except Exception:
        return None


def get_climb_by_id(climb_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.select("*").eq("id", climb_id).limit(1).execute()
        return _normalize_climb_record(response.data[0]) if response.data else None
    except Exception:
        return None


def delete_climb(climb_id: Any, user_id: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.delete().eq("id", climb_id).eq("user_id", user_id).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_peak_climbers(peak_id: Any, limit: int = 5) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return []
        response = (
            query.select("*")
            .eq("peak_id", peak_id)
            .order("climbed_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []
    except Exception:
        return []


def _normalize_related_profile(profile_value: Any) -> Dict[str, Any]:
    if isinstance(profile_value, dict):
        return profile_value
    if isinstance(profile_value, list) and profile_value:
        first_profile = profile_value[0]
        if isinstance(first_profile, dict):
            return first_profile
    return {}


def _query_peak_climb_rows(
    peak_id: Any,
    user_id: Optional[str] = None,
    limit: Optional[int] = None,
    select_clause: str = "*",
) -> List[Dict[str, Any]]:
    select_variants = [select_clause]
    if select_clause != "*":
        select_variants.append("*")

    for current_select in select_variants:
        for order_field in ("date_climbed", "climbed_at", "created_at"):
            try:
                query = _table(TABLE_CLIMBS)
                if query is None:
                    return []
                query = query.select(current_select).eq("peak_id", peak_id)
                if user_id:
                    query = query.eq("user_id", user_id)
                query = query.order(order_field, desc=True)
                if limit is not None:
                    query = query.limit(limit)
                response = query.execute()
                return response.data or []
            except Exception:
                continue

    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return []
        query = query.select("*").eq("peak_id", peak_id)
        if user_id:
            query = query.eq("user_id", user_id)
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
        return response.data or []
    except Exception:
        return []


def _query_peak_comment_rows(peak_id: Any, select_clause: str = "*") -> List[Dict[str, Any]]:
    select_variants = [select_clause]
    if select_clause != "*":
        select_variants.append("*")

    for current_select in select_variants:
        try:
            query = _table(TABLE_COMMENTS)
            if query is None:
                return []
            response = (
                query.select(current_select)
                .eq("peak_id", peak_id)
                .order("created_at", desc=True)
                .execute()
            )
            return response.data or []
        except Exception:
            continue

    return []


def _enrich_user_records(records: List[Dict[str, Any]], user_id_key: str = "user_id") -> List[Dict[str, Any]]:
    if not records:
        return []

    profile_cache: Dict[str, Dict[str, Any]] = {}
    enriched_records = []

    for record in records:
        current_record = dict(record or {})
        user_id = str(current_record.get(user_id_key) or "").strip()
        profile = _normalize_related_profile(current_record.get("profiles"))

        if not profile and user_id:
            if user_id not in profile_cache:
                profile_cache[user_id] = get_user_profile(user_id) or {}
            profile = profile_cache[user_id]

        display_name = (
            current_record.get("display_name")
            or current_record.get("user_display_name")
            or current_record.get("user_name")
            or profile.get("display_name")
            or (user_id[:8] if user_id else "Unknown")
        )
        avatar_url = current_record.get("avatar_url") or profile.get("avatar_url")

        current_record["profile"] = profile
        current_record["display_name"] = display_name
        current_record["avatar_url"] = avatar_url
        enriched_records.append(current_record)

    return enriched_records


def get_peak_climb_logs(peak_id: Any, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    climbs = _query_peak_climb_rows(peak_id, limit=limit)
    return [_normalize_climb_record(climb) for climb in climbs]


def get_user_peak_climbs(user_id: str, peak_id: Any) -> List[Dict[str, Any]]:
    climbs = _query_peak_climb_rows(peak_id, user_id=user_id)
    return [_normalize_climb_record(climb) for climb in climbs]


def get_peak_climbers_with_profiles(peak_id: Any, limit: int = 5) -> List[Dict[str, Any]]:
    climbs = _query_peak_climb_rows(
        peak_id,
        limit=limit,
        select_clause="*, profiles(id, display_name, avatar_url)",
    )
    enriched_climbs = _enrich_user_records(climbs)
    normalized_climbs = []
    for climb in enriched_climbs:
        current_climb = dict(climb or {})
        current_climb["date_climbed"] = (
            current_climb.get("date_climbed")
            or current_climb.get("climbed_at")
            or current_climb.get("created_at")
        )
        normalized_climbs.append(current_climb)
    return normalized_climbs


def get_peak_average_difficulty(peak_id: Any) -> Optional[float]:
    difficulty_scores = {
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

    difficulty_values = []
    for climb in get_peak_climb_logs(peak_id):
        raw_difficulty = climb.get("difficulty_rating") or climb.get("difficulty")
        if raw_difficulty is None or str(raw_difficulty).strip() == "":
            continue

        try:
            difficulty_values.append(float(raw_difficulty))
            continue
        except (TypeError, ValueError):
            normalized_difficulty = str(raw_difficulty).strip().lower()
            if normalized_difficulty in difficulty_scores:
                difficulty_values.append(difficulty_scores[normalized_difficulty])

    if not difficulty_values:
        return None

    return round(sum(difficulty_values) / len(difficulty_values), 1)


def get_user_has_climbed(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.select("*").eq("user_id", user_id).eq("peak_id", peak_id).limit(1).execute()
        return _normalize_climb_record(response.data[0]) if response.data else None
    except Exception:
        return None


def get_community_recent_climbs(limit: int = 10) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return []
        response = query.select("*").order("climbed_at", desc=True).limit(limit).execute()
        return [_normalize_climb_record(climb) for climb in (response.data or [])]
    except Exception:
        return []


def get_peak_statuses(user_id: str, peak_ids: List[Any]) -> Dict[str, str]:
    normalized_ids: List[tuple[str, Any]] = []
    seen_ids = set()
    for peak_id in peak_ids or []:
        if peak_id is None:
            continue
        peak_key = str(peak_id)
        if not peak_key or peak_key in seen_ids:
            continue
        seen_ids.add(peak_key)
        normalized_ids.append((peak_key, peak_id))

    if not user_id or not normalized_ids:
        return {}

    raw_peak_ids = [raw_peak_id for _, raw_peak_id in normalized_ids]
    status_map: Dict[str, str] = {
        peak_key: "not_attempted"
        for peak_key, _ in normalized_ids
    }

    climbed_peak_ids = set()
    bucket_peak_ids = set()

    try:
        climbs_query = _table(TABLE_CLIMBS)
        if climbs_query is not None:
            climbs_response = (
                climbs_query.select("peak_id")
                .eq("user_id", user_id)
                .in_("peak_id", raw_peak_ids)
                .execute()
            )
            climbed_peak_ids = {
                str(item.get("peak_id"))
                for item in (climbs_response.data or [])
                if item.get("peak_id") is not None
            }
    except Exception:
        climbed_peak_ids = {
            str(item.get("peak_id"))
            for item in get_user_climbs(user_id)
            if item.get("peak_id") is not None and str(item.get("peak_id")) in status_map
        }

    try:
        bucket_query = _table(TABLE_BUCKET_LIST)
        if bucket_query is not None:
            bucket_response = (
                bucket_query.select("peak_id")
                .eq("user_id", user_id)
                .in_("peak_id", raw_peak_ids)
                .execute()
            )
            bucket_peak_ids = {
                str(item.get("peak_id"))
                for item in (bucket_response.data or [])
                if item.get("peak_id") is not None
            }
    except Exception:
        bucket_peak_ids = {
            str(item.get("peak_id"))
            for item in get_user_bucket_list(user_id)
            if item.get("peak_id") is not None and str(item.get("peak_id")) in status_map
        }

    for peak_key in bucket_peak_ids:
        status_map[peak_key] = "bucket_listed"

    for peak_key in climbed_peak_ids:
        status_map[peak_key] = "climbed"

    return status_map


def get_user_bucket_list(user_id: str) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_BUCKET_LIST)
        if query is None:
            return []
        response = query.select("*").eq("user_id", user_id).execute()
        return response.data or []
    except Exception:
        return []


def add_to_bucket_list(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_BUCKET_LIST)
        if query is None:
            return None
        payload = {"user_id": user_id, "peak_id": peak_id}
        response = query.insert(payload).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def remove_from_bucket_list(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_BUCKET_LIST)
        if query is None:
            return None
        response = query.delete().eq("user_id", user_id).eq("peak_id", peak_id).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def is_bucket_listed(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_BUCKET_LIST)
        if query is None:
            return None
        response = query.select("*").eq("user_id", user_id).eq("peak_id", peak_id).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_user_badges(user_id: str) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_USER_BADGES)
        if query is None:
            return []
        response = query.select("*").eq("user_id", user_id).execute()
        return response.data or []
    except Exception:
        return []


def award_badge(user_id: str, badge_key: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_USER_BADGES)
        if query is None:
            return None
        payload = {"user_id": user_id, "badge_key": badge_key}
        response = query.insert(payload).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_peak_comments(peak_id: Any) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_COMMENTS)
        if query is None:
            return []
        response = query.select("*").eq("peak_id", peak_id).order("created_at", desc=True).execute()
        return response.data or []
    except Exception:
        return []


def get_peak_comments_with_profiles(peak_id: Any) -> List[Dict[str, Any]]:
    comments = _query_peak_comment_rows(
        peak_id,
        select_clause="*, profiles(id, display_name, avatar_url)",
    )
    enriched_comments = _enrich_user_records(comments)
    normalized_comments = []
    for comment in enriched_comments:
        current_comment = dict(comment or {})
        current_comment["comment_text"] = (
            current_comment.get("comment_text")
            or current_comment.get("text")
            or ""
        )
        normalized_comments.append(current_comment)
    return normalized_comments


def get_comment_by_id(comment_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_COMMENTS)
        if query is None:
            return None
        response = query.select("*").eq("id", comment_id).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def add_comment(user_id: str, peak_id: Any, text: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_COMMENTS)
        if query is None:
            return None
        payload = {"user_id": user_id, "peak_id": peak_id, "text": text}
        response = query.insert(payload).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def delete_comment(comment_id: Any, user_id: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_COMMENTS)
        if query is None:
            return None
        response = query.delete().eq("id", comment_id).eq("user_id", user_id).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def delete_profile(user_id: str) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.delete().eq("id", user_id).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None
