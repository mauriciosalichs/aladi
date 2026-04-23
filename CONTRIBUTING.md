# Contributing

Thank you for your interest in this project.

## Who should contribute

This is a personal research/school project. External contributions are welcome but the scope is intentionally narrow — this tool should remain a lightweight personal utility, not a general-purpose library automation platform.

## Before you open an issue or PR

1. Read [DISCLAIMER.md](DISCLAIMER.md) to understand the project's goals and constraints.
2. Check that your contribution does not add features that would:
   - Access data belonging to patrons other than the authenticated user.
   - Scrape or republish catalog data in bulk.
   - Circumvent any authentication or rate-limiting mechanism.
   - Require storing the PIN or any password in any form.

## Project structure

The project is a static single-page application (SPA) deployed on GitHub Pages:

```
docs/                   # GitHub Pages root
├── index.html          # SPA shell
├── css/style.css       # All styles
└── js/
    ├── app.js          # SPA routing & views
    ├── aladi-client.js # HTTP client (fetch + DOMParser)
    ├── config.js       # localStorage management
    └── translations.js # EN/ES translations
proxy-worker.js         # Cloudflare Worker CORS proxy
```

Legacy Python/Flask files (`app.py`, `aladi_client.py`, `config.py`, `templates/`, `static/`) are kept for reference but are no longer the active codebase.

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/aladi-portal.git
cd aladi-portal/docs
python3 -m http.server 8000
# Open http://localhost:8000
```

You also need a CORS proxy (Cloudflare Worker). See [README.md](README.md#cors-proxy-setup-cloudflare-worker) for instructions.

## Code style

- Use ES modules (`import`/`export`) for JavaScript.
- Use `const`/`let` — never `var`.
- Keep HTML rendering in template literals inside `app.js` view functions.
- Keep CSS changes minimal and consistent with the existing design system (see `docs/css/style.css` CSS variables).
- No external JavaScript frameworks — the project intentionally uses plain HTML with minimal vanilla JS.

## Sensitive data

- **Never commit real barcodes, PINs, session cookies, or patron IDs** in issues, PRs, or commit messages.
- `localStorage` stores session data in the browser — do not screenshot or share it.
- When sharing logs or screenshots for bug reports, redact personal information.

## Pull request checklist

- [ ] `docs/index.html` loads without errors in the browser console.
- [ ] All views render correctly: login, settings, search, book detail, account, reserve.
- [ ] No credentials or personal data in the diff.
- [ ] Translations are added for both `en` and `es` if any new strings are introduced.
- [ ] The CORS proxy worker still passes basic tests if modified.

## Reporting issues

Open a GitHub Issue. Describe:
1. What you expected to happen.
2. What actually happened (include any browser console errors, redacted of personal info).
3. Steps to reproduce.
4. Browser version and OS.
