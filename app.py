from flask import Flask, render_template, request, redirect
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

submissions = []

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)


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

    supabase.auth.sign_up({
        "email": email,
        "password": password
    })

    return redirect("/home")


@app.route("/login", methods=["POST"])
def login():
    email = request.form.get("email")
    password = request.form.get("password")

    supabase.auth.sign_in_with_password({
        "email": email,
        "password": password
    })

    return redirect("/home")

@app.route("/logout")   
def logout():
    supabase.auth.sign_out()
    print("User logged out")
    return redirect("/")


@app.route("/home")
def home():
    return render_template("home.html")


if __name__ == "__main__":
    app.run(debug=True)