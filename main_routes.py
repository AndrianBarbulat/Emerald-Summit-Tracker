from flask import Blueprint, current_app, redirect, render_template, request, url_for

from supabase_utils import get_dashboard_context, get_index_page_data, get_map_page_data, get_search_page_data
from view_helpers import (
    build_home_page_context,
    build_index_page_context,
    build_map_page_context,
    build_search_page_context,
)
from web_utils import get_session_context, mark_badge_notifications_seen, set_active_page


main = Blueprint("main", __name__)


@main.route("/")
def index():
    context = get_session_context()
    user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_index_page_data(user_id)
    set_active_page("index")
    return render_template("index.html", **build_index_page_context(page_data, context["profile"]))


@main.route("/home")
def home():
    context = get_session_context()
    if not context["profile"]:
        return redirect(url_for("index"))

    mark_badge_notifications_seen()
    user_id = str(context["profile"].get("id") or "").strip()
    page_data = get_dashboard_context(user_id)
    set_active_page("dashboard")
    return render_template("home.html", **build_home_page_context(page_data, user_id))


@main.route("/search")
def site_search():
    context = get_session_context()
    current_user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_search_page_data(request.args.get("q"))
    set_active_page("search")
    return render_template("search.html", **build_search_page_context(page_data, current_user_id))


@main.route("/map")
def explore_map():
    context = get_session_context()
    user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_map_page_data(user_id)
    set_active_page("map")
    return render_template("map.html", **build_map_page_context(page_data, context["profile"]))


@main.route("/robots.txt")
def robots_txt():
    robots_content = "\n".join(
        [
            "User-agent: *",
            "Allow: /",
            "Disallow: /api/",
            "Disallow: /account",
        ]
    )
    return current_app.response_class(robots_content, mimetype="text/plain")
