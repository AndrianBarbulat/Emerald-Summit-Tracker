from flask import Flask, jsonify, render_template, request, redirect, session
import json
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

submissions = []

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)
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
    user = supabase.auth.get_user()
    if user:
        return jsonify(user)
    else:
        return "No user is currently logged in."

# logout
@app.route("/logout")   
def logout():
    supabase.auth.sign_out()
    print("User logged out")
    return redirect("/")


if __name__ == "__main__":
    app.run(debug=True)