from flask import Blueprint, abort, render_template, request

from supabase_utils import get_leaderboard_page_data, get_profile_compare_page_data
from view_helpers import build_compare_profiles_page_context, build_leaderboard_page_context, is_profile_public
from web_utils import current_height_unit_for_preference, get_session_context, set_active_page


community = Blueprint("community", __name__)


@community.route("/leaderboard")
def leaderboard():
    context = get_session_context()
    current_user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_leaderboard_page_data(str(request.args.get("highlight") or "").strip())
    set_active_page("leaderboard")
    return render_template(
        "leaderboard.html",
        **build_leaderboard_page_context(
            page_data,
            current_user_id,
            current_height_unit_for_preference(context["profile"]),
            str(request.args.get("tab") or "peaks").strip().lower() or "peaks",
        ),
    )


@community.route("/compare/<name1>/<name2>")
def compare_profiles(name1: str, name2: str):
    page_data = get_profile_compare_page_data(name1, name2)
    left_profile = page_data.get("left_profile")
    right_profile = page_data.get("right_profile")
    if left_profile is None or right_profile is None:
        abort(404)
    if not is_profile_public(left_profile) or not is_profile_public(right_profile):
        abort(404)

    set_active_page("profile")
    return render_template("profile_compare.html", **build_compare_profiles_page_context(page_data))
