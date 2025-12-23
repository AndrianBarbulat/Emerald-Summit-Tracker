from flask import Flask

from api_routes import api
from auth_routes import auth
from community_routes import community
from main_routes import main
from peak_routes import peaks
from user_routes import users
from web_utils import (
    prime_county_peak_count_cache,
    prime_total_peak_count_cache,
    register_blueprint_with_legacy_endpoints,
    register_context_processors,
    register_error_handlers,
    register_request_hooks,
    register_template_filters,
)


def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "dev-secret-key"

    register_template_filters(app)
    register_context_processors(app)
    register_error_handlers(app)
    register_request_hooks(app)

    app.register_blueprint(api)
    for blueprint in (auth, main, peaks, users, community):
        register_blueprint_with_legacy_endpoints(app, blueprint)

    prime_total_peak_count_cache(app)
    prime_county_peak_count_cache(app)
    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
