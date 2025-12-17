from __future__ import annotations

import time
from datetime import datetime
from typing import Any

import requests


OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PEAK_WEATHER_CACHE_TTL_SECONDS = 1800
_PEAK_WEATHER_CACHE: dict[str, dict[str, Any]] = {}


def _peak_key(value: Any) -> str:
    return str(value) if value is not None else ""


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_weather_code(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _weather_summary_from_code(weather_code: Any) -> dict[str, str]:
    normalized_code = _normalize_weather_code(weather_code)
    if normalized_code == 0:
        return {"description": "Clear", "icon": "fa-sun", "tone": "clear"}
    if normalized_code is not None and 1 <= normalized_code <= 3:
        return {"description": "Cloudy", "icon": "fa-cloud", "tone": "cloudy"}
    if normalized_code is not None and 45 <= normalized_code <= 48:
        return {"description": "Fog", "icon": "fa-smog", "tone": "fog"}
    if normalized_code is not None and 51 <= normalized_code <= 67:
        return {"description": "Rain", "icon": "fa-cloud-rain", "tone": "rain"}
    if normalized_code is not None and 71 <= normalized_code <= 77:
        return {"description": "Snow", "icon": "fa-snowflake", "tone": "snow"}
    if normalized_code is not None and normalized_code >= 80:
        return {"description": "Storm", "icon": "fa-bolt", "tone": "storm"}
    return {"description": "Weather", "icon": "fa-cloud", "tone": "default"}


def _is_snow_weather_code(weather_code: Any) -> bool:
    normalized_code = _normalize_weather_code(weather_code)
    return normalized_code is not None and 71 <= normalized_code <= 77


def _is_storm_weather_code(weather_code: Any) -> bool:
    normalized_code = _normalize_weather_code(weather_code)
    return normalized_code is not None and normalized_code >= 80


def _format_temperature_c(value: Any) -> str:
    numeric_value = _to_float(value)
    return f"{int(round(numeric_value))}\N{DEGREE SIGN}C" if numeric_value is not None else "--"


def _format_wind_speed_kmh(value: Any) -> str:
    numeric_value = _to_float(value)
    return f"{int(round(numeric_value))} km/h" if numeric_value is not None else "--"


def _parse_weather_datetime(value: str | None) -> datetime | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None

    try:
        return datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _peak_weather_cache_is_fresh(entry: dict[str, Any] | None) -> bool:
    if not isinstance(entry, dict):
        return False
    cached_at = float(entry.get("timestamp") or 0)
    return (time.time() - cached_at) < PEAK_WEATHER_CACHE_TTL_SECONDS


def _peak_weather_unavailable_payload(peak_name: str, message: str = "Weather data unavailable") -> dict[str, Any]:
    resolved_peak_name = str(peak_name or "this peak").strip() or "this peak"
    return {
        "available": False,
        "current": None,
        "forecast": [],
        "message": message,
        "title": f"Current Conditions at {resolved_peak_name}",
    }


def _select_representative_weather_code(code_points: list[tuple[int, int]]) -> int | None:
    if not code_points:
        return None
    return min(
        code_points,
        key=lambda code_point: (abs(int(code_point[0]) - 12), int(code_point[0])),
    )[1]


def _build_peak_weather_forecast(hourly_data: dict[str, Any] | None) -> list[dict[str, Any]]:
    hourly = dict(hourly_data or {})
    hourly_times = hourly.get("time") or []
    hourly_temperatures = hourly.get("temperature_2m") or []
    hourly_weather_codes = hourly.get("weathercode") or []
    grouped_days: dict[str, dict[str, Any]] = {}

    for index, time_value in enumerate(hourly_times):
        timestamp = _parse_weather_datetime(time_value)
        if timestamp is None:
            continue

        day_key = timestamp.date().isoformat()
        day_entry = grouped_days.setdefault(
            day_key,
            {
                "date": timestamp.date(),
                "temperatures": [],
                "weather_codes": [],
            },
        )

        if index < len(hourly_temperatures):
            temperature_value = _to_float(hourly_temperatures[index])
            if temperature_value is not None:
                day_entry["temperatures"].append(temperature_value)

        if index < len(hourly_weather_codes):
            weather_code = _normalize_weather_code(hourly_weather_codes[index])
            if weather_code is not None:
                day_entry["weather_codes"].append((timestamp.hour, weather_code))

    forecast_days: list[dict[str, Any]] = []
    for day_key in sorted(grouped_days.keys())[:3]:
        day_entry = grouped_days[day_key]
        temperatures = day_entry.get("temperatures") or []
        representative_code = _select_representative_weather_code(day_entry.get("weather_codes") or [])
        summary = _weather_summary_from_code(representative_code)
        high_value = max(temperatures) if temperatures else None
        low_value = min(temperatures) if temperatures else None
        forecast_days.append(
            {
                "date": day_key,
                "day_label": day_entry["date"].strftime("%a"),
                "description": summary["description"],
                "has_snow": any(_is_snow_weather_code(weather_code) for _, weather_code in (day_entry.get("weather_codes") or [])),
                "has_storm": any(_is_storm_weather_code(weather_code) for _, weather_code in (day_entry.get("weather_codes") or [])),
                "high_c": int(round(high_value)) if high_value is not None else None,
                "high_label": _format_temperature_c(high_value),
                "icon": summary["icon"],
                "low_c": int(round(low_value)) if low_value is not None else None,
                "low_label": _format_temperature_c(low_value),
                "tone": summary["tone"],
                "weather_code": representative_code,
            }
        )

    return forecast_days


def _build_peak_weather_alerts(
    current_temperature: float | None,
    current_wind_speed: float | None,
    current_weather_code: int | None,
    forecast_days: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    alerts = []
    forecast_has_snow = any(bool(day.get("has_snow")) for day in (forecast_days or []))
    forecast_has_storm = any(bool(day.get("has_storm")) for day in (forecast_days or []))

    if current_wind_speed is not None and current_wind_speed > 50:
        alerts.append(
            {
                "icon": "fa-wind",
                "key": "high_wind",
                "message": "High winds reported.",
            }
        )

    if current_temperature is not None and current_temperature < 0:
        alerts.append(
            {
                "icon": "fa-temperature-low",
                "key": "freezing",
                "message": "Freezing temperatures.",
            }
        )

    if _is_snow_weather_code(current_weather_code) or forecast_has_snow:
        alerts.append(
            {
                "icon": "fa-snowflake",
                "key": "snow",
                "message": "Snow expected.",
            }
        )

    if _is_storm_weather_code(current_weather_code) or forecast_has_storm:
        alerts.append(
            {
                "icon": "fa-bolt",
                "key": "storm",
                "message": "Storm conditions expected.",
            }
        )

    return {
        "has_alerts": bool(alerts),
        "items": alerts,
        "tone": "danger" if any(alert.get("key") in {"high_wind", "storm"} for alert in alerts) else "warning",
    }


def clear_peak_weather_cache(peak_id: Any | None = None) -> None:
    if peak_id is None:
        _PEAK_WEATHER_CACHE.clear()
        return
    _PEAK_WEATHER_CACHE.pop(_peak_key(peak_id), None)


def get_peak_weather(peak_id: int, peak_name: str, latitude: Any, longitude: Any) -> dict[str, Any]:
    cache_key = _peak_key(peak_id)
    cached_entry = _PEAK_WEATHER_CACHE.get(cache_key)
    if _peak_weather_cache_is_fresh(cached_entry):
        return dict(cached_entry.get("data") or {})

    latitude_value = _to_float(latitude)
    longitude_value = _to_float(longitude)
    if latitude_value is None or longitude_value is None:
        return _peak_weather_unavailable_payload(peak_name)

    unavailable_payload = _peak_weather_unavailable_payload(peak_name)

    try:
        response = requests.get(
            OPEN_METEO_FORECAST_URL,
            params={
                "latitude": latitude_value,
                "longitude": longitude_value,
                "current_weather": "true",
                "hourly": "temperature_2m,weathercode",
                "forecast_days": 3,
            },
            timeout=5,
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        _PEAK_WEATHER_CACHE[cache_key] = {
            "timestamp": time.time(),
            "data": unavailable_payload,
        }
        return dict(unavailable_payload)

    current_weather = dict(payload.get("current_weather") or {})
    current_temperature = _to_float(current_weather.get("temperature"))
    current_wind_speed = _to_float(current_weather.get("windspeed"))
    current_weather_code = _normalize_weather_code(current_weather.get("weathercode"))
    current_summary = _weather_summary_from_code(current_weather_code)
    forecast_days = _build_peak_weather_forecast(payload.get("hourly"))
    weather_alerts = _build_peak_weather_alerts(
        current_temperature,
        current_wind_speed,
        current_weather_code,
        forecast_days,
    )
    current_has_content = (
        current_temperature is not None
        or current_wind_speed is not None
        or current_weather_code is not None
    )

    weather_payload = {
        "available": current_has_content,
        "current": {
            "description": current_summary["description"],
            "icon": current_summary["icon"],
            "temperature_c": int(round(current_temperature)) if current_temperature is not None else None,
            "temperature_label": _format_temperature_c(current_temperature),
            "tone": current_summary["tone"],
            "wind_speed_kmh": int(round(current_wind_speed)) if current_wind_speed is not None else None,
            "wind_speed_label": _format_wind_speed_kmh(current_wind_speed),
        },
        "forecast": forecast_days,
        "alert_tone": weather_alerts["tone"],
        "alerts": weather_alerts["items"],
        "disclaimer": "Weather from Open-Meteo. Always check local conditions before heading out.",
        "has_alerts": weather_alerts["has_alerts"],
        "message": "",
        "title": f"Current Conditions at {str(peak_name or 'this peak').strip() or 'this peak'}",
    }

    if not weather_payload["available"]:
        weather_payload = unavailable_payload

    _PEAK_WEATHER_CACHE[cache_key] = {
        "timestamp": time.time(),
        "data": weather_payload,
    }
    return dict(weather_payload)
