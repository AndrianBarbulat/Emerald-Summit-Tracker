from flask import Flask, render_template, request, redirect

app = Flask(__name__)

submissions = []

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        name = request.form.get("name")
        peak = request.form.get("peak")
        submissions.append({"name": name, "peak": peak})
        return redirect("/")  

    return render_template("index.html", submissions=submissions)

if __name__ == "__main__":
    app.run(debug=True)