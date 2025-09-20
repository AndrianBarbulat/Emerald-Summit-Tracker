import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

TABLE_PEAKS = "IrelandPeacks"
TABLE_PROFILES = "profiles"
TABLE_CLIMBS = os.getenv("SUPABASE_CLIMBS_TABLE") or os.getenv("SUPABASE_USER_CLIMBED_PEAKS_TABLE") or "climbs"
TABLE_BUCKET_LIST = "bucket_list"
TABLE_USER_BADGES = "user_badges"
TABLE_COMMENTS = "peak_comments"


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
        return response.data or []
    except Exception:
        return []


def log_climb(user_id: str, peak_id: Any, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        payload = {"user_id": user_id, "peak_id": peak_id, **(data or {})}
        response = query.insert(payload).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def update_climb(climb_id: Any, user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.update(data).eq("id", climb_id).eq("user_id", user_id).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_climb_by_id(climb_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.select("*").eq("id", climb_id).limit(1).execute()
        return response.data[0] if response.data else None
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


def get_user_has_climbed(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return None
        response = query.select("*").eq("user_id", user_id).eq("peak_id", peak_id).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        return None


def get_community_recent_climbs(limit: int = 10) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return []
        response = query.select("*").order("climbed_at", desc=True).limit(limit).execute()
        return response.data or []
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
