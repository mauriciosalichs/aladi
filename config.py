"""
Persistent search configuration — saved to config.json next to this file.
"""
import json
import os

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

DEFAULTS: dict = {
    # UI language: 'en' or 'es'
    "language": "en",
    # Search preferences
    "search_type": "X",
    "scope": "171",
    "sort": "D",
    "available_only": False,
    "collapse_editions": False,
    # Persisted session (stored after login so the app can resume without re-entering
    # credentials on the next launch).  These are session tokens — treat them like
    # passwords and NEVER commit config.json to version control.
    "session_cookies": {},   # dict of cookie name → value
    "patron_id": "",         # numeric patron ID extracted from the server redirect
    "patron_name": "",       # display name returned by the server
    "barcode": "",           # library card barcode (NOT the PIN — the PIN is never stored)
}


def load_config() -> dict:
    """Load saved config, falling back to defaults for missing keys."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return {**DEFAULTS, **data}
        except Exception:
            pass
    return dict(DEFAULTS)


def save_config(cfg: dict) -> None:
    """Persist only the known keys to avoid bloat."""
    to_save = {k: cfg.get(k, DEFAULTS[k]) for k in DEFAULTS}
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as fh:
            json.dump(to_save, fh, indent=2, ensure_ascii=False)
    except Exception:
        pass
