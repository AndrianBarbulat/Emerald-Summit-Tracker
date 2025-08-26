from flask import Flask, jsonify, render_template, request, redirect, session
from supabase_utils import supabase

app = Flask(__name__)

submissions = []

app.secret_key = "dev-secret-key"

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        name = request.form.get("name")
        peak = request.form.get("peak")
        submissions.append({"name": name, "peak": peak})
        return redirect("/")

    return render_template("index.html", submissions=submissions)


@app.route("/signup", methods=["POST"])
def signup():
    if supabase is None:
        return "Supabase is not configured", 500

    email = request.form.get("email")
    password = request.form.get("password")

    result = supabase.auth.sign_up({
        "email": email,
        "password": password
    })

    if result.user:
        session["user"] = result.user.model_dump()
        print("New user signed up:")
        return redirect("/home")

    return "Signup failed"


#login  

@app.route("/login", methods=["POST"])
def login():
    if supabase is None:
        return "Supabase is not configured", 500

    email = request.form.get("email")
    password = request.form.get("password")

    result = supabase.auth.sign_in_with_password({
        "email": email,
        "password": password
    })

    if result.user:
        session["user"] = result.user.model_dump() 
        return redirect("/home")

    return "Login failed"

@app.route("/home")
def home():
    user = session.get("user")
    if user:
        # pass user info to template
        return render_template("home.html", user=user)
    return redirect("/")

    

#get current user
@app.route("/current_user")
def current_user():
    if supabase is None:
        return "Supabase is not configured", 500

    user = supabase.auth.get_user()
    if user:
        return jsonify(user)
    else:
        return "No user is currently logged in."

# logout
@app.route("/logout")   
def logout():
    if supabase is not None:
        supabase.auth.sign_out()
    print("User logged out")
    return redirect("/")


@app.route("/summit-list")
def summit_list():
    user = session.get("user")
    if not user:
        return redirect("/")
    peaks = [
        {"name": "Carrauntoohil", "height": "1038m", "county": "Kerry"},
        {"name": "Lugnaquilla", "height": "925m", "county": "Wicklow"},
        {"name": "Errigal", "height": "751m", "county": "Donegal"},
        {"name": "Mweelrea", "height": "814m", "county": "Mayo"}
    ]
    return render_template("summit_list.html", user=user, peaks=peaks)

@app.route("/account")
def account_settings():
    """Account settings page - view and edit user profile"""
    user = session.get("user")
    if not user:
        return redirect("/")
    
    return render_template("account_settings.html", user=user)

if __name__ == "__main__":
    app.run(debug=True)
