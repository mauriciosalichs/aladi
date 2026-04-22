"""
Flask application — Aladí Library Search Portal
"""
import os
from functools import wraps

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
    jsonify,
)
from aladi_client import AladiClient

app = Flask(__name__)
app.secret_key = os.urandom(32)

# Store one AladiClient per Flask session (keyed by session id).
# Simple in-process cache — fine for a single-user school project.
_clients: dict[str, AladiClient] = {}


def _get_client() -> AladiClient | None:
    sid = session.get("sid")
    return _clients.get(sid) if sid else None


def _set_client(client: AladiClient) -> None:
    import uuid
    sid = session.get("sid") or str(uuid.uuid4())
    session["sid"] = sid
    _clients[sid] = client


def _clear_client() -> None:
    sid = session.pop("sid", None)
    if sid:
        _clients.pop(sid, None)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        client = _get_client()
        if not client or not client.is_logged_in:
            flash("Please log in first.", "warning")
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@app.route("/")
def index():
    client = _get_client()
    if client and client.is_logged_in:
        return redirect(url_for("search"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        barcode = request.form.get("barcode", "").strip()
        pin = request.form.get("pin", "").strip()

        if not barcode or not pin:
            flash("Please enter both barcode and PIN.", "danger")
            return render_template("login.html")

        client = AladiClient()
        if client.login(barcode, pin):
            _set_client(client)
            session["patron_name"] = client.patron_name
            flash(f"Welcome, {client.patron_name}!", "success")
            return redirect(url_for("search"), 303)
        else:
            flash("Login failed. Check your barcode and PIN.", "danger")

    return render_template("login.html")


@app.route("/logout")
def logout():
    client = _get_client()
    if client:
        client.logout()
    _clear_client()
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("login"))


@app.route("/search")
@login_required
def search():
    client = _get_client()
    query = request.args.get("q", "").strip()
    search_type = request.args.get("type", "X")
    scope = request.args.get("scope", "171")
    sort = request.args.get("sort", "D")

    results_data = None
    if query:
        results_data = client.search(query, search_type, scope, sort)

    return render_template(
        "search.html",
        query=query,
        search_type=search_type,
        scope=scope,
        sort=sort,
        results=results_data,
        search_types=AladiClient.SEARCH_TYPES,
        scopes=AladiClient.SCOPES,
        patron_name=session.get("patron_name", ""),
    )


@app.route("/book/<bib_id>")
@login_required
def book_detail(bib_id: str):
    client = _get_client()
    import re
    if not re.match(r"^[a-zA-Z0-9]+$", bib_id):
        flash("Invalid book ID.", "danger")
        return redirect(url_for("search"))

    book = client.get_book(bib_id)
    if not book:
        flash("Book not found.", "warning")
        return redirect(url_for("search"))

    return render_template(
        "book.html",
        book=book,
        patron_name=session.get("patron_name", ""),
    )


@app.route("/reserve/<bib_id>")
@login_required
def reserve(bib_id: str):
    """Show the hold/reserve form for a specific book."""
    import re
    if not re.match(r"^[a-zA-Z0-9]+$", bib_id):
        flash("Invalid book ID.", "danger")
        return redirect(url_for("search"))

    client = _get_client()
    hold_form = client.get_hold_form(bib_id)
    if not hold_form:
        flash("Could not load the reservation form. Make sure you are logged in.", "danger")
        return redirect(url_for("book_detail", bib_id=bib_id))

    if not hold_form["copies"]:
        flash("There are no copies available to request for this title.", "warning")
        return redirect(url_for("book_detail", bib_id=bib_id))

    return render_template(
        "reserve.html",
        hold_form=hold_form,
        patron_name=session.get("patron_name", ""),
    )


@app.route("/reserve/<bib_id>/confirm", methods=["POST"])
@login_required
def reserve_confirm(bib_id: str):
    """Place the hold after the user selects a copy."""
    import re
    if not re.match(r"^[a-zA-Z0-9]+$", bib_id):
        flash("Invalid book ID.", "danger")
        return redirect(url_for("search"))

    item_id = request.form.get("item_id", "").strip()
    if not item_id or not re.match(r"^i[0-9]+$", item_id):
        flash("Please select a copy.", "warning")
        return redirect(url_for("reserve", bib_id=bib_id))

    client = _get_client()
    result = client.place_hold(bib_id, item_id)

    if result["success"]:
        flash(f"✓ Reserva realizada. {result['message']}", "success")
        return redirect(url_for("account"))
    else:
        flash(f"No se pudo realizar la reserva: {result['message']}", "danger")
        return redirect(url_for("book_detail", bib_id=bib_id))


@app.route("/account")
@login_required
def account():
    client = _get_client()
    items = client.get_patron_items()
    holds = client.get_patron_holds()
    return render_template(
        "account.html",
        items=items,
        holds=holds,
        patron_name=session.get("patron_name", ""),
        patron_id=client.patron_id,
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
