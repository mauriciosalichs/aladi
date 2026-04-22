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

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/aladi-portal.git
cd aladi-portal
python3 -m venv .venv
source .venv/bin/activate
pip install flask requests beautifulsoup4 lxml
python app.py
```

## Code style

- Follow PEP 8 for Python.
- Use f-strings; avoid % and `.format()` for new code.
- Keep HTML/CSS/JS changes minimal and consistent with the existing design system (see `static/css/style.css` CSS variables).
- No external JavaScript frameworks — the project intentionally uses plain HTML with minimal JS.

## Sensitive data

- **Never commit `config.json`** — it is listed in `.gitignore` for a reason.
- **Never include real barcodes, PINs, session cookies, or patron IDs** in issues, PRs, or commit messages.
- When sharing logs or screenshots for bug reports, redact personal information.

## Pull request checklist

- [ ] `python -m py_compile app.py aladi_client.py config.py` passes with no errors.
- [ ] The app starts and the login page renders: `python app.py` → visit `http://localhost:5000`.
- [ ] `config.json` is not tracked by git (`git status` shows it as ignored or untracked).
- [ ] No credentials or personal data in the diff.

## Reporting issues

Open a GitHub Issue. Describe:
1. What you expected to happen.
2. What actually happened (include any stack trace, redacted of personal info).
3. Steps to reproduce.
4. Python version (`python --version`) and OS.
