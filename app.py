"""
Flask application — Aladí Library Search Portal
"""
import os
import re
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
from config import load_config, save_config

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


# ------------------------------------------------------------------
# Auto-restore session from saved cookies
# ------------------------------------------------------------------

@app.before_request
def _try_auto_login():
    """
    Before every request, if there is no active in-memory client, check
    config.json for saved session cookies and try to restore the session
    transparently.  If the cookies have expired the stored data is cleared
    and the user is sent to the login page normally.
    """
    # Skip static files — no session needed
    if request.endpoint == "static":
        return

    # Already authenticated in memory — nothing to do
    client = _get_client()
    if client and client.is_logged_in:
        return

    # The login/logout routes handle their own session state
    if request.endpoint in ("login", "logout"):
        return

    cfg = load_config()
    cookies = cfg.get("session_cookies", {})
    patron_id = cfg.get("patron_id", "")
    patron_name = cfg.get("patron_name", "")
    barcode = cfg.get("barcode", "")

    if not cookies or not patron_id:
        return  # Nothing saved — let login_required redirect normally

    restored = AladiClient()
    if restored.restore_session(cookies, patron_id, patron_name, barcode):
        _set_client(restored)
        session["patron_name"] = patron_name
    else:
        # Cookies are no longer valid — wipe them so we don't retry on every request
        save_config({
            **cfg,
            "session_cookies": {},
            "patron_id": "",
            "patron_name": "",
        })


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
            # Persist cookies so the next app launch can skip login
            cfg = load_config()
            save_config({
                **cfg,
                "session_cookies": client.get_cookies(),
                "patron_id": client.patron_id or "",
                "patron_name": client.patron_name or "",
                "barcode": barcode,
            })
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
    # Clear persisted cookies so auto-login is not attempted on next launch
    cfg = load_config()
    save_config({
        **cfg,
        "session_cookies": {},
        "patron_id": "",
        "patron_name": "",
    })
    flash("You have been logged out.", "info")
    return redirect(url_for("login"))


@app.route("/search")
@login_required
def search():
    client = _get_client()
    query = request.args.get("q", "").strip()
    form_submitted = "q" in request.args

    # Load persisted preferences; override with submitted form values when present
    cfg = load_config()
    if form_submitted:
        search_type = request.args.get("type", cfg["search_type"])
        scope = request.args.get("scope", cfg["scope"])
        sort = request.args.get("sort", cfg["sort"])
        available_only = request.args.get("available_only") == "1"
        collapse_editions = request.args.get("collapse") == "1"
    else:
        search_type = cfg["search_type"]
        scope = cfg["scope"]
        sort = cfg["sort"]
        available_only = cfg["available_only"]
        collapse_editions = cfg["collapse_editions"]

    results_data = None
    if query:
        save_config({
            "search_type": search_type,
            "scope": scope,
            "sort": sort,
            "available_only": available_only,
            "collapse_editions": collapse_editions,
        })
        if collapse_editions:
            results_data = client.collapse_search(
                query, search_type, scope, sort, available_only
            )
        else:
            results_data = client.search(
                query, search_type, scope, sort, available_only=available_only
            )

    return render_template(
        "search.html",
        query=query,
        search_type=search_type,
        scope=scope,
        sort=sort,
        available_only=available_only,
        collapse_editions=collapse_editions,
        results=results_data,
        search_types=AladiClient.SEARCH_TYPES,
        scope_groups=AladiClient.SCOPE_GROUPS,
        patron_name=session.get("patron_name", ""),
    )


@app.route("/book/<bib_id>")
@login_required
def book_detail(bib_id: str):
    client = _get_client()
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
