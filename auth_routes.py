from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for

from supabase_utils import (
    auth_get_current_user,
    auth_sign_in_with_password,
    auth_sign_out,
    auth_sign_up,
    get_or_create_session_profile,
    is_display_name_conflict,
    supabase,
)
from web_utils import (
    RECENTLY_VIEWED_SESSION_KEY,
    form_error_response,
    form_success_response,
    is_email_registered_error,
    is_invalid_login_error,
    looks_like_email,
)


auth = Blueprint("auth", __name__)


@auth.route("/signup", methods=["POST"])
def signup():
    if supabase is None:
        return form_error_response("Account service is unavailable right now.", 500)

    display_name = str(request.form.get("display_name") or "").strip()
    email = str(request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    confirm_password = request.form.get("confirm_password") or ""
    field_errors = {}

    if not display_name:
        field_errors["display_name"] = "Full name is required."
    elif len(display_name) > 120:
        field_errors["display_name"] = "Full name must be 120 characters or fewer."
    if not email:
        field_errors["email"] = "Email is required."
    elif not looks_like_email(email):
        field_errors["email"] = "Please enter a valid email address."
    if not password:
        field_errors["password"] = "Password is required."
    if not confirm_password:
        field_errors["confirm_password"] = "Please confirm your password."
    elif password and confirm_password != password:
        field_errors["confirm_password"] = "Passwords must match."
    if field_errors:
        return form_error_response(next(iter(field_errors.values())), 400, fields=field_errors)

    try:
        result = auth_sign_up(email, password)
    except Exception as exc:
        error_message = str(exc)
        if is_email_registered_error(error_message):
            return form_error_response("Email already registered", 409, fields={"email": "Email already registered"})
        if is_display_name_conflict(error_message):
            return form_error_response(
                "Signup failed: your email prefix conflicts with an existing display name. Try an email with a different prefix before '@'.",
                409,
                fields={"email": "Try an email with a different prefix before '@'."},
            )
        return form_error_response("We could not create your account right now.", 400)

    if not result or not result.user:
        return form_error_response("We could not create your account right now.", 400)

    session["user"] = result.user.model_dump()
    session["profile"] = get_or_create_session_profile(
        result.user.id,
        result.user.email or email,
        logger=current_app.logger,
    )
    return form_success_response("/home")


@auth.route("/login", methods=["POST"])
def login():
    if supabase is None:
        return form_error_response("Account service is unavailable right now.", 500)

    email = str(request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    field_errors = {}

    if not email:
        field_errors["email"] = "Email is required."
    elif not looks_like_email(email):
        field_errors["email"] = "Please enter a valid email address."
    if not password:
        field_errors["password"] = "Password is required."
    if field_errors:
        return form_error_response(next(iter(field_errors.values())), 400, fields=field_errors)

    try:
        result = auth_sign_in_with_password(email, password)
    except Exception as exc:
        error_message = str(exc)
        if is_invalid_login_error(error_message):
            return form_error_response(
                "Invalid email or password",
                401,
                fields={"email": "Invalid email or password", "password": "Invalid email or password"},
            )
        return form_error_response("We could not log you in right now.", 401)

    if not result or not result.user:
        return form_error_response(
            "Invalid email or password",
            401,
            fields={"email": "Invalid email or password", "password": "Invalid email or password"},
        )

    session["user"] = result.user.model_dump()
    session["profile"] = get_or_create_session_profile(
        result.user.id,
        result.user.email or email,
        logger=current_app.logger,
    )
    return form_success_response("/home")


@auth.route("/current_user")
def current_user():
    if supabase is None:
        return "Supabase is not configured", 500

    user = auth_get_current_user()
    if not user:
        return "No user is currently logged in."

    payload = user.model_dump() if hasattr(user, "model_dump") else user
    if isinstance(payload, dict) and payload.get("user") is None:
        return "No user is currently logged in."
    return jsonify(payload)


@auth.route("/logout")
def logout():
    if supabase is not None:
        try:
            auth_sign_out()
        except Exception as exc:
            current_app.logger.warning("Supabase sign out failed: %s", exc)

    session.pop("user", None)
    session.pop("profile", None)
    session.pop(RECENTLY_VIEWED_SESSION_KEY, None)
    return redirect(url_for("index"))
