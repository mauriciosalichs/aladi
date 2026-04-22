# Aladí Library Portal

> **Research / Educational Project** — See [DISCLAIMER.md](DISCLAIMER.md) before using.

A personal web interface for the [aladi.diba.cat](https://aladi.diba.cat) public library catalog of the Diputació de Barcelona network.  
It wraps the existing OPAC (Innovative Interfaces / Sierra system) with a modern, faster search UI and adds quality-of-life features that are missing from the official site.

---

## Table of Contents

1. [Motivation](#motivation)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Installation](#installation)
5. [Configuration & Cookie Persistence](#configuration--cookie-persistence)
6. [Running the App](#running-the-app)
7. [Using the Portal](#using-the-portal)
8. [Security Notes](#security-notes)
9. [Known Limitations](#known-limitations)
10. [Legal & Ethical Statement](#legal--ethical-statement)
11. [License](#license)

---

## Motivation

The official Aladí catalog OPAC is functional but slow and lacks a few workflows that are useful for regular patrons:

- No "show me only available copies" filter on the search page.
- To see which libraries across the network have a book available, you must click into each result one by one.
- Placing a hold requires navigating three pages.

This project automates those steps through a locally-running Flask server that acts as a personal proxy — it authenticates with your library card, performs searches, and presents the results in a clean single-page interface.

**No data is sent to any third party.** All requests go directly from your machine to `aladi.diba.cat`.

---

## Features

| Feature | Description |
|---|---|
| **Keyword & browse search** | Supports all native search types: any keyword, title, author, subject, ISBN/ISSN, call number |
| **Scope & sort filters** | Filter by collection (Films, Music, Comics, …) or by comarca (region). Sort by relevance, title, author, or year. Filter preferences are remembered across launches. |
| **Available-only filter** | Show only results that have at least one copy currently on the shelf. |
| **Collapse editions** | A single query fetches copies from all matching editions and shows them grouped by library — with a direct "Reservar" button per row. Powered by parallel HTTP requests so it stays fast. |
| **Book detail with inline reserve** | Every copy row in the detail page has its own reserve button — no intermediate page required. |
| **Patron account page** | See checked-out items (with due dates and renewal count) and pending holds in one view. |
| **Cookie persistence** | After the first login the session cookies are saved locally. On the next app launch you go straight to the search page — no re-entering credentials. |

---

## Architecture

```
aladi/
├── app.py              # Flask routes, session management, auto-login hook
├── aladi_client.py     # All HTTP scraping logic (requests + BeautifulSoup)
├── config.py           # JSON config: search prefs + session cookie store
├── config.json         # Auto-generated at runtime — NOT committed to git
├── templates/
│   ├── base.html       # Navbar, flash messages, footer
│   ├── login.html      # Login form
│   ├── search.html     # Search bar, filters, results grid / collapsed table
│   ├── book.html       # Full bibliographic record + availability table
│   ├── account.html    # Patron items & holds
│   └── reserve.html    # Fallback full-page reserve form
├── static/
│   ├── css/style.css   # All styles (CSS variables, responsive)
│   └── js/app.js       # Minimal JS (filter input on reserve page)
├── .gitignore
├── DISCLAIMER.md
├── CONTRIBUTING.md
└── README.md
```

### Request flow

```
Browser → Flask (localhost:5000)
              │
              ├─ aladi_client.py
              │       │
              │       └─ requests.Session → aladi.diba.cat (HTTPS)
              │                               • /patroninfo* (auth)
              │                               • /search~S171/ (search)
              │                               • /record=bXXX~S171 (detail)
              │                               • /patroninfo~S171/{id}/items
              │                               • /patroninfo~S171/{id}/holds
              │                               • /search~S171?/.bXXX/…/request~bXXX
              │
              └─ Jinja2 templates → HTML → Browser
```

The `AladiClient` class maintains a `requests.Session` with the library's cookies. It is stored in a server-side dict keyed by the Flask session UUID — one client instance per browser session, kept in memory while the process runs.

---

## Installation

### Requirements

- Python 3.11 or newer
- pip

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/aladi-portal.git
cd aladi-portal

# 2. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install flask requests beautifulsoup4 lxml

# 4. Run the app
python app.py
# or
bash run.sh
```

Open your browser at **http://localhost:5000**.

---

## Configuration & Cookie Persistence

At runtime the app creates `config.json` in the project root. This file stores:

| Key | Type | Description |
|---|---|---|
| `search_type` | string | Default search type (`X` = keyword) |
| `scope` | string | Default scope code (`171` = all catalog) |
| `sort` | string | Default sort order |
| `available_only` | bool | Pre-check "Only available copies" |
| `collapse_editions` | bool | Pre-check "Collapse editions" |
| `session_cookies` | object | HTTP cookies from `aladi.diba.cat` |
| `patron_id` | string | Patron ID returned by the server |
| `patron_name` | string | Patron display name |
| `barcode` | string | Your library card barcode number |

### Cookie auto-login

After a successful login the session cookies are written to `config.json`.  
On the **next app launch**, `app.py` reads those cookies and sends a verification request to the library server. If the server accepts them (session still alive), you land directly on the search page. If they have expired, `config.json` is wiped and you see the login form as normal.

> **`config.json` is listed in `.gitignore` and must never be committed.**  
> It contains session tokens that provide authenticated access to your library account.

To force a full logout and clear stored cookies, use the **Logout** button in the navbar.

---

## Running the App

```bash
# Development mode (auto-reload on code changes)
python app.py

# Or via the helper script
bash run.sh
```

The server listens on `http://localhost:5000` and is **not** exposed to the network — it binds to `127.0.0.1` only. This is intentional: the app is designed for personal single-user local use.

---

## Using the Portal

### Login
Enter your library card barcode and PIN (the same credentials you use on aladi.diba.cat).  
After the first login you will not need to log in again until the server-side session expires (typically several hours to a few days).

### Search
- Type a query and press **Search**.
- Use the **Search by** selector to choose keyword, title, author, subject, ISBN, or call number.
- Use **Library / Collection** to scope results to a specific region or format collection.
- Check **✓ Only available copies** to hide everything currently on loan.
- Check **🗂 Collapse editions** to aggregate all physical copies from all matching editions into one table, sorted by library — with a direct reserve button per row. This makes one parallel batch of HTTP requests so expect 3–8 seconds on a first search.

### Book Detail
Click any card to open the full record. The **Copies & Availability** table shows every physical copy with its location, call number, status, and a **Reservar** button that places the hold in a single click.

### My Account
Click **My Account** in the navbar to see:
- **Préstamos actuales** — items currently checked out, with due dates.
- **Reservas** — pending holds, with pickup location and cancellation deadline.

---

## Security Notes

1. **Your PIN is never stored.** Only the session cookies returned by the server after a successful login are persisted.
2. **`config.json` behaves like a password file** — it grants authenticated access to your library account for as long as the session is alive. Protect it accordingly (do not share it, do not commit it).
3. The app runs exclusively on `localhost`. No data leaves your machine except the direct HTTPS requests to `aladi.diba.cat`.
4. Flask is run in development mode (`debug=True`). Do **not** expose this to the public internet.

---

## Known Limitations

- **12 results per search** — the Aladí OPAC paginates results and this app only fetches the first page. Use "Collapse editions" or a more specific query for large result sets.
- **Collapse editions** only covers the first 12 editions returned by the search. If there are many editions, results may be incomplete.
- **Browse searches** (title / author / subject) return a browse list rather than full result cards. Click through to Aladí for the full list.
- **Renewal** and **hold cancellation** are not yet implemented.
- The session cookie lifespan is controlled by `aladi.diba.cat`; this app has no control over it.

---

## Legal & Ethical Statement

See [DISCLAIMER.md](DISCLAIMER.md) for the full statement.

In summary:
- This is a **personal research and educational project**.
- It accesses only the **authenticated patron's own data**.
- It performs **read-only operations** against the public OPAC (plus hold placement via the standard patron interface).
- It does **not** scrape, index, or redistribute catalog data in bulk.
- It does **not** bypass any authentication mechanism. All login is done through the official patron login endpoint with valid credentials.
- The author has **no affiliation** with Diputació de Barcelona or Innovative Interfaces.

---

## License

[MIT License](LICENSE) — see the file for details.

The MIT License covers *this codebase only*. The aladi.diba.cat website and catalog data remain the property of the Diputació de Barcelona and its member libraries, and are subject to their own terms of service.
