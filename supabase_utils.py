import json
import logging
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlparse

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        return False

from supabase import Client, create_client
from time_utils import parse_datetime_value
from werkzeug.utils import secure_filename

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

TABLE_PEAKS = "IrelandPeacks"
TABLE_PROFILES = "profiles"
TABLE_CLIMBS = os.getenv("SUPABASE_CLIMBS_TABLE") or os.getenv("SUPABASE_USER_CLIMBED_PEAKS_TABLE") or "climbs"
TABLE_BUCKET_LIST = os.getenv("SUPABASE_BUCKET_LIST_TABLE") or os.getenv("SUPABASE_USER_BUCKET_LIST_TABLE") or "user_bucket_list"
TABLE_USER_BADGES = "user_badges"
TABLE_COMMENTS = "peak_comments"
STORAGE_BUCKET_SUMMIT_PHOTOS = os.getenv("SUPABASE_SUMMIT_PHOTOS_BUCKET") or "summit-photos"
STORAGE_BUCKET_AVATARS = os.getenv("SUPABASE_AVATARS_BUCKET") or "avatars"
SHARED_CACHE_TTL_SECONDS = 300
SHARED_COMMUNITY_CACHE_LIMIT = 250
SHARED_CACHE_KEYS = (
    "community_feed",
    "leaderboard_community_stats",
    "leaderboard_popular_peaks",
    "leaderboard_peaks",
    "leaderboard_elevation",
    "leaderboard_streaks",
)
SHARED_LEADERBOARD_CACHE_KEYS = (
    "leaderboard_community_stats",
    "leaderboard_popular_peaks",
    "leaderboard_peaks",
    "leaderboard_elevation",
    "leaderboard_streaks",
)
_SHARED_QUERY_CACHE: Dict[str, Dict[str, Any]] = {}
_BUCKET_LIST_TABLE_NAME = TABLE_BUCKET_LIST


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


def _is_missing_table_error(error: Exception) -> bool:
    message = str(error or "")
    return "PGRST205" in message or "Could not find the table" in message


def _bucket_list_table_candidates() -> List[str]:
    candidates = []
    for table_name in (
        _BUCKET_LIST_TABLE_NAME,
        os.getenv("SUPABASE_BUCKET_LIST_TABLE"),
        os.getenv("SUPABASE_USER_BUCKET_LIST_TABLE"),
        "user_bucket_list",
        "bucket_list",
    ):
        normalized_name = str(table_name or "").strip()
        if normalized_name and normalized_name not in candidates:
            candidates.append(normalized_name)
    return candidates


def _execute_bucket_list_query(run_query):
    global _BUCKET_LIST_TABLE_NAME

    last_error = None
    for table_name in _bucket_list_table_candidates():
        query = _table(table_name)
        if query is None:
            continue

        try:
            result = run_query(query)
            _BUCKET_LIST_TABLE_NAME = table_name
            return result
        except Exception as exc:
            last_error = exc
            if _is_missing_table_error(exc):
                continue
            raise

    if last_error is not None:
        raise last_error
    return None


def _cache_is_fresh(entry: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(entry, dict):
        return False
    cached_at = float(entry.get("timestamp") or 0)
    return (time.time() - cached_at) < SHARED_CACHE_TTL_SECONDS


def _get_cached_shared_value(key: str) -> Any:
    entry = _SHARED_QUERY_CACHE.get(key)
    if not _cache_is_fresh(entry):
        return None
    return entry.get("data")


def _set_cached_shared_value(key: str, data: Any, **metadata: Any) -> Any:
    _SHARED_QUERY_CACHE[key] = {
        "timestamp": time.time(),
        "data": data,
        **metadata,
    }
    return data


def clear_shared_data_cache(keys: Optional[List[str]] = None) -> None:
    keys_to_clear = list(keys or SHARED_CACHE_KEYS)
    for key in keys_to_clear:
        _SHARED_QUERY_CACHE.pop(str(key or "").strip(), None)


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


def _storage_object_path_from_public_url(value: Any, bucket_name: str) -> Optional[str]:
    normalized_value = str(value or "").strip()
    normalized_bucket = str(bucket_name or "").strip().strip("/")
    if not normalized_value or not normalized_bucket:
        return None

    parsed_url = urlparse(normalized_value)
    candidate_path = ""
    bucket_marker = f"/storage/v1/object/public/{normalized_bucket}/"

    if parsed_url.scheme and parsed_url.netloc:
        parsed_path = unquote(parsed_url.path or "")
        if bucket_marker in parsed_path:
            candidate_path = parsed_path.split(bucket_marker, 1)[1]
    else:
        candidate_path = normalized_value

    candidate_path = unquote(str(candidate_path or "").strip()).lstrip("/")
    bucket_prefix = f"{normalized_bucket}/"
    if candidate_path.startswith(bucket_prefix):
        candidate_path = candidate_path[len(bucket_prefix):]

    return candidate_path or None


def extract_climb_photo_storage_paths(value: Any) -> List[str]:
    normalized_urls = _normalize_photo_urls(value)
    if not normalized_urls:
        return []

    storage_paths: List[str] = []
    seen_paths = set()

    for photo_url in normalized_urls:
        candidate_path = _storage_object_path_from_public_url(photo_url, STORAGE_BUCKET_SUMMIT_PHOTOS)

        if not candidate_path or candidate_path in seen_paths:
            continue

        seen_paths.add(candidate_path)
        storage_paths.append(candidate_path)

    return storage_paths


def extract_profile_avatar_storage_path(value: Any) -> Optional[str]:
    return _storage_object_path_from_public_url(value, STORAGE_BUCKET_AVATARS)


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


def _delete_storage_objects(bucket_name: str, storage_paths: List[str]) -> bool:
    if not storage_paths:
        return True

    bucket = _storage_bucket(bucket_name)
    if bucket is None:
        return False

    try:
        bucket.remove(storage_paths)
        return True
    except Exception:
        return False


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
    return _delete_storage_objects(STORAGE_BUCKET_SUMMIT_PHOTOS, storage_paths)


def delete_profile_avatar_upload(storage_path: Optional[str]) -> bool:
    if not storage_path:
        return True
    return _delete_storage_objects(STORAGE_BUCKET_AVATARS, [storage_path])


def upload_profile_avatar(user_id: str, uploaded_file: Any, existing_avatar_url: Any = None) -> Dict[str, Any]:
    if uploaded_file is None:
        return {"avatar_url": None, "storage_path": None, "error": "No avatar file was provided."}

    bucket = _storage_bucket(STORAGE_BUCKET_AVATARS)
    if bucket is None:
        return {"avatar_url": None, "storage_path": None, "error": "Your avatar could not be uploaded right now."}

    original_filename = getattr(uploaded_file, "filename", "") or "avatar.jpg"
    raw_mimetype = str(getattr(uploaded_file, "mimetype", "") or "").strip().lower()
    extension = os.path.splitext(secure_filename(original_filename) or "")[1].lower()
    extension_by_type = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    allowed_mimetypes = set(extension_by_type.keys())
    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

    if raw_mimetype not in allowed_mimetypes:
        return {"avatar_url": None, "storage_path": None, "error": "Avatar images must be JPG, PNG, WEBP, or GIF."}

    if extension not in allowed_extensions:
        extension = extension_by_type.get(raw_mimetype, ".jpg")
    elif extension == ".jpeg":
        extension = ".jpg"

    try:
        uploaded_file.stream.seek(0)
    except Exception:
        pass

    file_bytes = uploaded_file.read()
    if not isinstance(file_bytes, (bytes, bytearray)):
        file_bytes = bytes(file_bytes or b"")

    if not file_bytes:
        return {"avatar_url": None, "storage_path": None, "error": "Please choose an avatar image to upload."}

    if len(file_bytes) > (2 * 1024 * 1024):
        return {"avatar_url": None, "storage_path": None, "error": "Avatar images must be 2MB or smaller."}

    storage_path = f"{user_id}/avatar{extension}"
    previous_storage_path = extract_profile_avatar_storage_path(existing_avatar_url)
    try:
        bucket.upload(
            storage_path,
            bytes(file_bytes),
            {"content-type": raw_mimetype, "upsert": "true"},
        )
    except Exception:
        try:
            bucket.remove([storage_path])
            bucket.upload(storage_path, bytes(file_bytes), {"content-type": raw_mimetype})
        except Exception:
            return {"avatar_url": None, "storage_path": None, "error": "Your avatar could not be uploaded right now."}

    if previous_storage_path and previous_storage_path != storage_path:
        delete_profile_avatar_upload(previous_storage_path)

    return {
        "avatar_url": bucket.get_public_url(storage_path),
        "storage_path": storage_path,
        "error": None,
    }


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


def get_county_peak_counts() -> Dict[str, int]:
    county_counts: Dict[str, int] = {}

    try:
        query = _table(TABLE_PEAKS)
        if query is not None:
            response = query.select("county").execute()
            for peak in response.data or []:
                county_name = str((peak or {}).get("county") or "").strip()
                if not county_name:
                    continue
                county_counts[county_name] = county_counts.get(county_name, 0) + 1
            if county_counts:
                return county_counts
    except Exception:
        county_counts = {}

    for peak in get_all_peaks():
        county_name = str((peak or {}).get("county") or "").strip()
        if not county_name:
            continue
        county_counts[county_name] = county_counts.get(county_name, 0) + 1

    return county_counts


def _normalize_search_query(query: Any) -> str:
    return re.sub(r"\s+", " ", str(query or "").strip())


def _search_sort_key(label: Any, query: str) -> tuple[int, int, int, str]:
    normalized_label = str(label or "").strip().lower()
    normalized_query = str(query or "").strip().lower()
    if not normalized_label:
        return (1, 9999, 9999, "")

    match_index = normalized_label.find(normalized_query) if normalized_query else -1
    starts_with_query = 0 if normalized_query and normalized_label.startswith(normalized_query) else 1
    return (
        starts_with_query,
        match_index if match_index >= 0 else 9999,
        len(normalized_label),
        normalized_label,
    )


def search_peaks_by_name(query: Any, limit: Optional[int] = 5) -> List[Dict[str, Any]]:
    normalized_query = _normalize_search_query(query)
    if not normalized_query:
        return []

    peaks: List[Dict[str, Any]] = []
    query_pattern = f"%{normalized_query}%"

    try:
        peak_query = _table(TABLE_PEAKS)
        if peak_query is not None:
            response = (
                peak_query
                .select("id,name,county,province,height_m,height_ft,height")
                .ilike("name", query_pattern)
                .execute()
            )
            peaks = response.data or []
    except Exception:
        peaks = []

    if not peaks:
        peaks = [
            peak
            for peak in get_all_peaks()
            if normalized_query.lower() in str((peak or {}).get("name") or "").lower()
        ]

    normalized_query_key = normalized_query.lower()
    peak_results = [
        {
            "id": peak.get("id"),
            "name": str(peak.get("name") or "").strip() or f"Peak #{peak.get('id')}",
            "county": str(peak.get("county") or "").strip(),
            "province": str(peak.get("province") or "").strip(),
            "height_m": peak.get("height_m") or peak.get("height"),
            "height_ft": peak.get("height_ft"),
        }
        for peak in peaks
        if peak.get("id") is not None and normalized_query_key in str(peak.get("name") or "").lower()
    ]
    peak_results.sort(
        key=lambda peak: (
            _search_sort_key(peak.get("name"), normalized_query_key),
            str(peak.get("county") or "").lower(),
            str(peak.get("province") or "").lower(),
        )
    )
    return peak_results[:limit] if limit is not None else peak_results


def search_public_profiles(query: Any, limit: Optional[int] = 5) -> List[Dict[str, Any]]:
    normalized_query = _normalize_search_query(query)
    if not normalized_query:
        return []

    profiles: List[Dict[str, Any]] = []
    query_pattern = f"%{normalized_query}%"

    try:
        profile_query = _table(TABLE_PROFILES)
        if profile_query is not None:
            response = (
                profile_query
                .select("id,display_name,avatar_url,location,profile_visibility,public_profile,is_public,show_profile,preferences")
                .ilike("display_name", query_pattern)
                .execute()
            )
            profiles = response.data or []
    except Exception:
        profiles = []

    if not profiles:
        try:
            profile_query = _table(TABLE_PROFILES)
            if profile_query is not None:
                response = profile_query.select("id,display_name,avatar_url,location,profile_visibility,public_profile,is_public,show_profile,preferences").execute()
                profiles = response.data or []
        except Exception:
            profiles = []

    normalized_query_key = normalized_query.lower()
    public_profiles = []
    for profile in profiles:
        display_name = str((profile or {}).get("display_name") or "").strip()
        if not display_name or normalized_query_key not in display_name.lower():
            continue
        if not _is_profile_public(profile):
            continue

        public_profiles.append(
            {
                "id": profile.get("id"),
                "display_name": display_name,
                "avatar_url": profile.get("avatar_url"),
                "location": str(profile.get("location") or "").strip(),
            }
        )

    public_profiles.sort(
        key=lambda profile: (
            _search_sort_key(profile.get("display_name"), normalized_query_key),
            str(profile.get("location") or "").lower(),
        )
    )
    return public_profiles[:limit] if limit is not None else public_profiles


def search_counties(query: Any, limit: Optional[int] = 5) -> List[Dict[str, Any]]:
    normalized_query = _normalize_search_query(query)
    if not normalized_query:
        return []

    matching_peaks: List[Dict[str, Any]] = []
    query_pattern = f"%{normalized_query}%"

    try:
        peak_query = _table(TABLE_PEAKS)
        if peak_query is not None:
            response = (
                peak_query
                .select("county,province")
                .ilike("county", query_pattern)
                .execute()
            )
            matching_peaks = response.data or []
    except Exception:
        matching_peaks = []

    if not matching_peaks:
        matching_peaks = [
            peak
            for peak in get_all_peaks()
            if normalized_query.lower() in str((peak or {}).get("county") or "").lower()
        ]

    counties_by_key: Dict[str, Dict[str, Any]] = {}
    normalized_query_key = normalized_query.lower()
    for peak in matching_peaks:
        county_name = str((peak or {}).get("county") or "").strip()
        if not county_name or normalized_query_key not in county_name.lower():
            continue

        county_key = county_name.lower()
        county_entry = counties_by_key.setdefault(
            county_key,
            {
                "name": county_name,
                "province": str((peak or {}).get("province") or "").strip(),
                "peak_count": 0,
            },
        )
        county_entry["peak_count"] += 1
        if not county_entry.get("province"):
            county_entry["province"] = str((peak or {}).get("province") or "").strip()

    county_results = list(counties_by_key.values())
    county_results.sort(
        key=lambda county: (
            _search_sort_key(county.get("name"), normalized_query_key),
            str(county.get("province") or "").lower(),
        )
    )
    return county_results[:limit] if limit is not None else county_results


def search_site_catalog(
    query: Any,
    peak_limit: Optional[int] = 5,
    user_limit: Optional[int] = 5,
    county_limit: Optional[int] = 5,
) -> Dict[str, Any]:
    normalized_query = _normalize_search_query(query)
    if not normalized_query:
        return {
            "query": "",
            "peaks": [],
            "users": [],
            "counties": [],
        }

    return {
        "query": normalized_query,
        "peaks": search_peaks_by_name(normalized_query, limit=peak_limit),
        "users": search_public_profiles(normalized_query, limit=user_limit),
        "counties": search_counties(normalized_query, limit=county_limit),
    }


def is_display_name_conflict(error_message: Any) -> bool:
    message = str(error_message or "").lower()
    return (
        "display_name" in message
        or "profiles_display_name_key" in message
        or ("duplicate key" in message and "profile" in message)
    )


def _sanitize_display_name(email: str) -> str:
    base = str(email or "").split("@")[0].strip().lower()
    cleaned = re.sub(r"[^a-z0-9._-]+", "_", base)
    cleaned = re.sub(r"_+", "_", cleaned).strip("._-")
    return cleaned or "climber"


def _minimal_profile(user_id: str, email: str) -> Dict[str, Any]:
    email_value = str(email or "").strip().lower()
    display_name = email_value.split("@")[0] if "@" in email_value else "climber"
    return {
        "id": user_id,
        "email": email_value,
        "display_name": display_name or "climber",
    }


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
    normalized_display_name = str(display_name or "").strip()
    if not normalized_display_name:
        return None

    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.select("*").eq("display_name", normalized_display_name).limit(1).execute()
        return response.data[0] if response.data else None
    except Exception:
        pass

    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.select("*").ilike("display_name", normalized_display_name).limit(1).execute()
        if response.data:
            return response.data[0]
    except Exception:
        pass

    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None
        response = query.select("*").execute()
        normalized_key = normalized_display_name.lower()
        for profile in (response.data or []):
            if str(profile.get("display_name") or "").strip().lower() == normalized_key:
                return profile
    except Exception:
        return None

        return None


def try_create_user_profile(user_id: str, data: Dict[str, Any]) -> tuple[Optional[Dict[str, Any]], str]:
    try:
        query = _table(TABLE_PROFILES)
        if query is None:
            return None, ""
        payload = {"id": user_id, **(data or {})}
        response = query.insert(payload).execute()
        return (response.data[0] if response.data else None), ""
    except Exception as exc:
        return None, str(exc)


def create_user_profile(user_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    created_profile, _ = try_create_user_profile(user_id, data)
    return created_profile


def get_or_create_session_profile(user_id: str, email: str, logger: Any = None) -> Dict[str, Any]:
    if supabase is None:
        return _minimal_profile(user_id, email)

    active_logger = logger or logging.getLogger(__name__)
    existing_profile = get_user_profile(user_id)
    if existing_profile:
        return existing_profile

    normalized_email = str(email or "").strip().lower()
    base_name = _sanitize_display_name(normalized_email)
    id_suffix = str(user_id or "")[:8] or "user"
    candidate_names = [
        base_name,
        f"{base_name}_{id_suffix}",
        f"{base_name}_{int(datetime.now(tz=timezone.utc).timestamp())}",
    ]

    for candidate in candidate_names:
        payload_variants = [
            {"email": normalized_email, "display_name": candidate},
            {"display_name": candidate},
            {},
        ]

        last_error = ""
        for payload in payload_variants:
            created_profile, create_error = try_create_user_profile(user_id, payload)
            if created_profile:
                return created_profile
            if create_error and is_display_name_conflict(create_error):
                last_error = create_error
                break
            if create_error:
                last_error = create_error

        if last_error and is_display_name_conflict(last_error):
            active_logger.warning(
                "Profile create conflict for user_id=%s display_name=%s. Retrying with a new suffix.",
                user_id,
                candidate,
            )
            continue

        if last_error:
            active_logger.warning("Profile create failed for user_id=%s: %s", user_id, last_error)
            break

    existing_profile = get_user_profile(user_id)
    if existing_profile:
        return existing_profile

    active_logger.warning("Profile row not found for user_id=%s. Using minimal profile.", user_id)
    return _minimal_profile(user_id, email)


def auth_sign_up(email: str, password: str) -> Any:
    if supabase is None:
        return None
    return supabase.auth.sign_up({"email": email, "password": password})


def auth_sign_in_with_password(email: str, password: str) -> Any:
    if supabase is None:
        return None
    return supabase.auth.sign_in_with_password({"email": email, "password": password})


def auth_get_current_user() -> Any:
    if supabase is None:
        return None
    return supabase.auth.get_user()


def auth_get_session() -> Any:
    if supabase is None:
        return None
    return supabase.auth.get_session()


def auth_restore_session(access_token: str, refresh_token: str) -> Any:
    if supabase is None:
        return None
    return supabase.auth.set_session(access_token, refresh_token)


def auth_clear_session() -> None:
    if supabase is None:
        return

    remove_session = getattr(supabase.auth, "_remove_session", None)
    if callable(remove_session):
        try:
            remove_session()
            return
        except Exception:
            pass

    try:
        supabase.auth.sign_out()
    except Exception:
        return


def auth_sign_out() -> bool:
    if supabase is None:
        return False
    supabase.auth.sign_out()
    return True


def get_user_climbs(user_id: str) -> List[Dict[str, Any]]:
    try:
        query = _table(TABLE_CLIMBS)
        if query is None:
            return []
        response = query.select("*").eq("user_id", user_id).order("climbed_at", desc=True).execute()
        return [_normalize_climb_record(climb) for climb in (response.data or [])]
    except Exception:
        return []


def get_user_climb_history(user_id: str) -> List[Dict[str, Any]]:
    climbs = get_user_climbs(user_id)
    if not climbs:
        return []

    peaks_by_id = {
        str(peak.get("id")): peak
        for peak in get_all_peaks()
        if peak.get("id") is not None
    }

    enriched_climbs = []
    for climb in climbs:
        current_climb = dict(climb or {})
        peak_id = current_climb.get("peak_id")
        peak = dict(peaks_by_id.get(str(peak_id)) or {})

        current_climb["peak"] = peak
        current_climb["peak_name"] = (
            current_climb.get("peak_name")
            or peak.get("name")
            or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak")
        )
        current_climb["peak_height_m"] = peak.get("height_m") or peak.get("height")
        current_climb["peak_height_ft"] = peak.get("height_ft")
        current_climb["peak_county"] = peak.get("county")
        current_climb["peak_province"] = peak.get("province")
        current_climb["peak_range_area"] = peak.get("range_area")
        enriched_climbs.append(current_climb)

    return enriched_climbs


def calculate_climb_streak(climbs: List[Dict[str, Any]], reference_date: Optional[date] = None) -> Dict[str, Any]:
    today = reference_date or datetime.now(tz=timezone.utc).date()
    current_week_start = today - timedelta(days=today.isoweekday() - 1)
    previous_week_start = current_week_start - timedelta(days=7)
    climbed_week_starts = set()
    latest_climb_dt = None
    latest_climb_value = None

    for climb in climbs or []:
        raw_date = (
            climb.get("date_climbed")
            or climb.get("climbed_at")
            or climb.get("created_at")
        )
        parsed_date = parse_datetime_value(raw_date)
        if parsed_date is None:
            continue

        climb_date = parsed_date.astimezone(timezone.utc).date()
        week_start = climb_date - timedelta(days=climb_date.isoweekday() - 1)
        climbed_week_starts.add(week_start)
        if latest_climb_dt is None or parsed_date > latest_climb_dt:
            latest_climb_dt = parsed_date
            latest_climb_value = raw_date or parsed_date.isoformat()

    def _count_consecutive_weeks(start_week: date) -> int:
        count = 0
        cursor = start_week
        while cursor in climbed_week_starts:
            count += 1
            cursor -= timedelta(days=7)
        return count

    active_weeks = _count_consecutive_weeks(current_week_start) if current_week_start in climbed_week_starts else 0
    at_risk_weeks = (
        _count_consecutive_weeks(previous_week_start)
        if active_weeks == 0 and previous_week_start in climbed_week_starts
        else 0
    )
    display_weeks = active_weeks or at_risk_weeks
    status = "active" if active_weeks else "at_risk" if at_risk_weeks else "inactive"

    return {
        "active_weeks": active_weeks,
        "at_risk": status == "at_risk",
        "current_streak": display_weeks,
        "display_weeks": display_weeks,
        "has_climb_this_week": active_weeks > 0,
        "last_climb_at": latest_climb_value,
        "status": status,
    }


def sync_user_current_streak(user_id: str, climbs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    streak_data = calculate_climb_streak(climbs if climbs is not None else get_user_climbs(user_id))
    update_user_profile(user_id, {"current_streak": int(streak_data.get("current_streak") or 0)})
    refreshed_profile = get_user_profile(user_id)
    if refreshed_profile is not None:
        streak_data["profile"] = refreshed_profile
    return streak_data


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


def get_peak_climbers_with_profiles(peak_id: Any, limit: Optional[int] = 5) -> List[Dict[str, Any]]:
    climbs = _query_peak_climb_rows(
        peak_id,
        limit=limit,
        select_clause="*, profiles(*)",
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


def _query_recent_rows_with_profiles(
    table_name: str,
    order_fields: tuple[str, ...],
    limit: int,
) -> List[Dict[str, Any]]:
    normalized_limit = max(int(limit or 0), 0)
    if normalized_limit <= 0:
        return []

    select_variants = ("*, profiles(*)", "*")
    for select_clause in select_variants:
        for order_field in order_fields:
            try:
                query = _table(table_name)
                if query is None:
                    return []
                response = query.select(select_clause).order(order_field, desc=True).limit(normalized_limit).execute()
                return _enrich_user_records(response.data or [])
            except Exception:
                continue

    return []


def _build_community_feed_item(record: Dict[str, Any], action_type: str, peaks_by_id: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    current_record = dict(record or {})
    profile = dict(current_record.get("profile") or {})
    if not profile or not _is_profile_public(profile):
        return None

    user_id = str(current_record.get("user_id") or profile.get("id") or "").strip()
    display_name = str(
        current_record.get("display_name")
        or profile.get("display_name")
        or (user_id[:8] if user_id else "Climber")
    ).strip() or "Climber"

    peak_id = current_record.get("peak_id")
    peak = dict(peaks_by_id.get(str(peak_id)) or {})
    peak_name = str(
        current_record.get("peak_name")
        or peak.get("name")
        or (f"Peak #{peak_id}" if peak_id is not None else "Unknown peak")
    ).strip() or "Unknown peak"

    if action_type == "bucket_list":
        activity_time = (
            current_record.get("created_at")
            or current_record.get("added_at")
            or current_record.get("date_added")
            or current_record.get("inserted_at")
        )
        action_text = "saved"
    else:
        activity_time = (
            current_record.get("date_climbed")
            or current_record.get("climbed_at")
            or current_record.get("created_at")
        )
        action_text = "climbed"

    if not activity_time:
        return None

    return {
        "action_text": action_text,
        "action_type": action_type,
        "activity_time": activity_time,
        "avatar_url": current_record.get("avatar_url") or profile.get("avatar_url"),
        "display_name": display_name,
        "peak_id": peak_id,
        "peak_name": peak_name,
        "profile": profile,
        "target_name": peak_name,
        "timestamp": _timestamp_sort_value(activity_time),
        "user_id": user_id,
    }


def _build_community_feed(limit: int) -> List[Dict[str, Any]]:
    normalized_limit = max(int(limit or 0), 0)
    if normalized_limit <= 0:
        return []

    peaks_by_id = {
        str(peak.get("id")): peak
        for peak in get_all_peaks()
        if peak.get("id") is not None
    }
    climb_rows = _query_recent_rows_with_profiles(
        TABLE_CLIMBS,
        ("date_climbed", "climbed_at", "created_at"),
        normalized_limit,
    )
    bucket_rows = _query_recent_rows_with_profiles(
        TABLE_BUCKET_LIST,
        ("created_at", "added_at", "date_added", "inserted_at"),
        normalized_limit,
    )

    activity_items = []
    for climb in climb_rows:
        community_item = _build_community_feed_item(climb, "climb", peaks_by_id)
        if community_item is not None:
            activity_items.append(community_item)

    for bucket_item in bucket_rows:
        community_item = _build_community_feed_item(bucket_item, "bucket_list", peaks_by_id)
        if community_item is not None:
            activity_items.append(community_item)

    activity_items.sort(
        key=lambda item: (
            -float(item.get("timestamp") or 0.0),
            str(item.get("display_name") or "").lower(),
            str(item.get("target_name") or "").lower(),
        )
    )
    return activity_items[:normalized_limit]


def _get_cached_community_feed(limit: int = 10) -> List[Dict[str, Any]]:
    normalized_limit = max(int(limit or 0), 0)
    if normalized_limit <= 0:
        return []

    entry = _SHARED_QUERY_CACHE.get("community_feed") or {}
    cached_feed = entry.get("data") if _cache_is_fresh(entry) else None
    cached_limit = int(entry.get("limit") or 0)
    if isinstance(cached_feed, list) and cached_limit >= normalized_limit:
        return list(cached_feed[:normalized_limit])

    requested_limit = max(normalized_limit, SHARED_COMMUNITY_CACHE_LIMIT)
    cached_feed_limit = max(requested_limit * 2, 100)
    fresh_feed = _build_community_feed(cached_feed_limit)
    _set_cached_shared_value("community_feed", fresh_feed, limit=cached_feed_limit)
    return list(fresh_feed[:normalized_limit])


def get_community_feed(limit: int = 20) -> List[Dict[str, Any]]:
    return [
        {
            **dict(activity or {}),
            "profile": dict((activity or {}).get("profile") or {}),
        }
        for activity in _get_cached_community_feed(limit)
    ]


def _community_feed_activity_to_climb_record(activity: Dict[str, Any]) -> Dict[str, Any]:
    current_activity = dict(activity or {})
    activity_time = current_activity.get("activity_time")
    return _normalize_climb_record(
        {
            "avatar_url": current_activity.get("avatar_url"),
            "climbed_at": activity_time,
            "created_at": activity_time,
            "date_climbed": activity_time,
            "display_name": current_activity.get("display_name"),
            "peak_id": current_activity.get("peak_id"),
            "peak_name": current_activity.get("peak_name") or current_activity.get("target_name"),
            "profile": dict(current_activity.get("profile") or {}),
            "user_id": current_activity.get("user_id"),
        }
    )


def get_community_recent_climbs(limit: int = 10) -> List[Dict[str, Any]]:
    normalized_limit = max(int(limit or 0), 0)
    if normalized_limit <= 0:
        return []

    climb_records = []
    for activity in _get_cached_community_feed(max(normalized_limit * 2, SHARED_COMMUNITY_CACHE_LIMIT)):
        if str((activity or {}).get("action_type") or "").strip().lower() != "climb":
            continue
        climb_records.append(_community_feed_activity_to_climb_record(activity))
        if len(climb_records) >= normalized_limit:
            break
    return climb_records


def get_community_recent_climbs_with_profiles(limit: int = 10) -> List[Dict[str, Any]]:
    normalized_climbs = []
    for climb in get_community_recent_climbs(limit):
        current_climb = _normalize_climb_record(climb)
        current_climb["profile"] = dict(climb.get("profile") or {})
        current_climb["display_name"] = climb.get("display_name") or current_climb.get("display_name")
        current_climb["avatar_url"] = climb.get("avatar_url") or current_climb.get("avatar_url")
        normalized_climbs.append(current_climb)
    return normalized_climbs


def _coerce_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> Optional[int]:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _timestamp_sort_value(value: Any) -> float:
    parsed_value = parse_datetime_value(value)
    if parsed_value is None:
        return 0.0
    return parsed_value.timestamp()


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


def _copy_leaderboard_rows(rows: List[Dict[str, Any]], limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    selected_rows = rows if limit is None else rows[:max(int(limit or 0), 0)]
    copied_rows = []
    for row in selected_rows:
        current_row = dict(row or {})
        copied_rows.append(
            {
                **current_row,
                "highest_peak": dict(current_row.get("highest_peak") or {}),
                "profile": dict(current_row.get("profile") or {}),
            }
        )
    return copied_rows


def _copy_leaderboard_community_stats(stats: Dict[str, Any] | None) -> Dict[str, Any]:
    current_stats = dict(stats or {})
    return {
        **current_stats,
        "most_popular_peak": dict(current_stats.get("most_popular_peak") or {}),
    }


def _copy_leaderboard_popular_peaks(rows: List[Dict[str, Any]], limit: Optional[int] = 10) -> List[Dict[str, Any]]:
    selected_rows = rows if limit is None else rows[:max(int(limit or 0), 0)]
    return [dict(row or {}) for row in selected_rows]


def _empty_leaderboard_cache_payload() -> Dict[str, Any]:
    return {
        "leaderboard_community_stats": {
            "most_popular_peak": {},
            "total_climbs_logged": 0,
            "total_elevation_m": 0,
            "total_registered_users": 0,
        },
        "leaderboard_popular_peaks": [],
        "leaderboard_peaks": [],
        "leaderboard_elevation": [],
        "leaderboard_streaks": [],
    }


def _copy_leaderboard_cache_payload(payload: Dict[str, Any] | None) -> Dict[str, Any]:
    current_payload = dict(payload or {})
    return {
        "leaderboard_community_stats": _copy_leaderboard_community_stats(
            current_payload.get("leaderboard_community_stats")
        ),
        "leaderboard_popular_peaks": _copy_leaderboard_popular_peaks(
            current_payload.get("leaderboard_popular_peaks") or [],
            limit=None,
        ),
        "leaderboard_peaks": _copy_leaderboard_rows(current_payload.get("leaderboard_peaks") or [], limit=None),
        "leaderboard_elevation": _copy_leaderboard_rows(current_payload.get("leaderboard_elevation") or [], limit=None),
        "leaderboard_streaks": _copy_leaderboard_rows(current_payload.get("leaderboard_streaks") or [], limit=None),
    }


def _normalize_leaderboard_category(category: str | None) -> str:
    normalized = str(category or "").strip().lower()
    category_lookup = {
        "peak_count": "leaderboard_peaks",
        "peaks": "leaderboard_peaks",
        "leaderboard_peaks": "leaderboard_peaks",
        "elevation": "leaderboard_elevation",
        "height": "leaderboard_elevation",
        "leaderboard_elevation": "leaderboard_elevation",
        "streak": "leaderboard_streaks",
        "streaks": "leaderboard_streaks",
        "leaderboard_streaks": "leaderboard_streaks",
    }
    return category_lookup.get(normalized, "leaderboard_peaks")


def _build_leaderboard_cache_payload() -> Dict[str, Any]:
    try:
        climbs_query = _table(TABLE_CLIMBS)
        profiles_query = _table(TABLE_PROFILES)
        if climbs_query is None or profiles_query is None:
            return _empty_leaderboard_cache_payload()

        climbs_response = climbs_query.select("*").execute()
        profiles_response = profiles_query.select("*").execute()
        all_climbs = [_normalize_climb_record(climb) for climb in (climbs_response.data or [])]
        profiles_by_id = {
            str(profile.get("id")): dict(profile or {})
            for profile in (profiles_response.data or [])
            if profile.get("id") is not None
        }
        peaks_by_id = {
            str(peak.get("id")): peak
            for peak in get_all_peaks()
            if peak.get("id") is not None
        }

        total_elevation_logged_m = 0.0
        peak_climb_counts: Dict[str, Dict[str, Any]] = {}
        user_stats: Dict[str, Dict[str, Any]] = {}
        for climb in all_climbs:
            peak_id = str(climb.get("peak_id") or "").strip()
            peak = peaks_by_id.get(peak_id) or {}
            peak_height = _coerce_float(peak.get("height_m") or peak.get("height"))
            peak_height_ft = _coerce_float(peak.get("height_ft"))
            peak_name = str(peak.get("name") or climb.get("peak_name") or f"Peak #{peak_id}").strip() if peak_id else ""

            if peak_height is not None:
                total_elevation_logged_m += peak_height

            if peak_id:
                peak_stats = peak_climb_counts.setdefault(
                    peak_id,
                    {
                        "height_ft": int(round(peak_height_ft)) if peak_height_ft is not None else None,
                        "height_m": int(round(peak_height)) if peak_height is not None else None,
                        "id": peak.get("id") or climb.get("peak_id") or peak_id,
                        "name": peak_name or f"Peak #{peak_id}",
                        "total_climbs": 0,
                    },
                )
                peak_stats["total_climbs"] += 1
                if peak_stats.get("height_ft") is None and peak_height_ft is not None:
                    peak_stats["height_ft"] = int(round(peak_height_ft))
                if peak_stats.get("height_m") is None and peak_height is not None:
                    peak_stats["height_m"] = int(round(peak_height))
                if not str(peak_stats.get("name") or "").strip() and peak_name:
                    peak_stats["name"] = peak_name

            user_id = str(climb.get("user_id") or "").strip()
            if not user_id:
                continue

            profile = profiles_by_id.get(user_id) or {}
            if not _is_profile_public(profile):
                continue

            display_name = (
                profile.get("display_name")
                or climb.get("display_name")
                or user_id[:8]
            )
            stats = user_stats.setdefault(
                user_id,
                {
                    "user_id": user_id,
                    "profile": profile,
                    "display_name": str(display_name or user_id[:8]).strip() or user_id[:8],
                    "avatar_url": profile.get("avatar_url"),
                    "distinct_peak_ids": set(),
                    "total_climbs": 0,
                    "total_elevation_m": 0.0,
                    "highest_peak": None,
                    "climbs": [],
                    "last_climb_at": None,
                },
            )
            stats["total_climbs"] += 1
            stats["climbs"].append(climb)

            if peak_id and peak_id not in stats["distinct_peak_ids"]:
                stats["distinct_peak_ids"].add(peak_id)
                peak_name = peak_name or f"Peak #{peak_id}"
                if peak_height is not None:
                    stats["total_elevation_m"] += peak_height
                    highest_peak = stats.get("highest_peak") or {}
                    highest_peak_height = _coerce_float(highest_peak.get("height_m"))
                    if (
                        highest_peak_height is None
                        or peak_height > highest_peak_height
                        or (
                            peak_height == highest_peak_height
                            and peak_name.lower() < str(highest_peak.get("name") or "").lower()
                        )
                    ):
                        stats["highest_peak"] = {
                            "id": peak.get("id") or climb.get("peak_id") or peak_id,
                            "name": peak_name,
                            "height_m": int(round(peak_height)),
                            "height_ft": int(round(peak_height_ft)) if peak_height_ft is not None else None,
                        }

            climb_time = climb.get("date_climbed") or climb.get("climbed_at") or climb.get("created_at")
            if _timestamp_sort_value(climb_time) >= _timestamp_sort_value(stats["last_climb_at"]):
                stats["last_climb_at"] = climb_time

        leaderboard_rows = []
        for stats in user_stats.values():
            profile_current_streak = _coerce_int((stats.get("profile") or {}).get("current_streak"))
            fallback_streak_data = calculate_climb_streak(stats["climbs"]) if profile_current_streak is None else {}
            leaderboard_rows.append(
                {
                    "user_id": stats["user_id"],
                    "profile": stats["profile"],
                    "display_name": stats["display_name"],
                    "avatar_url": stats["avatar_url"],
                    "peak_count": len(stats["distinct_peak_ids"]),
                    "total_climbs": int(stats["total_climbs"] or 0),
                    "total_elevation_m": int(round(stats["total_elevation_m"] or 0)),
                    "current_streak": max(int(profile_current_streak or fallback_streak_data.get("current_streak") or 0), 0),
                    "highest_peak": dict(stats.get("highest_peak") or {}),
                    "last_climb_at": stats["last_climb_at"],
                }
            )

        leaderboard_peaks = sorted(
            leaderboard_rows,
            key=lambda row: (
                -int(row.get("peak_count") or 0),
                -int(row.get("total_climbs") or 0),
                -_timestamp_sort_value(row.get("last_climb_at")),
                str(row.get("display_name") or "").lower(),
            ),
        )
        leaderboard_elevation = sorted(
            leaderboard_rows,
            key=lambda row: (
                -int(row.get("total_elevation_m") or 0),
                -int(row.get("peak_count") or 0),
                -_timestamp_sort_value(row.get("last_climb_at")),
                str(row.get("display_name") or "").lower(),
            ),
        )
        leaderboard_streaks = sorted(
            leaderboard_rows,
            key=lambda row: (
                -int(row.get("current_streak") or 0),
                -int(row.get("peak_count") or 0),
                -_timestamp_sort_value(row.get("last_climb_at")),
                str(row.get("display_name") or "").lower(),
            ),
        )

        sorted_peak_counts = sorted(
            peak_climb_counts.values(),
            key=lambda peak: (
                -int(peak.get("total_climbs") or 0),
                str(peak.get("name") or "").lower(),
                str(peak.get("id") or ""),
            ),
        )
        popular_peaks = [
            {
                **dict(peak or {}),
                "rank": index + 1,
            }
            for index, peak in enumerate(sorted_peak_counts)
        ]
        most_popular_peak = dict(popular_peaks[0]) if popular_peaks else {}

        payload = _empty_leaderboard_cache_payload()
        payload["leaderboard_community_stats"] = {
            "most_popular_peak": most_popular_peak,
            "total_climbs_logged": len(all_climbs),
            "total_elevation_m": int(round(total_elevation_logged_m or 0)),
            "total_registered_users": len(profiles_by_id),
        }
        payload["leaderboard_popular_peaks"] = popular_peaks
        for key, rows in (
            ("leaderboard_peaks", leaderboard_peaks),
            ("leaderboard_elevation", leaderboard_elevation),
            ("leaderboard_streaks", leaderboard_streaks),
        ):
            payload[key] = [
                {
                    **row,
                    "rank": index + 1,
                }
                for index, row in enumerate(rows)
            ]
        return payload
    except Exception:
        return _empty_leaderboard_cache_payload()


def _get_cached_leaderboard_payload() -> Dict[str, Any]:
    if all(_cache_is_fresh(_SHARED_QUERY_CACHE.get(key)) for key in SHARED_LEADERBOARD_CACHE_KEYS):
        return _copy_leaderboard_cache_payload(
            {
                key: _SHARED_QUERY_CACHE.get(key, {}).get("data")
                for key in SHARED_LEADERBOARD_CACHE_KEYS
            }
        )

    payload = _build_leaderboard_cache_payload()
    for key in SHARED_LEADERBOARD_CACHE_KEYS:
        _set_cached_shared_value(key, payload.get(key) or [])
    return _copy_leaderboard_cache_payload(payload)


def get_leaderboard_community_stats() -> Dict[str, Any]:
    return _copy_leaderboard_community_stats(
        _get_cached_leaderboard_payload().get("leaderboard_community_stats")
    )


def get_leaderboard_popular_peaks(limit: Optional[int] = 10) -> List[Dict[str, Any]]:
    rows = _get_cached_leaderboard_payload().get("leaderboard_popular_peaks") or []
    return _copy_leaderboard_popular_peaks(rows, limit=limit)


def get_leaderboard_peaks(limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    rows = _get_cached_leaderboard_payload().get("leaderboard_peaks") or []
    return _copy_leaderboard_rows(rows, limit=limit)


def get_leaderboard_elevation(limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    rows = _get_cached_leaderboard_payload().get("leaderboard_elevation") or []
    return _copy_leaderboard_rows(rows, limit=limit)


def get_leaderboard_streaks(limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    rows = _get_cached_leaderboard_payload().get("leaderboard_streaks") or []
    return _copy_leaderboard_rows(rows, limit=limit)


def get_user_rank(user_id: str, category: str) -> Optional[int]:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return None

    rows = _get_cached_leaderboard_payload().get(_normalize_leaderboard_category(category)) or []
    for row in rows:
        if str((row or {}).get("user_id") or "").strip() == normalized_user_id:
            rank_value = _coerce_int((row or {}).get("rank"))
            return max(rank_value or 0, 1) if rank_value is not None else None
    return None


def get_cached_leaderboard_peaks(limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    return get_leaderboard_peaks(limit=limit)


def get_cached_leaderboard_elevation(limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    return get_leaderboard_elevation(limit=limit)


def get_cached_leaderboard_streaks(limit: Optional[int] = 25) -> List[Dict[str, Any]]:
    return get_leaderboard_streaks(limit=limit)


def get_dashboard_context(user_id: str, community_limit: int = 250) -> Dict[str, Any]:
    peaks = get_all_peaks()
    climbs = get_user_climbs(user_id)
    bucket_items = get_user_bucket_list(user_id)
    badges = get_user_badges(user_id)
    community_feed = get_community_feed(limit=community_limit)
    community_climbs = get_community_recent_climbs_with_profiles(limit=community_limit)

    peaks_by_id = {
        peak.get("id"): peak
        for peak in peaks
        if peak.get("id") is not None
    }
    climbed_peak_ids = {
        str(climb.get("peak_id"))
        for climb in climbs
        if climb.get("peak_id") is not None
    }
    bucket_peak_ids = {
        str(item.get("peak_id"))
        for item in bucket_items
        if item.get("peak_id") is not None
    }

    peak_statuses: Dict[str, str] = {}
    for peak in peaks:
        peak_id = peak.get("id")
        if peak_id is None:
            continue

        peak_key = str(peak_id)
        if peak_key in climbed_peak_ids:
            peak_statuses[peak_key] = "climbed"
        elif peak_key in bucket_peak_ids:
            peak_statuses[peak_key] = "bucket_listed"
        else:
            peak_statuses[peak_key] = "not_attempted"

    return {
        "all_peaks": peaks,
        "badges": badges,
        "bucket_items": bucket_items,
        "climbs": climbs,
        "community_feed": community_feed,
        "community_climbs": community_climbs,
        "peak_statuses": peak_statuses,
        "peaks_by_id": peaks_by_id,
    }


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
        response = _execute_bucket_list_query(
            lambda query: query.select("*").eq("user_id", user_id).execute()
        )
        return response.data or []
    except Exception:
        return []


def add_to_bucket_list(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        payload = {"user_id": user_id, "peak_id": peak_id}
        response = _execute_bucket_list_query(
            lambda query: query.insert(payload).execute()
        )
        return response.data[0] if response.data else None
    except Exception:
        logging.getLogger(__name__).exception(
            "Failed to add peak %s to bucket list for user %s.",
            peak_id,
            user_id,
        )
        return None


def remove_from_bucket_list(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        response = _execute_bucket_list_query(
            lambda query: query.delete().eq("user_id", user_id).eq("peak_id", peak_id).execute()
        )
        return response.data[0] if response.data else None
    except Exception:
        return None


def is_bucket_listed(user_id: str, peak_id: Any) -> Optional[Dict[str, Any]]:
    try:
        response = _execute_bucket_list_query(
            lambda query: query.select("*").eq("user_id", user_id).eq("peak_id", peak_id).limit(1).execute()
        )
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
        select_clause="*, profiles(*)",
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


def get_index_page_data(user_id: Optional[str], recent_limit: int = 4) -> Dict[str, Any]:
    all_peaks = get_all_peaks()
    peak_ids = [peak.get("id") for peak in all_peaks if peak.get("id") is not None]
    return {
        "all_peaks": all_peaks,
        "peak_statuses": get_peak_statuses(user_id or "", peak_ids),
        "peaks_by_id": {
            peak.get("id"): peak
            for peak in all_peaks
            if peak.get("id") is not None
        },
        "recent_climbs": get_community_recent_climbs(limit=recent_limit),
    }


def get_map_page_data(user_id: Optional[str]) -> Dict[str, Any]:
    all_peaks = get_all_peaks()
    peak_ids = [peak.get("id") for peak in all_peaks if peak.get("id") is not None]
    return {
        "all_peaks": all_peaks,
        "peak_statuses": get_peak_statuses(user_id or "", peak_ids),
    }


def get_search_page_data(query: Any) -> Dict[str, Any]:
    return search_site_catalog(
        query,
        peak_limit=None,
        user_limit=None,
        county_limit=None,
    )


def get_achievements_page_data(user_id: str) -> Dict[str, Any]:
    return {
        "all_peaks": get_all_peaks(),
        "badges": get_user_badges(user_id),
        "climbs": get_user_climbs(user_id),
    }


def get_leaderboard_page_data(highlight_display_name: str = "") -> Dict[str, Any]:
    normalized_name = str(highlight_display_name or "").strip()
    highlighted_profile = get_profile_by_display_name(normalized_name) if normalized_name else None
    return {
        "highlighted_profile": highlighted_profile,
        "leaderboard_community_stats": get_leaderboard_community_stats(),
        "leaderboard_elevation": get_leaderboard_elevation(limit=None),
        "leaderboard_peaks": get_leaderboard_peaks(limit=None),
        "leaderboard_popular_peaks": get_leaderboard_popular_peaks(limit=10),
        "leaderboard_streaks": get_leaderboard_streaks(limit=None),
    }


def get_counties_page_data(user_id: Optional[str]) -> Dict[str, Any]:
    climbs = get_user_climbs(user_id) if user_id else []
    return {
        "climbed_peak_ids": {
            climb.get("peak_id")
            for climb in climbs
            if climb.get("peak_id") is not None
        },
        "peaks": get_all_peaks(sort_by="county"),
    }


def get_my_climbs_page_data(user_id: str) -> Dict[str, Any]:
    return {
        "climb_history": get_user_climb_history(user_id),
    }


def get_my_activity_page_data(user_id: str) -> Dict[str, Any]:
    return get_dashboard_context(user_id, community_limit=0)


def get_my_bucket_list_page_data(user_id: str) -> Dict[str, Any]:
    all_peaks = get_all_peaks()
    bucket_items = get_user_bucket_list(user_id)
    peak_ids = [item.get("peak_id") for item in bucket_items if item.get("peak_id") is not None]
    return {
        "all_peaks": all_peaks,
        "bucket_items": bucket_items,
        "peak_statuses": get_peak_statuses(user_id, peak_ids),
    }


def get_summit_list_page_data(user_id: Optional[str]) -> Dict[str, Any]:
    peaks = get_all_peaks()
    peak_ids = [peak.get("id") for peak in peaks if peak.get("id") is not None]
    return {
        "peak_statuses": get_peak_statuses(user_id or "", peak_ids),
        "peaks": peaks,
    }


def get_peak_detail_page_data(user_id: Optional[str], peak_id: Any) -> Dict[str, Any]:
    peak = get_peak_by_id(peak_id)
    all_peaks = get_all_peaks() if peak is not None else []
    has_climbed_entry = get_user_has_climbed(user_id, peak_id) if user_id and peak is not None else None
    bucket_entry = is_bucket_listed(user_id, peak_id) if user_id and peak is not None else None
    user_peak_climbs = get_user_peak_climbs(user_id, peak_id) if user_id and peak is not None else []
    climber_rows = get_peak_climbers_with_profiles(peak_id, limit=None) if peak is not None else []
    comments = get_peak_comments_with_profiles(peak_id) if peak is not None else []
    avg_difficulty = get_peak_average_difficulty(peak_id) if peak is not None else None

    related_peaks = []
    related_peak_statuses: Dict[str, str] = {}
    if peak is not None:
        current_peak_id = peak.get("id")
        range_area = str(peak.get("range_area") or "").strip().lower()
        county = str(peak.get("county") or "").strip().lower()
        related_peaks = [
            current_peak
            for current_peak in all_peaks
            if current_peak.get("id") != current_peak_id
            and (
                (range_area and str(current_peak.get("range_area") or "").strip().lower() == range_area)
                or (county and str(current_peak.get("county") or "").strip().lower() == county)
            )
        ]
        if user_id and related_peaks:
            related_peak_statuses = get_peak_statuses(
                user_id,
                [current_peak.get("id") for current_peak in related_peaks if current_peak.get("id") is not None],
            )

    return {
        "all_peaks": all_peaks,
        "avg_difficulty": avg_difficulty,
        "bucket_entry": bucket_entry,
        "climber_rows": climber_rows,
        "comments": comments,
        "has_climbed_entry": has_climbed_entry,
        "peak": peak,
        "related_peak_statuses": related_peak_statuses,
        "user_peak_climbs": user_peak_climbs,
    }


def get_public_profile_page_data(display_name: str, current_user_id: Optional[str]) -> Dict[str, Any]:
    profile_record = get_profile_by_display_name(display_name)
    profile_user_id = str((profile_record or {}).get("id") or "").strip()
    return {
        "all_peaks": get_all_peaks() if profile_record is not None else [],
        "current_profile": get_user_profile(current_user_id) if current_user_id else None,
        "profile_badges": get_user_badges(profile_user_id) if profile_user_id else [],
        "profile_climbs": get_user_climb_history(profile_user_id) if profile_user_id else [],
        "profile_record": profile_record,
    }


def get_badge_share_page_data(display_name: str) -> Dict[str, Any]:
    profile_record = get_profile_by_display_name(display_name)
    profile_user_id = str((profile_record or {}).get("id") or "").strip()
    return {
        "earned_badges": get_user_badges(profile_user_id) if profile_user_id else [],
        "profile_record": profile_record,
    }


def get_profile_compare_page_data(name1: str, name2: str) -> Dict[str, Any]:
    left_profile = get_profile_by_display_name(name1)
    right_profile = get_profile_by_display_name(name2)
    left_user_id = str((left_profile or {}).get("id") or "").strip()
    right_user_id = str((right_profile or {}).get("id") or "").strip()
    return {
        "all_peaks": get_all_peaks() if left_profile is not None and right_profile is not None else [],
        "left_badges": get_user_badges(left_user_id) if left_user_id else [],
        "left_climbs": get_user_climb_history(left_user_id) if left_user_id else [],
        "left_profile": left_profile,
        "right_badges": get_user_badges(right_user_id) if right_user_id else [],
        "right_climbs": get_user_climb_history(right_user_id) if right_user_id else [],
        "right_profile": right_profile,
    }
