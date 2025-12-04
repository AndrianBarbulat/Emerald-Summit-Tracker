from __future__ import annotations

from badges import check_badges
from supabase_utils import TABLE_CLIMBS, supabase


BATCH_SIZE = 1000


def fetch_user_ids_with_climbs(batch_size: int = BATCH_SIZE) -> list[str]:
    if supabase is None:
        raise RuntimeError("Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY before running this script.")

    user_ids: set[str] = set()
    start_index = 0

    while True:
        response = (
            supabase.table(TABLE_CLIMBS)
            .select("user_id")
            .order("user_id")
            .range(start_index, start_index + batch_size - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break

        for row in rows:
            user_id = str((row or {}).get("user_id") or "").strip()
            if user_id:
                user_ids.add(user_id)

        if len(rows) < batch_size:
            break

        start_index += batch_size

    return sorted(user_ids)


def award_retroactive_badges() -> tuple[int, int]:
    user_ids = fetch_user_ids_with_climbs()
    total_badges_awarded = 0
    users_awarded = 0

    if not user_ids:
        print("No users with climbs found.")
        print("Awarded 0 badges across 0 users.")
        return 0, 0

    total_users = len(user_ids)
    for index, user_id in enumerate(user_ids, start=1):
        newly_awarded = check_badges(user_id)
        if not newly_awarded:
            continue

        total_badges_awarded += len(newly_awarded)
        users_awarded += 1
        print(
            f"[{index}/{total_users}] {user_id}: awarded {len(newly_awarded)} badge(s) "
            f"({', '.join(newly_awarded)})"
        )

    print(f"Awarded {total_badges_awarded} badges across {users_awarded} users.")
    return total_badges_awarded, users_awarded


def main() -> int:
    try:
        award_retroactive_badges()
        return 0
    except Exception as exc:
        print(f"Retroactive badge award failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
