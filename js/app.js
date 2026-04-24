// Aladí Library Portal — SPA Controller

import { t, getLang, setLang, SEARCH_TYPES, SCOPE_GROUPS, SUPPORTED_LANGUAGES, MUNICIPALITIES, LIBRARY_BRANCHES } from './translations.js';
import { loadConfig, saveConfig, clearSession, isLoggedIn, getProxyUrl } from './config.js';
import * as client from './aladi-client.js';

// ── Globals ─────────────────────────────────────────────────────────

let currentView = null;

// ── Helpers ─────────────────────────────────────────────────────────

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function libMapsUrl(name) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' biblioteca')}`;
}

function libLink(name) {
  return `<a href="${libMapsUrl(name)}" target="_blank" rel="noopener" class="lib-maps-link">${esc(name)}</a>`;
}

function flash(message, category = 'info') {
  const container = document.getElementById('flash-container');
  const el = document.createElement('div');
  el.className = `flash flash--${category}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, 5000);
}

function setTitle(title) {
  document.title = title;
}

function navigate(hash) {
  window.location.hash = hash;
}

function showLoading() {
  document.getElementById('app-content').innerHTML =
    '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>';
}

// ── Navbar ──────────────────────────────────────────────────────────

function renderNav() {
  const cfg = loadConfig();
  const logged = isLoggedIn();
  const lang = getLang();

  let links = '';
  if (logged) {
    const isSearch = currentView === 'search';
    const isAccount = currentView === 'account';
    links += `<a href="#/search" class="nav-link ${isSearch ? 'active' : ''}">🔍 ${esc(t('nav_search'))}</a>`;
    links += `<a href="#/account" class="nav-link ${isAccount ? 'active' : ''}">👤 ${esc(t('nav_account'))}</a>`;
    links += `<a href="#/logout" class="nav-link nav-link--logout">${esc(t('nav_signout'))}</a>`;
    links += `<span class="nav-user">${esc(cfg.patron_name)}</span>`;
  } else {
    links += `<a href="#/login" class="nav-link">${esc(t('nav_login'))}</a>`;
  }
  links += `<a href="#/settings" class="nav-link">${esc(t('nav_settings'))}</a>`;

  // Language switcher
  links += '<div class="lang-switcher">';
  for (const code of SUPPORTED_LANGUAGES) {
    const active = lang === code ? ' lang-btn--active' : '';
    links += `<button type="button" class="lang-btn${active}" data-lang="${code}" title="${code.toUpperCase()}">${code.toUpperCase()}</button>`;
  }
  links += '</div>';

  document.getElementById('nav-links').innerHTML = links;

  // Hamburger button — insert into nav-inner if not already there
  let hamburger = document.getElementById('nav-hamburger');
  if (!hamburger) {
    hamburger = document.createElement('button');
    hamburger.id = 'nav-hamburger';
    hamburger.className = 'nav-hamburger';
    hamburger.setAttribute('aria-label', 'Menu');
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    document.querySelector('.nav-inner').appendChild(hamburger);
  }

  hamburger.onclick = () => {
    const isOpen = hamburger.classList.toggle('open');
    document.getElementById('nav-links').classList.toggle('open', isOpen);
  };

  // Close menu when a nav link is clicked
  document.getElementById('nav-links').querySelectorAll('a.nav-link').forEach(a => {
    a.addEventListener('click', () => {
      hamburger.classList.remove('open');
      document.getElementById('nav-links').classList.remove('open');
    });
  });

  // Bind language buttons
  document.querySelectorAll('.lang-btn[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      const cfg2 = loadConfig();
      saveConfig({ ...cfg2, language: btn.dataset.lang });
      route(true); // Re-render current view without re-triggering search
    });
  });
}

function renderFooter() {
  document.getElementById('footer-text').textContent = t('footer');
}

// ── Views ───────────────────────────────────────────────────────────

// ── LOGIN ──
function renderLogin() {
  currentView = 'login';
  setTitle(t('login_page_title'));
  renderNav();

  document.getElementById('app-content').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">📚</div>
        <h1 class="login-title">Aladí Library Portal</h1>
        <p class="login-subtitle">${esc(t('login_subtitle'))}</p>
        <form id="login-form" class="login-form">
          <div class="form-group">
            <label for="barcode" class="form-label">${esc(t('login_barcode_label'))}</label>
            <input type="text" id="barcode" class="form-input" placeholder="${esc(t('login_barcode_placeholder'))}" autocomplete="username" required />
          </div>
          <div class="form-group">
            <label for="pin" class="form-label">${esc(t('login_pin_label'))}</label>
            <input type="password" id="pin" class="form-input" placeholder="${esc(t('login_pin_placeholder'))}" autocomplete="current-password" required />
          </div>
          <button type="submit" class="btn btn--primary btn--full">${esc(t('login_btn'))}</button>
        </form>
        <p class="login-help">
          Diputació de Barcelona — <a href="https://aladi.diba.cat" target="_blank" rel="noopener">aladi.diba.cat</a>
        </p>
      </div>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const barcode = document.getElementById('barcode').value.trim();
    const pin = document.getElementById('pin').value.trim();

    if (!barcode || !pin) {
      flash(t('flash_missing_fields'), 'danger');
      return;
    }

    if (!getProxyUrl()) {
      flash(t('settings_proxy_help'), 'warning');
      navigate('#/settings');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '…';

    try {
      const result = await client.login(barcode, pin);
      if (result) {
        flash(t('flash_login_success', { name: result.patronName }), 'success');
        navigate('#/search');
      } else {
        flash(t('flash_login_failed'), 'danger');
      }
    } catch (err) {
      flash(err.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.textContent = t('login_btn');
    }
  });
}

// ── SETTINGS ──
function renderSettings() {
  currentView = 'settings';
  setTitle(t('settings_title'));
  renderNav();

  const cfg = loadConfig();

  document.getElementById('app-content').innerHTML = `
    <div class="login-wrap">
      <div class="login-card" style="max-width:500px">
        <div class="login-logo">⚙️</div>
        <h1 class="login-title">${esc(t('settings_title'))}</h1>
        <form id="settings-form" class="login-form">
          <div class="form-group">
            <label for="proxy_url" class="form-label">${esc(t('settings_proxy_label'))}</label>
            <input type="url" id="proxy_url" class="form-input" placeholder="${esc(t('settings_proxy_placeholder'))}" value="${esc(cfg.proxy_url)}" />
            <small style="color:var(--gray-400);font-size:.8rem;margin-top:.3rem;display:block">${esc(t('settings_proxy_help'))}</small>
          </div>
          <button type="submit" class="btn btn--primary btn--full">${esc(t('settings_save'))}</button>
          <button type="button" id="test-proxy-btn" class="btn btn--outline btn--full" style="margin-top:.5rem">${esc(t('settings_test'))}</button>
        </form>
      </div>
    </div>`;

  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    let proxyUrl = document.getElementById('proxy_url').value.trim();
    // Ensure trailing slash
    if (proxyUrl && !proxyUrl.endsWith('/')) proxyUrl += '/';
    const cfg2 = loadConfig();
    saveConfig({ ...cfg2, proxy_url: proxyUrl });
    flash(t('settings_saved'), 'success');
  });

  document.getElementById('test-proxy-btn').addEventListener('click', async () => {
    // Save first so the test uses the current value
    let proxyUrl = document.getElementById('proxy_url').value.trim();
    if (proxyUrl && !proxyUrl.endsWith('/')) proxyUrl += '/';
    const cfg2 = loadConfig();
    saveConfig({ ...cfg2, proxy_url: proxyUrl });

    const btn = document.getElementById('test-proxy-btn');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const ok = await client.testProxy();
      flash(ok ? t('settings_test_ok') : t('settings_test_fail'), ok ? 'success' : 'danger');
    } catch {
      flash(t('settings_test_fail'), 'danger');
    } finally {
      btn.disabled = false;
      btn.textContent = t('settings_test');
    }
  });
}

// ── SEARCH ──
function renderSearch(skipSearch = false) {
  currentView = 'search';
  setTitle(t('search_page_title'));
  renderNav();

  const cfg = loadConfig();
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const query = params.get('q') || '';
  const searchType = params.get('type') || cfg.search_type;
  const scope = params.get('scope') || cfg.scope;
  const city = params.get('city') || '';
  const branch = params.get('branch') || '';
  const sort = params.get('sort') || cfg.sort;
  const availableOnly = params.has('available_only') ? params.get('available_only') === '1' : cfg.available_only;
  const collapseEditions = params.has('collapse') ? params.get('collapse') === '1' : cfg.collapse_editions;

  // Build city branches for the initial city selection
  console.log(`[app] renderSearch with city="${city}" branch="${branch}"`);
  const cityBranches = city ? LIBRARY_BRANCHES.filter(b => b.city === city) : [];

  let html = `<div class="search-page"><section class="search-hero">
    <h1 class="search-hero__title">${esc(t('search_hero'))}</h1>
    <form id="search-form" class="search-form">
      <div class="search-bar">
        <input type="text" name="q" id="q" class="search-input" placeholder="${esc(t('search_placeholder'))}" value="${esc(query)}" autofocus />
        <button type="submit" class="btn btn--search">${esc(t('search_btn'))}</button>
      </div>
      <div class="filter-row">
        <div class="filter-group">
          <label for="type" class="filter-label">${esc(t('search_by_label'))}</label>
          <select name="type" id="type" class="filter-select">`;

  for (const code of SEARCH_TYPES) {
    const sel = code === searchType ? ' selected' : '';
    html += `<option value="${code}"${sel}>${esc(t('st_' + code))}</option>`;
  }

  html += `</select></div><div class="filter-group">
          <label for="scope" class="filter-label">${esc(t('search_library_label'))}</label>
          <select name="scope" id="scope" class="filter-select">`;

  for (const group of SCOPE_GROUPS) {
    html += `<optgroup label="${esc(t(group.key))}">`;
    for (const s of group.scopes) {
      const sel = s.code === scope ? ' selected' : '';
      html += `<option value="${s.code}"${sel}>${esc(s.name)}</option>`;
    }
    html += '</optgroup>';
  }

  html += `</select></div><div class="filter-group">
          <label for="sort" class="filter-label">${esc(t('search_sort_label'))}</label>
          <select name="sort" id="sort" class="filter-select">
            <option value="D"${sort === 'D' ? ' selected' : ''}>${esc(t('sort_relevance'))}</option>
            <option value="t"${sort === 't' ? ' selected' : ''}>${esc(t('sort_title'))}</option>
            <option value="a"${sort === 'a' ? ' selected' : ''}>${esc(t('sort_author'))}</option>
            <option value="c"${sort === 'c' ? ' selected' : ''}>${esc(t('sort_year'))}</option>
            <option value="r"${sort === 'r' ? ' selected' : ''}>${esc(t('sort_year_newest'))}</option>
          </select></div></div>

      <!-- City / Library row -->
      <div class="filter-row">
        <div class="filter-group">
          <label for="city" class="filter-label">${esc(t('search_city_label'))}</label>
          <select name="city" id="city" class="filter-select">
            <option value="">${esc(t('search_city_any'))}</option>`;

  for (const m of MUNICIPALITIES) {
    const sel = m.name === city ? ' selected' : '';
    html += `<option value="${esc(m.name)}"${sel}>${esc(m.name)}</option>`;
  }

  html += `</select></div>
        <div class="filter-group" id="branch-group">
          <label for="branch" class="filter-label">${esc(t('search_branch_label'))}</label>
          <select name="branch" id="branch" class="filter-select"${!city ? ' disabled' : ''}>
            <option value="">${esc(t('search_branch_any'))}</option>`;

  for (const b of cityBranches) {
    const sel = b.code === branch ? ' selected' : '';
    html += `<option value="${esc(b.code)}"${sel}>${esc(b.name)}</option>`;
  }

  html += `</select></div></div>

      <div class="adv-filter-row">
        <label class="adv-check-label">
          <input type="checkbox" name="available_only" value="1" id="available_only" class="adv-check" ${availableOnly ? 'checked' : ''}>
          <span class="adv-check-text">${esc(t('filter_available_only'))}</span>
        </label>
        <label class="adv-check-label">
          <input type="checkbox" name="collapse" value="1" id="collapse" class="adv-check" ${collapseEditions ? 'checked' : ''}>
          <span class="adv-check-text">${esc(t('filter_collapse'))}</span>
        </label>
      </div>
    </form></section>`;

  html += '<div id="results-container">';
  html += '</div></div>';

  document.getElementById('app-content').innerHTML = html;

  // City → branch cascade
  document.getElementById('city').addEventListener('change', () => {
    const selectedCity = document.getElementById('city').value;
    const branchSelect = document.getElementById('branch');
    branchSelect.innerHTML = `<option value="">${esc(t('search_branch_any'))}</option>`;
    if (selectedCity) {
      branchSelect.disabled = false;
      const filtered = LIBRARY_BRANCHES.filter(b => b.city === selectedCity);
      for (const b of filtered) {
        const opt = document.createElement('option');
        opt.value = b.code;
        opt.textContent = b.name;
        branchSelect.appendChild(opt);
      }
    } else {
      branchSelect.disabled = true;
    }
  });

  // Bind form
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    if (!q) return;
    const type = document.getElementById('type').value;
    const sc = document.getElementById('scope').value;
    const so = document.getElementById('sort').value;
    const ao = document.getElementById('available_only').checked ? '1' : '0';
    const co = document.getElementById('collapse').checked ? '1' : '0';
    const ci = document.getElementById('city').value;
    const br = document.getElementById('branch').value;
    let hashUrl = `#/search?q=${encodeURIComponent(q)}&type=${type}&scope=${sc}&sort=${so}&available_only=${ao}&collapse=${co}`;
    if (ci) hashUrl += `&city=${encodeURIComponent(ci)}`;
    if (br) hashUrl += `&branch=${encodeURIComponent(br)}`;
    navigate(hashUrl);
  });

  if (query && !skipSearch) {
    doSearch(query, searchType, scope, sort, availableOnly, collapseEditions, city, branch);
  }
}

// Active search abort controller — cancelled when a new search starts or user cancels
let _searchAbort = null;

async function doSearch(query, searchType, scope, sort, availableOnly, collapseEditions, city = '', branch = '') {
  // Cancel any in-flight search
  if (_searchAbort) { _searchAbort.abort(); }
  _searchAbort = new AbortController();
  const signal = _searchAbort.signal;

  const container = document.getElementById('results-container');
  container.innerHTML = `
    <div class="search-loading">
      <span class="search-loading__spinner">⏳</span>
      <button type="button" id="cancel-search-btn" class="btn-cancel-search">${esc(t('search_cancel_btn'))}</button>
    </div>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('cancel-search-btn').addEventListener('click', () => {
    _searchAbort.abort();
    _searchAbort = null;
    container.innerHTML = '';
    document.querySelector('.search-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  console.log(`[app] doSearch query="${query}" type=${searchType} scope=${scope} sort=${sort} availableOnly=${availableOnly} collapse=${collapseEditions} city="${city}" branch="${branch}"`);
  // Save preferences
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    search_type: searchType,
    scope,
    sort,
    available_only: availableOnly,
    collapse_editions: collapseEditions,
  });

  try {
    let data;
    if (collapseEditions) {
      console.log(`[app] using collapseSearch`);
      data = await client.collapseSearch(query, searchType, scope, sort, availableOnly, city, branch, signal);
    } else {
      console.log(`[app] using search`);
      data = await client.search(query, searchType, scope, sort, 1, availableOnly, city, branch, signal);
    }
    if (signal.aborted) return; // user cancelled between last fetch and render
    console.log(`[app] results received: total=${data.total ?? data.total_results} collapsed=${!!data.collapsed}`);
    data._city = city;
    data._branch = branch;
    container.innerHTML = renderResults(data);
    bindResultActions();
  } catch (err) {
    if (err.name === 'AbortError') return; // silent cancel
    console.error(`[app] doSearch error:`, err);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><h2>Error</h2><p>${esc(err.message)}</p></div>`;
  }
}

function renderResults(data) {
  if (data.collapsed) return renderCollapsedResults(data);
  if (data.total === 0) {
    return `<section class="results-section"><div class="empty-state">
      <div class="empty-icon">🔍</div><h2>${esc(t('results_none_title'))}</h2><p>${esc(t('results_none_hint'))}</p></div></section>`;
  }
  return renderGridResults(data);
}

function renderCollapsedResults(data) {
  const nLibs = data.grouped_copies.length;
  const nCopies = data.copies.length;

  let html = `<section class="results-section"><div class="results-header">
    <span class="results-count">
      <strong>${data.editions_fetched}</strong> ${data.editions_fetched !== 1 ? t('results_editions') : t('results_edition')}
      ${t('results_of')} <em>"${esc(data.query)}"</em> —
      <strong>${nCopies}</strong> ${nCopies !== 1 ? t('results_copies') : t('results_copy')}
      ${t('results_at')} <strong>${nLibs}</strong> ${nLibs !== 1 ? t('results_libraries') : t('results_library')}`;

  if (data.total_results > 12) {
    html += ` <small class="results-note">(${t('results_first_12')} · ${data.total_results} ${t('results_total')})</small>`;
  }
  html += `</span>
    <div class="collapse-sort-toggle">
      <button class="collapse-sort-btn active" data-sort="library">${esc(t('collapse_sort_library'))}</button>
      <button class="collapse-sort-btn" data-sort="book">${esc(t('collapse_sort_book'))}</button>
    </div>
  </div>`;

  if (nCopies === 0) {
    html += `<div class="empty-state"><div class="empty-icon">📭</div><h2>${esc(t('results_no_copies_title'))}</h2><p>${esc(t('results_no_copies_hint'))}</p></div>`;
  } else {
    // ── By-library table (shown by default) ──────────────────────────
    html += `<div class="avail-table-wrap collapse-table-wrap" data-view="library"><table class="avail-table"><thead><tr>
      <th>${esc(t('col_library'))}</th><th>${esc(t('col_edition'))}</th><th>${esc(t('col_type'))}</th>
      <th>${esc(t('col_callno'))}</th><th>${esc(t('col_status'))}</th><th>${esc(t('col_reserve'))}</th>
    </tr></thead><tbody>`;
    for (const [library, copies] of data.grouped_copies) {
      html += `<tr class="lib-group-row"><td colspan="6" class="lib-group-name">📍 ${libLink(library)}</td></tr>`;
      for (const copy of copies) {
        const rowClass = copy.status === 'Available' ? 'avail-row--green' : (copy.status.includes('DUE') || copy.status.toLowerCase().includes('loan') ? 'avail-row--red' : 'avail-row--gray');
        html += `<tr class="avail-row ${rowClass}">
          <td data-col="${esc(t('col_edition'))}"><a href="#/book/${copy.bib_id}" class="table-link">${esc(copy.edition_title)}</a></td>
          <td data-col="${esc(t('col_type'))}"><small class="media-badge">${esc(copy.media_type)}</small></td>
          <td data-col="${esc(t('col_callno'))}">${esc(copy.call_number)}</td>
          <td data-col="${esc(t('col_status'))}">${renderStatusPill(copy.status)}</td>
          <td data-col="${esc(t('col_reserve'))}">${copy.item_id ? `<button type="button" class="btn-inline-reserve" data-bib="${esc(copy.bib_id)}" data-item="${esc(copy.item_id)}">${esc(t('col_reserve'))}</button>` : '<span class="reserve-na">—</span>'}</td>
        </tr>`;
      }
    }
    html += '</tbody></table></div>';

    // ── By-book table (hidden by default) ────────────────────────────
    html += `<div class="avail-table-wrap collapse-table-wrap" data-view="book" style="display:none"><table class="avail-table"><thead><tr>
      <th>${esc(t('col_edition'))}</th><th>${esc(t('col_library'))}</th><th>${esc(t('col_type'))}</th>
      <th>${esc(t('col_callno'))}</th><th>${esc(t('col_status'))}</th><th>${esc(t('col_reserve'))}</th>
    </tr></thead><tbody>`;
    for (const book of (data.grouped_by_book || [])) {
      html += `<tr class="lib-group-row"><td colspan="6" class="lib-group-name">📖 <a href="#/book/${esc(book.bib_id)}" class="table-link">${esc(book.label)}</a></td></tr>`;
      for (const copy of book.copies) {
        const rowClass = copy.status === 'Available' ? 'avail-row--green' : (copy.status.includes('DUE') || copy.status.toLowerCase().includes('loan') ? 'avail-row--red' : 'avail-row--gray');
        html += `<tr class="avail-row ${rowClass}">
          <td data-col="${esc(t('col_library'))}">${libLink(copy.library)}</td>
          <td data-col="${esc(t('col_type'))}"><small class="media-badge">${esc(copy.media_type)}</small></td>
          <td data-col="${esc(t('col_callno'))}">${esc(copy.call_number)}</td>
          <td data-col="${esc(t('col_status'))}">${renderStatusPill(copy.status)}</td>
          <td data-col="${esc(t('col_reserve'))}">${copy.item_id ? `<button type="button" class="btn-inline-reserve" data-bib="${esc(copy.bib_id)}" data-item="${esc(copy.item_id)}">${esc(t('col_reserve'))}</button>` : '<span class="reserve-na">—</span>'}</td>
        </tr>`;
      }
    }
    html += '</tbody></table></div>';
  }
  html += '</section>';
  return html;
}

function renderGridResults(data) {
  let html = `<section class="results-section"><div class="results-header"><span class="results-count">
    <strong>${data.total}</strong> ${data.total !== 1 ? t('results_results') : t('results_result')}
    ${t('results_for')} <em>"${esc(data.query)}"</em></span></div><div class="book-grid">`;

  for (const book of data.results) {
    const link = book.is_browse_entry
      ? `href="${esc(book.record_url)}" target="_blank" rel="noopener"`
      : `href="#/book/${book.bib_id}"`;

    html += `<article class="book-card"><a ${link} class="book-card__link">
      <div class="book-card__cover">`;

    if (book.cover_url) {
      html += `<img src="${esc(book.cover_url)}" alt="${esc(book.title)}" class="book-card__img" loading="lazy" onerror="this.parentElement.innerHTML='<div class=book-card__no-cover>📖</div>'" />`;
    } else {
      html += `<div class="book-card__no-cover">${book.is_browse_entry ? '🔗' : '📖'}</div>`;
    }
    if (book.media_type) {
      html += `<span class="book-card__badge">${esc(book.media_type)}</span>`;
    }
    html += '</div><div class="book-card__body">';
    html += `<h3 class="book-card__title">${esc(book.title || t('book_untitled'))}</h3>`;
    if (book.author) html += `<p class="book-card__author">${esc(book.author)}</p>`;
    if (book.pub) html += `<p class="book-card__pub">${esc(book.pub)}</p>`;
    else if (book.year) html += `<p class="book-card__pub">${esc(book.year)}</p>`;

    if (book.availability && book.availability.length) {
      const available = book.availability.filter(i => i.status === 'Available');
      if (available.length) {
        html += `<span class="avail-pill avail-pill--green">✓ ${esc(t('status_available'))} (${available.length})</span>`;
      } else {
        html += `<span class="avail-pill avail-pill--orange">⏳ ${esc(t('status_all_on_loan'))}</span>`;
      }
    } else if (book.is_browse_entry) {
      html += `<span class="avail-pill avail-pill--blue">↗ ${esc(t('book_aladi_btn'))}</span>`;
    }

    html += '</div></a></article>';
  }

  html += '</div>';

  if (data.next_page_url) {
    const loaded = data.results.length;
    html += `<div class="scroll-sentinel"
      data-page-url="${esc(data.next_page_url)}"
      data-query="${esc(data.query)}"
      data-search-type="${esc(data.search_type)}"
      data-scope="${esc(data.scope)}"
      data-sort="${esc(data.sort || 'D')}"
      data-page="${(data.page || 1) + 1}"
      data-city="${esc(data._city || '')}"
      data-branch="${esc(data._branch || '')}">
      <span class="scroll-loading-indicator">⏳</span>
    </div>`;
  } else if (data.total > 12) {
    html += `<div class="pagination-bar"><span class="pagination-count">${data.total} ${esc(t('results_total'))}</span></div>`;
  }
  html += '</section>';
  return html;
}

function renderStatusPill(status) {
  if (status === 'Available') return `<span class="status-pill status-pill--green">✓ ${esc(t('status_available'))}</span>`;
  if (status.includes('DUE')) return `<span class="status-pill status-pill--orange">📅 ${esc(status)}</span>`;
  if (status.includes('Transit')) return `<span class="status-pill status-pill--blue">🚚 ${esc(t('status_in_transit'))}</span>`;
  return `<span class="status-pill status-pill--gray">${esc(status)}</span>`;
}

function bindResultActions() {
  // Infinite scroll: observe each .scroll-sentinel; when it enters the
  // viewport, fetch the next page and append cards automatically.
  const observeSentinels = () => {
    const sentinels = document.querySelectorAll('.scroll-sentinel:not([data-observed])');
    console.log(`[app] observeSentinels: found ${sentinels.length} unobserved sentinel(s)`);
    sentinels.forEach(sentinel => {
      sentinel.dataset.observed = '1';
      console.log(`[app] IntersectionObserver registered for sentinel page=${sentinel.dataset.page} url=${(sentinel.dataset.pageUrl || '').slice(-60)}`);
      const observer = new IntersectionObserver(async (entries) => {
        const entry = entries[0];
        console.log(`[app] IntersectionObserver callback: isIntersecting=${entry.isIntersecting} page=${sentinel.dataset.page}`);
        if (!entry.isIntersecting) return;
        observer.disconnect();
        sentinel.querySelector('.scroll-loading-indicator').textContent = '⏳';
        try {
          const pageUrl    = sentinel.dataset.pageUrl;
          const query      = sentinel.dataset.query;
          const searchType = sentinel.dataset.searchType;
          const scope      = sentinel.dataset.scope;
          const sort       = sentinel.dataset.sort || 'D';
          const page       = parseInt(sentinel.dataset.page, 10);
          const city       = sentinel.dataset.city || '';
          const branch     = sentinel.dataset.branch || '';
          console.log(`[app] infinite scroll: fetching page=${page} url=${pageUrl.slice(-80)}`);
          const data = await client.searchPage(pageUrl, query, searchType, scope, sort, page, city, branch);
          console.log(`[app] infinite scroll: got ${data.results.length} results, next=${data.next_page_url ? 'YES' : 'none'}`);
          data._city = city;
          data._branch = branch;

          // Append new cards into the existing grid
          const section = sentinel.closest('.results-section');
          const grid = section.querySelector('.book-grid');
          const tmp = document.createElement('div');
          tmp.innerHTML = renderGridResults(data);
          const newGrid = tmp.querySelector('.book-grid');
          if (newGrid) grid.insertAdjacentHTML('beforeend', newGrid.innerHTML);

          // Replace sentinel with the new one (or remove if last page)
          const newSentinel = tmp.querySelector('.scroll-sentinel');
          if (newSentinel) sentinel.replaceWith(newSentinel);
          else sentinel.remove();

          // Update displayed count
          const countEl = section.querySelector('.results-count strong');
          if (countEl) countEl.textContent = section.querySelectorAll('.book-card').length;

          bindResultActions(); // observe the new sentinel
        } catch (err) {
          console.error(`[app] infinite scroll error:`, err);
          sentinel.querySelector('.scroll-loading-indicator').textContent = '⚠ ' + err.message;
        }
      }, { rootMargin: '200px' }); // trigger 200px before reaching bottom
      observer.observe(sentinel);
    });
  };
  observeSentinels();

  // Collapse sort toggle: switch between by-library and by-book views
  document.querySelectorAll('.collapse-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.results-section');
      const sort = btn.dataset.sort;
      section.querySelectorAll('.collapse-sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      section.querySelectorAll('.avail-table-wrap[data-view]').forEach(wrap => {
        wrap.style.display = wrap.dataset.view === sort ? '' : 'none';
      });
    });
  });

  document.querySelectorAll('.btn-inline-reserve').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bibId = btn.dataset.bib;
      const itemId = btn.dataset.item;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const result = await client.placeHold(bibId, itemId);
        if (result.success) {
          flash(t('flash_reserve_success', { message: result.message }), 'success');
          btn.textContent = '✓';
        } else {
          flash(t('flash_reserve_failed', { message: result.message }), 'danger');
          btn.textContent = t('col_reserve');
          btn.disabled = false;
        }
      } catch (err) {
        flash(err.message, 'danger');
        btn.textContent = t('col_reserve');
        btn.disabled = false;
      }
    });
  });
}

// ── BOOK DETAIL ──
async function renderBookDetail(bibId) {
  currentView = 'book';
  renderNav();
  showLoading();

  if (!/^[a-zA-Z0-9]+$/.test(bibId)) {
    flash(t('flash_invalid_id'), 'danger');
    navigate('#/search');
    return;
  }

  try {
    const book = await client.getBook(bibId);
    if (!book) {
      flash(t('flash_book_not_found'), 'warning');
      navigate('#/search');
      return;
    }

    const titleField = book.fields['Title'] || '';
    setTitle(`${titleField || 'Book Detail'} — Aladí Library Portal`);

    let html = '<div class="detail-page">';
    html += `<a href="javascript:history.back()" class="back-link">${esc(t('book_back'))}</a>`;
    html += '<div class="detail-layout">';

    // Aside
    html += '<aside class="detail-aside"><div class="detail-cover">';
    if (book.cover_url) {
      html += `<img src="${esc(book.cover_url)}" alt="Cover" class="detail-cover__img" onerror="this.parentElement.innerHTML='<div class=detail-cover__placeholder>📖</div>'" />`;
    } else {
      html += '<div class="detail-cover__placeholder">📖</div>';
    }
    html += '</div><div class="detail-avail-summary">';

    if (book.availability.length) {
      const availCount = book.availability.filter(i => i.status === 'Available').length;
      if (availCount > 0) {
        html += `<div class="avail-badge avail-badge--green">✓ ${availCount} ${availCount !== 1 ? t('results_copies') : t('results_copy')} ${t('status_available')}</div>`;
      } else {
        html += `<div class="avail-badge avail-badge--orange">⏳ ${esc(t('status_all_on_loan'))}</div>`;
      }
    } else {
      html += `<div class="avail-badge avail-badge--gray">${esc(t('status_unknown'))}</div>`;
    }

    html += `</div><a href="https://aladi.diba.cat/record=${bibId}~S171" target="_blank" rel="noopener" class="btn btn--outline btn--full">${esc(t('book_aladi_btn'))}</a></aside>`;

    // Main detail
    html += '<div class="detail-main">';
    html += `<h1 class="detail-title">${esc(titleField || t('book_untitled'))}</h1>`;
    html += '<div class="detail-chips">';
    if (book.fields['Author/Artist']) html += `<span class="chip chip--author">✍️ ${esc(book.fields['Author/Artist'])}</span>`;
    if (book.fields['Publication']) html += `<span class="chip chip--year">📅 ${esc(book.fields['Publication'])}</span>`;
    html += '</div>';

    if (book.fields['Summary']) {
      html += `<div class="detail-summary"><h2 class="detail-section-title">${esc(t('book_summary'))}</h2><p>${esc(book.fields['Summary'])}</p></div>`;
    }

    // All fields
    html += `<div class="detail-biblio"><h2 class="detail-section-title">${esc(t('book_details'))}</h2><div class="biblio-table">`;
    for (const entry of book.all_fields) {
      if (entry.value && entry.value !== 'Rating') {
        html += `<div class="biblio-row"><dt class="biblio-label">${esc(entry.label || '↳')}</dt><dd class="biblio-value">${esc(entry.value)}</dd></div>`;
      }
    }
    html += '</div></div>';

    // Availability table
    if (book.availability.length) {
      html += `<div class="detail-availability"><h2 class="detail-section-title">${esc(t('book_availability'))}</h2>
        <div class="avail-table-wrap"><table class="avail-table"><thead><tr>
          <th>${esc(t('col_location'))}</th><th>${esc(t('col_callno'))}</th><th>${esc(t('col_status'))}</th>
          <th>${esc(t('col_notes'))}</th><th>${esc(t('col_reserve'))}</th></tr></thead><tbody>`;

      for (const item of book.availability) {
        const rowClass = item.status === 'Available' ? 'avail-row--green' : (item.status.includes('DUE') || item.status.toLowerCase().includes('loan') ? 'avail-row--red' : 'avail-row--gray');
        html += `<tr class="avail-row ${rowClass}">
          <td data-col="${esc(t('col_location'))}">${libLink(item.location)}</td>
          <td data-col="${esc(t('col_callno'))}">${esc(item.call_number)}</td>
          <td data-col="${esc(t('col_status'))}">${renderStatusPill(item.status)}</td>
          <td data-col="${esc(t('col_notes'))}">${esc(item.notes)}</td>
          <td data-col="${esc(t('col_reserve'))}">`;
        if (item.item_id) {
          html += `<button type="button" class="btn-inline-reserve" data-bib="${esc(bibId)}" data-item="${esc(item.item_id)}">${esc(t('col_reserve'))}</button>`;
        } else {
          html += '<span class="reserve-na">—</span>';
        }
        html += '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    html += '</div></div></div>';
    document.getElementById('app-content').innerHTML = html;
    bindResultActions();
  } catch (err) {
    document.getElementById('app-content').innerHTML =
      `<div class="empty-state"><div class="empty-icon">❌</div><h2>Error</h2><p>${esc(err.message)}</p></div>`;
  }
}

// ── ACCOUNT ──
async function renderAccount() {
  currentView = 'account';
  setTitle(t('account_page_title'));
  renderNav();
  showLoading();

  const cfg = loadConfig();

  try {
    const [items, holds] = await Promise.all([
      client.getPatronItems(),
      client.getPatronHolds(),
    ]);

    let html = `<div class="account-page">
      <h1 class="page-title">${esc(t('account_heading'))}</h1>`;

    // Loans
    html += `<section class="account-section"><h2 class="account-section__title">${esc(t('account_loans'))}</h2>`;
    if (items.length) {
      html += `<div class="avail-table-wrap"><table class="avail-table"><thead><tr>
        <th>${esc(t('account_col_title'))}</th>
        <th>${esc(t('account_col_due'))}</th></tr></thead><tbody>`;
      for (const item of items) {
        html += `<tr><td data-col="${esc(t('account_col_title'))}">`;
        if (item.bib_id) {
          html += `<a href="#/book/${item.bib_id}" class="table-link">${esc(item.title)}</a>`;
        } else {
          html += esc(item.title);
        }
        html += `</td><td data-col="${esc(t('account_col_due'))}">`;
        if (item.due_date) html += `<span class="status-pill status-pill--orange">📅 ${esc(item.due_date)}</span>`;
        if (item.renewed && item.renewed !== '—') html += ` <span class="chip chip--year">${esc(item.renewed)}</span>`;
        html += `</td></tr>`;
      }
      html += '</tbody></table></div>';
    } else {
      html += `<div class="empty-state empty-state--small"><div class="empty-icon">📭</div><p>${esc(t('account_no_loans'))}</p></div>`;
    }
    html += '</section>';

    // Holds
    html += `<section class="account-section"><h2 class="account-section__title">${esc(t('account_holds'))}</h2>`;
    if (holds.length) {
      html += `<div class="avail-table-wrap"><table class="avail-table"><thead><tr>
        <th>${esc(t('account_col_title'))}</th><th>${esc(t('account_col_status'))}</th>
        <th>${esc(t('account_col_pickup'))}</th><th>${esc(t('account_col_cancelby'))}</th><th></th>
        </tr></thead><tbody>`;
      for (const hold of holds) {
        html += `<tr><td data-col="${esc(t('account_col_title'))}">` ;
        if (hold.bib_id) {
          html += `<a href="#/book/${hold.bib_id}" class="table-link">${esc(hold.title)}</a>`;
        } else {
          html += esc(hold.title);
        }
        html += `</td><td data-col="${esc(t('account_col_status'))}">` ;
        if (hold.status.includes('Ready') || hold.status.includes('pick up')) {
          html += `<span class="status-pill status-pill--green">✓ ${esc(hold.status)}</span>`;
        } else if (hold.status.includes('Transit')) {
          html += `<span class="status-pill status-pill--blue">🚚 ${esc(hold.status)}</span>`;
        } else {
          html += `<span class="status-pill status-pill--orange">⏳ ${esc(hold.status)}</span>`;
        }
        html += `</td><td data-col="${esc(t('account_col_pickup'))}">${libLink(hold.pickup)}</td><td data-col="${esc(t('account_col_cancelby'))}">${esc(hold.cancel_by)}</td><td>`;
        if (hold.hold_id) {
          html += `<button type="button" class="btn-cancel-hold" data-hold="${esc(hold.hold_id)}">${esc(t('account_cancel_hold_btn'))}</button>`;
        }
        html += '</td></tr>';
      }
      html += '</tbody></table></div>';
    } else {
      html += `<div class="empty-state empty-state--small"><div class="empty-icon">📋</div><p>${esc(t('account_no_holds'))}</p></div>`;
    }
    html += '</section>';

    // Actions
    html += `<div class="account-actions">
      <a href="#/search" class="btn btn--primary">${esc(t('account_search_btn'))}</a>
      <a href="https://aladi.diba.cat/patroninfo~S171/${cfg.patron_id}/items" target="_blank" rel="noopener" class="btn btn--outline">${esc(t('account_aladi_btn'))}</a>
    </div></div>`;

    document.getElementById('app-content').innerHTML = html;

    // Bind cancel buttons
    document.querySelectorAll('.btn-cancel-hold').forEach(btn => {
      btn.addEventListener('click', async () => {
        const holdId = btn.dataset.hold;
        console.log('Cancel hold', holdId);
        if (!holdId) {
          flash(t('flash_cancel_hold_invalid'), 'danger');
          return;
        }
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const ok = await client.cancelHold(holdId);
          if (ok) {
            flash(t('flash_cancel_hold_success'), 'success');
            renderAccount(); // Refresh
          } else {
            flash(t('flash_cancel_hold_failed'), 'danger');
            btn.disabled = false;
            btn.textContent = t('account_cancel_hold_btn');
          }
        } catch (err) {
          flash(err.message, 'danger');
          btn.disabled = false;
          btn.textContent = t('account_cancel_hold_btn');
        }
      });
    });
  } catch (err) {
    document.getElementById('app-content').innerHTML =
      `<div class="empty-state"><div class="empty-icon">❌</div><h2>Error</h2><p>${esc(err.message)}</p></div>`;
  }
}

// ── RESERVE ──
async function renderReserve(bibId) {
  currentView = 'reserve';
  renderNav();
  showLoading();

  if (!/^[a-zA-Z0-9]+$/.test(bibId)) {
    flash(t('flash_invalid_id'), 'danger');
    navigate('#/search');
    return;
  }

  try {
    const holdForm = await client.getHoldForm(bibId);
    if (!holdForm) {
      flash(t('flash_reserve_form_error'), 'danger');
      navigate(`#/book/${bibId}`);
      return;
    }
    if (!holdForm.copies.length) {
      flash(t('flash_no_copies'), 'warning');
      navigate(`#/book/${bibId}`);
      return;
    }

    setTitle(`${t('reserve_title_prefix')} — ${holdForm.title.substring(0, 50)}`);

    let html = `<div class="reserve-page">
      <a href="javascript:history.back()" class="back-link">${esc(t('reserve_back'))}</a>
      <div class="reserve-header">
        <div class="reserve-icon">📋</div>
        <h1 class="reserve-title">${esc(t('reserve_heading'))}</h1>
        <p class="reserve-subtitle"><strong>${esc(holdForm.title)}</strong></p>
        <p class="reserve-info">${esc(t('reserve_info'))}</p>
      </div>
      <form id="reserve-form" class="reserve-form">
        <div class="reserve-filter-bar">
          <input type="text" id="copyFilter" class="filter-input" placeholder="${esc(t('reserve_filter_placeholder'))}" />
          <span class="filter-count" id="filterCount">${holdForm.copies.length} ${esc(t('reserve_copies_label'))}</span>
        </div>
        <div class="copies-table-wrap"><table class="copies-table" id="copiesTable"><thead><tr>
          <th class="col-select">${esc(t('reserve_col_select'))}</th>
          <th class="col-location">${esc(t('col_library'))}</th>
          <th class="col-callno">${esc(t('col_callno'))}</th>
          <th class="col-status">${esc(t('col_status'))}</th>
          <th class="col-notes">${esc(t('col_notes'))}</th>
        </tr></thead><tbody>`;

    holdForm.copies.forEach((copy, i) => {
      const rowClass = copy.status === 'Available' ? 'copy-available' : 'copy-onloan';
      const searchData = `${copy.location.toLowerCase()} ${copy.status.toLowerCase()} ${copy.notes.toLowerCase()}`;
      html += `<tr class="copy-row ${rowClass}" data-search="${esc(searchData)}">
        <td class="col-select"><label class="radio-label">
          <input type="radio" name="item_id" value="${esc(copy.item_id)}" class="copy-radio" ${i === 0 ? 'checked' : ''} />
          <span class="radio-custom"></span></label></td>
        <td class="col-location">${esc(copy.location)}</td>
        <td class="col-callno">${esc(copy.call_number)}</td>
        <td class="col-status">${renderStatusPill(copy.status)}</td>
        <td class="col-notes">${esc(copy.notes)}</td></tr>`;
    });

    html += `</tbody></table></div>
      <div class="reserve-actions">
        <button type="submit" class="btn btn--reserve">${esc(t('reserve_btn'))}</button>
        <a href="javascript:history.back()" class="btn btn--outline">${esc(t('reserve_cancel'))}</a>
      </div></form></div>`;

    document.getElementById('app-content').innerHTML = html;

    // Filter
    document.getElementById('copyFilter').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      let visible = 0;
      document.querySelectorAll('#copiesTable tbody .copy-row').forEach(row => {
        const match = !q || row.dataset.search.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      document.getElementById('filterCount').textContent = `${visible} ${t('reserve_copies_label')}`;
    });

    // Submit
    document.getElementById('reserve-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const selected = document.querySelector('input[name="item_id"]:checked');
      if (!selected) {
        flash(t('flash_select_copy'), 'warning');
        return;
      }
      const itemId = selected.value;
      if (!itemId || !/^i[0-9]+$/.test(itemId)) {
        flash(t('flash_select_copy'), 'warning');
        return;
      }

      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = '…';

      try {
        const result = await client.placeHold(bibId, itemId);
        if (result.success) {
          flash(t('flash_reserve_success', { message: result.message }), 'success');
          navigate('#/account');
        } else {
          flash(t('flash_reserve_failed', { message: result.message }), 'danger');
          btn.disabled = false;
          btn.textContent = t('reserve_btn');
        }
      } catch (err) {
        flash(err.message, 'danger');
        btn.disabled = false;
        btn.textContent = t('reserve_btn');
      }
    });
  } catch (err) {
    document.getElementById('app-content').innerHTML =
      `<div class="empty-state"><div class="empty-icon">❌</div><h2>Error</h2><p>${esc(err.message)}</p></div>`;
  }
}

// ── LOGOUT ──
function doLogout() {
  client.logout();
  flash(t('flash_logged_out'), 'info');
  navigate('#/login');
}

// ── Router ──────────────────────────────────────────────────────────

function route(skipSearch = false) {
  renderFooter();

  const hash = window.location.hash || '#/';
  const path = hash.split('?')[0];

  // Settings is always accessible
  if (path === '#/settings') { renderSettings(); return; }

  // Logout
  if (path === '#/logout') { doLogout(); return; }

  // If not logged in and no proxy, go to settings first
  if (!getProxyUrl() && path !== '#/login') {
    navigate('#/settings');
    return;
  }

  // Auth-protected routes
  if (path === '#/login' || path === '#/') {
    if (isLoggedIn()) { navigate('#/search'); return; }
    renderLogin();
    return;
  }

  if (!isLoggedIn()) {
    flash(t('flash_login_required'), 'warning');
    navigate('#/login');
    return;
  }

  if (path === '#/search') { renderSearch(skipSearch); return; }
  if (path === '#/account') { renderAccount(); return; }

  const bookMatch = path.match(/^#\/book\/(.+)$/);
  if (bookMatch) { renderBookDetail(bookMatch[1]); return; }

  const reserveMatch = path.match(/^#\/reserve\/(.+)$/);
  if (reserveMatch) { renderReserve(reserveMatch[1]); return; }

  // Default
  navigate('#/search');
}

// ── Init ────────────────────────────────────────────────────────────

window.addEventListener('hashchange', () => route());
window.addEventListener('DOMContentLoaded', () => {
  route();
});
