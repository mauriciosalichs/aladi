# Aladí Library Portal

> **Research / Educational Project** — See [DISCLAIMER.md](DISCLAIMER.md) before using.

A personal web interface for the [aladi.diba.cat](https://aladi.diba.cat) public library catalog of the Diputació de Barcelona network. 100 % static — runs in the browser, no server required.

---

## How it works (the short version)

```
Your browser  →  CORS Proxy  →  aladi.diba.cat
                (1 tiny script
                 on Cloudflare
                 free tier)
```

The app is just HTML + CSS + JavaScript files that the browser loads directly from GitHub Pages. The one extra piece needed is a **CORS proxy** — explained below.

---

## Why do I need a CORS proxy?

Browsers enforce a security rule called the **Same-Origin Policy**: a webpage at `your-site.github.io` is **not allowed** to make HTTP requests to a different domain (`aladi.diba.cat`) unless that other domain explicitly permits it. `aladi.diba.cat` does not permit it.

A CORS proxy is a tiny intermediary script that:
1. Receives the request from your browser
2. Forwards it to `aladi.diba.cat` (server code — no browser restrictions)
3. Returns the response to your browser with the "cross-origin allowed" headers added

This is **not a backdoor** — the proxy only forwards requests to `aladi.diba.cat`, nothing else. The Cloudflare Workers free tier gives you 100,000 requests/day, more than enough for personal library use.

**For local development** you can run `local-proxy.cjs` instead — no Cloudflare account needed.

---

## Project structure

```
aladi/
├── index.html          # App shell (nav, flash container, footer)
├── .nojekyll           # Tells GitHub Pages not to run Jekyll
├── css/
│   └── style.css       # All styles + responsive breakpoints
├── js/
│   ├── app.js          # SPA router + all view renderers
│   ├── aladi-client.js # HTTP client (fetch + DOMParser HTML parsing)
│   ├── config.js       # localStorage settings management
│   └── translations.js # EN/ES translations, search types, scope groups
├── proxy-worker.js     # Cloudflare Worker proxy (deploy once, use forever)
├── local-proxy.cjs     # Local proxy for development (Node.js, no npm needed)
├── DISCLAIMER.md
├── CONTRIBUTING.md
└── README.md
```

All configuration (proxy URL, language, search preferences, session cookies) is stored in **`localStorage`** inside the browser — no config files, no server.

---

## Local development (no Cloudflare needed)

You need **Node.js 18+** only. No `npm install` required.

### Step 1 — Start the local CORS proxy

```bash
node local-proxy.cjs
```

You will see:
```
✓ Aladí local proxy running at http://127.0.0.1:8787/
Configure the portal Settings URL to:  http://127.0.0.1:8787/
```

### Step 2 — Serve the site files

In a **second terminal**, same folder:

```bash
python3 -m http.server 8080
```

Open **http://localhost:8080** in the browser.

### Step 3 — Configure the proxy in the app

1. Click **⚙️ Settings** in the navbar.
2. Set the proxy URL to `http://127.0.0.1:8787/`.
3. Click **Test connection** — you should see "Connection OK!".
4. Click **Save** and log in.

> Settings are saved in `localStorage` — you only need to do this once per browser.

---

## GitHub Pages deployment

### Step 1 — Push to GitHub

```bash
git add .
git commit -m "Initial GitHub Pages release"
git push origin main
```

### Step 2 — Enable GitHub Pages

1. Open your repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch → main → / (root)**.
4. Click **Save**. Your site goes live at `https://YOUR_USERNAME.github.io/REPO_NAME/`.

> The site files (`index.html`, `css/`, `js/`) are in the **root** of the repository, which is what GitHub Pages serves directly.

### Step 3 — Deploy the CORS proxy to Cloudflare (one-time)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Workers & Pages → Create Worker**.
3. Replace the default code with the contents of [`proxy-worker.js`](proxy-worker.js).
4. Click **Deploy**.
5. Copy the Worker URL (e.g. `https://aladi-proxy.YOUR_SUBDOMAIN.workers.dev/`).

### Step 4 — Configure in the deployed site

Open your GitHub Pages URL → **⚙️ Settings** → paste the Cloudflare Worker URL → **Save**.

---

## Features

| Feature | Description |
|---|---|
| **100 % static** | GitHub Pages, no backend server |
| **Keyword & browse search** | Any keyword, title, author, subject, ISBN, call number |
| **Scope & sort filters** | Filter by collection or comarca, sort by relevance / title / author / year |
| **Available-only filter** | Hide everything currently on loan |
| **Collapse editions** | Aggregates copies from all editions, grouped by library, with direct reserve button |
| **Book detail + inline reserve** | One-click reserve from the availability table |
| **Patron account** | Checked-out items with due dates and pending holds |
| **Cancel hold** | ✕ Cancel button per hold, list refreshes automatically |
| **Session persistence** | Cookies in `localStorage` — no re-login until session expires |
| **Bilingual** | English / Spanish, switchable at any time |
| **Mobile responsive** | Hamburger nav, responsive tables, touch-friendly buttons |

---

## Configuration

All settings live in `localStorage` under `aladi_config`. Nothing is stored on disk.

| Key | Description |
|---|---|
| `proxy_url` | CORS proxy URL |
| `language` | `en` or `es` |
| `search_type` / `scope` / `sort` | Remembered search preferences |
| `available_only` / `collapse_editions` | Remembered filter state |
| `session_cookies` | Session tokens from `aladi.diba.cat` |
| `patron_id` / `patron_name` / `barcode` | Patron info (PIN is **never** stored) |

To reset: open browser DevTools → Application → Local Storage → delete `aladi_config`. Or click **Sign out**.

---

## Security notes

1. **PIN is never stored** — only the session cookies returned after a successful login are saved.
2. The proxy only forwards to `aladi.diba.cat` and cannot be misused as an open proxy.
3. All traffic uses HTTPS (GitHub Pages and Cloudflare both enforce this).

---

## Legal & Ethical Statement

See [DISCLAIMER.md](DISCLAIMER.md). Summary: personal research/educational project, accesses only the authenticated patron's own data, no commercial intent, no affiliation with Diputació de Barcelona.

---

## License

[MIT License](LICENSE) — covers this codebase only. The aladi.diba.cat website and catalog data remain the property of the Diputació de Barcelona.
