"""
Flask application — Aladí Library Search Portal
"""
import os
import re
from functools import wraps

from flask import (
    Flask,
    g,
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
from translations import (
    get_translations,
    get_search_types,
    get_scope_groups,
    SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE,
)

app = Flask(__name__)
app.secret_key = os.urandom(32)


# ------------------------------------------------------------------
# Internationalisation helpers
# ------------------------------------------------------------------

@app.before_request
def _set_language():
    """Resolve the active language and make translations available in `g`."""
    lang = session.get("lang")
    if not lang:
        cfg = load_config()
        lang = cfg.get("language", DEFAULT_LANGUAGE)
    if lang not in SUPPORTED_LANGUAGES:
        lang = DEFAULT_LANGUAGE
    g.lang = lang
    g.t = get_translations(lang)


@app.context_processor
def _inject_i18n():
    """Expose `t` (translations) and `lang` to every Jinja template."""
    return {"t": g.get("t", get_translations(DEFAULT_LANGUAGE)),
            "lang": g.get("lang", DEFAULT_LANGUAGE)}


def _t(key: str, **kwargs) -> str:
    """Translate *key* using the current request language."""
    text = g.t.get(key, key)
    return text.format(**kwargs) if kwargs else text


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
            flash(_t("flash_login_required"), "warning")
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@app.route("/set_language", methods=["POST"])
def set_language():
    """Persist the chosen language to config.json and the session."""
    lang = request.form.get("lang", DEFAULT_LANGUAGE)
    if lang not in SUPPORTED_LANGUAGES:
        lang = DEFAULT_LANGUAGE
    session["lang"] = lang
    cfg = load_config()
    save_config({**cfg, "language": lang})
    # Redirect back to the previous page, or to index
    return redirect(request.referrer or url_for("index"))


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
            flash(_t("flash_missing_fields"), "danger")
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
            flash(_t("flash_login_success", name=client.patron_name), "success")
            return redirect(url_for("search"), 303)
        else:
            flash(_t("flash_login_failed"), "danger")

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
    flash(_t("flash_logged_out"), "info")
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
            **cfg,
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
        search_types=get_search_types(g.lang),
        scope_groups=get_scope_groups(g.lang, AladiClient.SCOPE_GROUPS),
        patron_name=session.get("patron_name", ""),
    )


@app.route("/book/<bib_id>")
@login_required
def book_detail(bib_id: str):
    client = _get_client()
    if not re.match(r"^[a-zA-Z0-9]+$", bib_id):
        flash(_t("flash_invalid_id"), "danger")
        return redirect(url_for("search"))

    book = client.get_book(bib_id)
    if not book:
        flash(_t("flash_book_not_found"), "warning")
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
        flash(_t("flash_invalid_id"), "danger")
        return redirect(url_for("search"))

    client = _get_client()
    hold_form = client.get_hold_form(bib_id)
    if not hold_form:
        flash(_t("flash_reserve_form_error"), "danger")
        return redirect(url_for("book_detail", bib_id=bib_id))

    if not hold_form["copies"]:
        flash(_t("flash_no_copies"), "warning")
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
        flash(_t("flash_select_copy"), "warning")
        return redirect(url_for("reserve", bib_id=bib_id))

    client = _get_client()
    result = client.place_hold(bib_id, item_id)

    if result["success"]:
        flash(_t("flash_reserve_success", message=result["message"]), "success")
        return redirect(url_for("account"))
    else:
        flash(_t("flash_reserve_failed", message=result["message"]), "danger")
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


@app.route("/account/cancel_hold", methods=["POST"])
@login_required
def cancel_hold():
    """Cancel a single hold directly, without a confirmation page."""
    hold_id = request.form.get("hold_id", "").strip()
    # hold_id is a Millennium hold record number, e.g. "h1234567"
    if not hold_id or not re.match(r"^h\d+$", hold_id):
        flash(_t("flash_cancel_hold_invalid"), "danger")
        return redirect(url_for("account"))

    client = _get_client()
    ok = client.cancel_hold(hold_id)
    if ok:
        flash(_t("flash_cancel_hold_success"), "success")
    else:
        flash(_t("flash_cancel_hold_failed"), "danger")
    return redirect(url_for("account"))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
