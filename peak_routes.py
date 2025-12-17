from flask import Blueprint, abort, render_template

from supabase_utils import get_counties_page_data, get_peak_detail_page_data, get_summit_list_page_data
from view_helpers import (
    build_counties_page_context,
    build_peak_detail_page_context,
    build_summit_list_page_context,
    track_recently_viewed_peak,
)
from web_utils import get_session_context, set_active_page


peaks = Blueprint("peaks", __name__)


@peaks.route("/summit-list")
def summit_list():
    context = get_session_context()
    user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_summit_list_page_data(user_id)
    set_active_page("summits")
    return render_template("summit_list.html", **build_summit_list_page_context(page_data, context["profile"]))


@peaks.route("/peak/<int:peak_id>")
def peak_detail(peak_id: int):
    context = get_session_context()
    current_user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_peak_detail_page_data(current_user_id, peak_id)
    if page_data.get("peak") is None:
        abort(404)

    track_recently_viewed_peak(page_data.get("peak"))
    set_active_page("summit_list")
    return render_template("peak_detail.html", **build_peak_detail_page_context(page_data, current_user_id))


@peaks.route("/counties")
def counties():
    context = get_session_context()
    user_id = str((context["profile"] or {}).get("id") or "").strip() or None
    page_data = get_counties_page_data(user_id)
    set_active_page("counties")
    return render_template("counties.html", **build_counties_page_context(page_data))
