import re


IRELAND_COUNTIES = (
    "Antrim",
    "Armagh",
    "Carlow",
    "Cavan",
    "Clare",
    "Cork",
    "Derry",
    "Donegal",
    "Down",
    "Dublin",
    "Fermanagh",
    "Galway",
    "Kerry",
    "Kildare",
    "Kilkenny",
    "Laois",
    "Leitrim",
    "Limerick",
    "Longford",
    "Louth",
    "Mayo",
    "Meath",
    "Monaghan",
    "Offaly",
    "Roscommon",
    "Sligo",
    "Tipperary",
    "Tyrone",
    "Waterford",
    "Westmeath",
    "Wexford",
    "Wicklow",
)


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _badge(
    *,
    key: str,
    name: str,
    description: str,
    icon: str,
    category: str,
    criteria: dict,
    legacy_keys: tuple[str, ...] = (),
) -> dict:
    return {
        "key": key,
        "name": name,
        "label": name,
        "description": description,
        "icon": icon,
        "category": category,
        "criteria": dict(criteria or {}),
        "legacy_keys": [str(legacy_key).strip().lower() for legacy_key in legacy_keys if str(legacy_key or "").strip()],
    }


BASE_BADGES = [
    _badge(
        key="first_summit",
        name="First Summit",
        description="Log your first climbed Irish peak.",
        icon="fa-flag-checkered",
        category="milestones",
        criteria={"type": "peak_count", "value": 1},
        legacy_keys=("first_climb",),
    ),
    _badge(
        key="five_peaks",
        name="Five Peaks",
        description="Reach five distinct climbed peaks.",
        icon="fa-mountain",
        category="milestones",
        criteria={"type": "peak_count", "value": 5},
        legacy_keys=("five_climbs",),
    ),
    _badge(
        key="ten_peaks",
        name="Ten Peaks",
        description="Reach ten distinct climbed peaks.",
        icon="fa-compass",
        category="milestones",
        criteria={"type": "peak_count", "value": 10},
        legacy_keys=("ten_climbs",),
    ),
    _badge(
        key="twentyfive_peaks",
        name="Twenty Five Peaks",
        description="Log twenty five distinct climbed peaks.",
        icon="fa-map",
        category="milestones",
        criteria={"type": "peak_count", "value": 25},
    ),
    _badge(
        key="fifty_peaks",
        name="Fifty Peaks",
        description="Log fifty distinct climbed peaks.",
        icon="fa-fire",
        category="milestones",
        criteria={"type": "peak_count", "value": 50},
    ),
    _badge(
        key="hundred_peaks",
        name="Hundred Peaks",
        description="Log one hundred distinct climbed peaks.",
        icon="fa-crown",
        category="milestones",
        criteria={"type": "peak_count", "value": 100},
    ),
    _badge(
        key="all_peaks",
        name="All Irish Peaks",
        description="Climb every tracked peak in the full Irish peak list.",
        icon="fa-award",
        category="milestones",
        criteria={"type": "all_peaks"},
    ),
    _badge(
        key="club_500m",
        name="500m Club",
        description="Climb any peak at or above 500 metres.",
        icon="fa-arrow-up-right-dots",
        category="height",
        criteria={"type": "height_min", "value": 500, "unit": "m"},
    ),
    _badge(
        key="club_750m",
        name="750m Club",
        description="Climb any peak at or above 750 metres.",
        icon="fa-arrow-trend-up",
        category="height",
        criteria={"type": "height_min", "value": 750, "unit": "m"},
    ),
    _badge(
        key="club_1000m",
        name="1000m Club",
        description="Climb any peak at or above 1000 metres.",
        icon="fa-mountain-sun",
        category="height",
        criteria={"type": "height_min", "value": 1000, "unit": "m"},
    ),
    _badge(
        key="munster_explorer",
        name="Munster Explorer",
        description="Climb at least one tracked peak in Munster.",
        icon="fa-map-pin",
        category="provinces",
        criteria={"type": "province_count", "province": "Munster", "value": 1},
    ),
    _badge(
        key="leinster_explorer",
        name="Leinster Explorer",
        description="Climb at least one tracked peak in Leinster.",
        icon="fa-map-pin",
        category="provinces",
        criteria={"type": "province_count", "province": "Leinster", "value": 1},
    ),
    _badge(
        key="ulster_explorer",
        name="Ulster Explorer",
        description="Climb at least one tracked peak in Ulster.",
        icon="fa-map-pin",
        category="provinces",
        criteria={"type": "province_count", "province": "Ulster", "value": 1},
    ),
    _badge(
        key="connacht_explorer",
        name="Connacht Explorer",
        description="Climb at least one tracked peak in Connacht.",
        icon="fa-map-pin",
        category="provinces",
        criteria={"type": "province_count", "province": "Connacht", "value": 1},
    ),
    _badge(
        key="four_provinces",
        name="Four Provinces",
        description="Climb at least one tracked peak in each Irish province.",
        icon="fa-map-location-dot",
        category="provinces",
        criteria={"type": "all_provinces", "provinces": ["Munster", "Leinster", "Ulster", "Connacht"], "value": 4},
    ),
    _badge(
        key="weekend_warrior",
        name="Weekend Warrior",
        description="Log climbs across four consecutive weekends.",
        icon="fa-calendar-week",
        category="streaks",
        criteria={"type": "streak", "mode": "weekend", "value": 4},
    ),
    _badge(
        key="month_streak",
        name="Month Streak",
        description="Climb every week for four straight weeks.",
        icon="fa-bolt",
        category="streaks",
        criteria={"type": "streak", "mode": "weekly", "value": 4},
    ),
    _badge(
        key="highpoint",
        name="High Point",
        description="Reach Carrauntoohil, Ireland's highest summit.",
        icon="fa-mountain",
        category="special",
        criteria={"type": "specific_peak", "peak_name": "Carrauntoohil"},
    ),
    _badge(
        key="bucket_buster",
        name="Bucket Buster",
        description="Complete ten climbs from your bucket list.",
        icon="fa-bookmark",
        category="special",
        criteria={"type": "bucket_completions", "value": 10},
    ),
    _badge(
        key="photographer",
        name="Photographer",
        description="Upload ten or more climb photos.",
        icon="fa-camera",
        category="special",
        criteria={"type": "photo_count", "value": 10},
    ),
]


def build_county_badges(counties: tuple[str, ...] | list[str] | None = None) -> list[dict]:
    resolved_counties = counties or IRELAND_COUNTIES
    badges = []
    for county in resolved_counties:
        normalized_county = str(county or "").strip()
        if not normalized_county:
            continue
        badges.append(
            _badge(
                key=f"all_peaks_{_slugify(normalized_county)}",
                name=f"All Peaks in {normalized_county}",
                description=f"Climb every tracked peak in {normalized_county}.",
                icon="fa-map",
                category="counties",
                criteria={"type": "county_complete", "county": normalized_county},
            )
        )
    return badges


COUNTY_BADGES = build_county_badges()
BADGES = [*BASE_BADGES, *COUNTY_BADGES]

BADGES_BY_KEY = {
    badge["key"]: badge
    for badge in BADGES
}
BADGE_ALIASES = {
    legacy_key: badge["key"]
    for badge in BADGES
    for legacy_key in badge.get("legacy_keys", [])
}


def normalize_badge_key(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return ""
    return BADGE_ALIASES.get(normalized, normalized)


def get_badge_definition(value: str | None) -> dict | None:
    return BADGES_BY_KEY.get(normalize_badge_key(value))


BADGE_LABELS = {}
BADGE_ICON_LOOKUP = {}
for badge in BADGES:
    badge_key = badge["key"]
    BADGE_LABELS[badge_key] = badge["name"]
    BADGE_ICON_LOOKUP[badge_key] = badge["icon"]
    for legacy_key in badge.get("legacy_keys", []):
        BADGE_LABELS[legacy_key] = badge["name"]
        BADGE_ICON_LOOKUP[legacy_key] = badge["icon"]


DASHBOARD_BADGE_RULES = [
    {
        "key": badge["key"],
        "label": badge["name"],
        "threshold": int(badge["criteria"]["value"]),
        "icon": badge["icon"],
    }
    for badge in BASE_BADGES
    if badge["criteria"].get("type") == "peak_count"
]

AUTO_AWARD_BADGE_RULES = list(DASHBOARD_BADGE_RULES)
