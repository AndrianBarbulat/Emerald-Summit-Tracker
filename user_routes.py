from flask import Blueprint, abort, redirect, render_template, request, session, url_for

from supabase_utils import get_achievements_page_data, get_badge_share_page_data, get_my_activity_page_data, get_my_bucket_list_page_data, get_my_climbs_page_data, get_public_profile_page_data
from view_helpers import (
    build_achievements_page_context,
    build_badge_share_page_context,
    build_my_activity_page_context,
    build_my_bucket_list_page_context,
    build_my_climbs_page_context,
    build_public_profile_page_context,
)
from web_utils import get_session_context, mark_badge_notifications_seen, set_active_page


users = Blueprint("users", __name__)


@users.route("/achievements")
def achievements():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    mark_badge_notifications_seen()
    user_id = str(context["profile"].get("id") or "").strip()
    page_data = get_achievements_page_data(user_id)
    set_active_page("achievements")
    return render_template("achievements.html", **build_achievements_page_context(page_data, user_id))


@users.route("/my-climbs")
def my_climbs():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    user_id = str(context["profile"].get("id") or "").strip()
    set_active_page("my_climbs")
    return render_template(
        "my_climbs.html",
        **build_my_climbs_page_context(
            get_my_climbs_page_data(user_id),
            "map" if str(request.args.get("view") or "").strip().lower() == "map" else "list",
            str(request.args.get("year") or "").strip(),
            str(request.args.get("month") or "").strip(),
            str(request.args.get("q") or "").strip(),
        ),
    )


@users.route("/my-activity")
def my_activity():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    user_id = str(context["profile"].get("id") or "").strip()
    try:
        current_page = max(int(request.args.get("page") or 1), 1)
    except (TypeError, ValueError):
        current_page = 1

    set_active_page("dashboard")
    return render_template(
        "my_activity.html",
        **build_my_activity_page_context(
            get_my_activity_page_data(user_id),
            str(request.args.get("type") or "all").strip().lower() or "all",
            str(request.args.get("date_from") or "").strip(),
            str(request.args.get("date_to") or "").strip(),
            current_page,
        ),
    )


@users.route("/my-bucket-list")
def my_bucket_list():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    user_id = str(context["profile"].get("id") or "").strip()
    set_active_page("my_bucket_list")
    return render_template(
        "my_bucket_list.html",
        **build_my_bucket_list_page_context(
            get_my_bucket_list_page_data(user_id),
            "map" if str(request.args.get("view") or "").strip().lower() == "map" else "list",
            str(request.args.get("sort") or "date_added").strip().lower() or "date_added",
        ),
    )


@users.route("/profile/me")
def my_profile():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    display_name = str(context["profile"].get("display_name") or "").strip()
    if not display_name:
        return redirect(url_for("account_settings"))
    return redirect(url_for("public_profile", display_name=display_name))


@users.route("/profile/<display_name>")
def public_profile(display_name: str):
    context = get_session_context()
    current_user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_public_profile_page_data(display_name, current_user_id)
    if page_data.get("profile_record") is None:
        abort(404)

    set_active_page("profile")
    return render_template(
        "profile_public.html",
        **build_public_profile_page_context(
            page_data,
            current_user_id,
            "map" if str(request.args.get("view") or "").strip().lower() == "map" else "list",
        ),
    )


@users.route("/badge/<badge_key>/<display_name>")
def badge_share(badge_key: str, display_name: str):
    page_data = get_badge_share_page_data(display_name)
    if page_data.get("profile_record") is None:
        abort(404)

    page_context = build_badge_share_page_context(page_data, badge_key, display_name, bool(session.get("profile")))
    if page_context is None:
        abort(404)

    set_active_page("")
    return render_template("badge_share.html", **page_context)


@users.route("/account")
def account_settings():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    set_active_page("account")
    return render_template("account_profile.html")
