// Aladí Library Portal — HTTP Client (browser-side, uses CORS proxy)

import { loadConfig, saveConfig } from './config.js';
import { LIBRARY_BRANCHES } from './translations.js';

const BASE_URL = 'https://aladi.diba.cat';
const SCOPE = '171';

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookiesFromHeader(setCookieJson) {
  const cookies = {};
  if (!setCookieJson) return cookies;
  try {
    const arr = JSON.parse(setCookieJson);
    for (const sc of arr) {
      const nameVal = sc.split(';')[0];
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) {
        cookies[nameVal.substring(0, eqIdx).trim()] = nameVal.substring(eqIdx + 1).trim();
      }
    }
  } catch { /* ignore */ }
  return cookies;
}

async function proxyFetch(targetUrl, options = {}) {
  const cfg = loadConfig();
  const proxyUrl = cfg.proxy_url;
  if (!proxyUrl) {
    throw new Error('CORS proxy URL not configured. Go to Settings to set it up.');
  }
  console.log(`[proxyFetch] ${options.method || 'GET'} → ${targetUrl}`);

  const headers = { 'X-Target-URL': targetUrl };

  // Include session cookies
  const cookies = cfg.session_cookies || {};
  if (Object.keys(cookies).length) {
    headers['X-Custom-Cookie'] = cookieString(cookies);
  }

  if (options.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const fetchOpts = {
    method: options.method || 'GET',
    headers,
  };
  if (options.body) {
    fetchOpts.body = options.body;
  }

  const resp = await fetch(proxyUrl, fetchOpts);

  // Update stored cookies from response
  const newCookies = parseCookiesFromHeader(resp.headers.get('X-Set-Cookie'));
  if (Object.keys(newCookies).length) {
    const updatedCfg = loadConfig();
    updatedCfg.session_cookies = { ...updatedCfg.session_cookies, ...newCookies };
    saveConfig(updatedCfg);
  }

  const text = await resp.text();
  const finalUrl = resp.headers.get('X-Final-URL') || targetUrl;
  console.log(`[proxyFetch] response status=${resp.status} finalUrl=${finalUrl} bodyLen=${text.length}`);
  return { text, finalUrl, status: resp.status };
}

function parseHTML(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

// ── Auth ────────────────────────────────────────────────────────────

export async function login(barcode, pin) {
  const patronUrl = `${BASE_URL}/patroninfo*`;

  // Prime the session
  await proxyFetch(patronUrl);

  // POST login
  const body = `code=${encodeURIComponent(barcode)}&pin=${encodeURIComponent(pin)}`;
  const resp = await proxyFetch(patronUrl, { method: 'POST', body });

  if (resp.status !== 200) return null;

  // Extract patron ID from final URL
  const m = resp.finalUrl.match(/\/patroninfo~S\d+\/(\d+)\//);
  if (!m) return null;

  const patronId = m[1];
  const doc = parseHTML(resp.text);

  // Extract name from logged-in message
  let patronName = 'User';
  const msg = doc.querySelector('span.loggedInMessage');
  if (msg) {
    const nameMatch = msg.textContent.trim().match(/as (.+)$/);
    if (nameMatch) patronName = nameMatch[1];
  }

  // Persist session
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    patron_id: patronId,
    patron_name: patronName,
    barcode,
  });

  return { patronId, patronName };
}

export async function restoreSession() {
  const cfg = loadConfig();
  if (!cfg.session_cookies || !Object.keys(cfg.session_cookies).length || !cfg.patron_id) {
    return false;
  }
  if (!cfg.proxy_url) return false;

  try {
    const url = `${BASE_URL}/patroninfo~S${SCOPE}/${cfg.patron_id}/items`;
    const resp = await proxyFetch(url);
    if (resp.status === 200 && resp.finalUrl.includes('/patroninfo~S')) {
      return true;
    }
  } catch { /* ignore */ }

  // Session expired — wipe
  saveConfig({ ...cfg, session_cookies: {}, patron_id: '', patron_name: '' });
  return false;
}

export function logout() {
  const cfg = loadConfig();
  // Fire-and-forget logout request
  try { proxyFetch(`${BASE_URL}/logout~S${SCOPE}?`); } catch { /* ignore */ }
  saveConfig({
    ...cfg,
    session_cookies: {},
    patron_id: '',
    patron_name: '',
  });
}

// ── Search ──────────────────────────────────────────────────────────

/**
 * Aladi search URL builder.
 *
 * The catalog's advanced search (search/X) uses the /X path with SEARCH=
 * parameter and optional field-limit prefixes:
 *   /search~S{scope}/X?SEARCH={prefix}{query}&searchscope={scope}&SORT={sort}
 *
 * Field prefixes:
 *   a:  → author/artist     e.g. SEARCH=a: stephen king
 *   t:  → title             e.g. SEARCH=t: the shining
 *   d:  → subject           e.g. SEARCH=d: horror
 *   i:  → ISBN/ISSN         e.g. SEARCH=i: 9781234567890
 *   c:  → call number       e.g. SEARCH=c: 821-3
 *  (none) → any keyword     e.g. SEARCH=stephen king
 *
 * Branch filter: append &b={branchCode} (alphanumeric code like b801, cts1…)
 * City scope: change ~S{scope} in path and searchscope param to the city code.
 * When branch is set, use scope 171 (all) – branch already implies the city.
 */
// ── Location filtering helpers ────────────────────────────────────

/**
 * Strip accents / diacritics, lowercase, collapse whitespace.
 * This lets us compare Aladi location strings (which use varying
 * abbreviations and accents) with our branch/city names loosely.
 */
function sanitize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // remove combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')       // non-alphanumeric → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Given a LIBRARY_BRANCHES name like "Barcelona. Jaume Fuster",
 * return the part after the first ". " — e.g. "Jaume Fuster".
 */
function branchNamePart(fullName) {
  const idx = fullName.indexOf('. ');
  return idx >= 0 ? fullName.slice(idx + 2) : fullName;
}

/**
 * Return true if the availability location string matches the selected
 * city and/or branch.
 *
 * Aladi locations look like  "BCN GRA.Jaume Fuster"  or
 * "ST. PERE DE RIBES.Manuel de Pedrolo".  The segment after the last
 * dot is the branch name — which matches LIBRARY_BRANCHES[n].name
 * after the "City. " prefix.  We cannot rely on the city abbreviation
 * (BCN ≠ Barcelona), so for city-only filtering we check whether any
 * branch belonging to that city has its name part present in the
 * location string.
 *
 * @param {string} location  - raw location from availability item
 * @param {string} cityName  - MUNICIPALITIES name, or ''
 * @param {string} branchCode - LIBRARY_BRANCHES code, or ''
 */
function locationMatchesFilter(location, cityName, branchCode) {
  const loc = sanitize(location);

  if (branchCode) {
    const entry = LIBRARY_BRANCHES.find(b => b.code === branchCode);
    if (!entry) return true; // unknown code — don't filter
    const namePart = sanitize(branchNamePart(entry.name));
    return loc.includes(namePart);
  }

  if (cityName) {
    const cityBranches = LIBRARY_BRANCHES.filter(b => b.city === cityName);
    if (!cityBranches.length) return true; // unknown city — don't filter
    return cityBranches.some(b => loc.includes(sanitize(branchNamePart(b.name))));
  }

  return true; // no filter active
}

const FIELD_PREFIX = { a: 'a: ', t: 't: ', d: 'd: ', i: 'i: ', c: 'c: ', X: '' };

function buildSearchUrl(query, searchType, scope, sort, branch) {
  const effectiveScope = branch ? '171' : scope;
  const prefix = FIELD_PREFIX[searchType] ?? '';
  const searchArg = prefix + query;

  const params = new URLSearchParams({
    SEARCH: searchArg,
    searchscope: effectiveScope,
    SORT: sort,
  });
  if (branch) params.set('b', branch);

  const url = `${BASE_URL}/search~S${effectiveScope}/X?${params}`;
  console.log(`[aladi] buildSearchUrl type=${searchType} scope=${effectiveScope} branch=${branch || 'none'} → ${url}`);
  return { url, effectiveScope };
}

export async function search(query, searchType = 'X', scope = '171', sort = 'D', page = 1, availableOnly = false, city = '', branch = '') {
  console.log(`[aladi] \n\nsearch(query="${query}", type=${searchType}, scope=${scope}, sort=${sort}, availableOnly=${availableOnly}, city="${city}", branch="${branch}")\n\n`);
  const { url, effectiveScope } = buildSearchUrl(query, searchType, scope, sort, branch);
  const resp = await proxyFetch(url);
  console.log(`[aladi] search response status=${resp.status} finalUrl=${resp.finalUrl}`);
  const data = parseResults(resp.text, query, searchType, effectiveScope, page);
  console.log(`[aladi] search parsed: total=${data.total} results=${data.results.length} isBrowse=${data.is_browse}`);

  console.log(`[DEBUG] first 3 results: ${JSON.stringify(data.results.slice(0, 3), null, 2)}`);
  
  if (availableOnly) {
    const before = data.results.length;
    data.results = data.results.filter(
      r => r.availability && r.availability.some(i => i.status === 'Available')
    );
    console.log(`[aladi] availableOnly filter: ${before} → ${data.results.length}`);
  }

  // Location-based city / branch filtering.
  // Aladi location strings (e.g. "BCN GRA.Jaume Fuster") contain the
  // branch name but not the full city name, so we match on branch name
  // parts from LIBRARY_BRANCHES.
  if (city !== '' || branch !== '') {
    const beforeCount = data.results.length;
    data.results = data.results
      .map(r => {
        const filtered = (r.availability || []).filter(
          item => locationMatchesFilter(item.location, city, branch)
        );
        return { ...r, availability: filtered };
      })
      .filter(r => r.availability.length > 0);
    console.log(`[aladi] city/branch filter (city="${city}" branch="${branch}"): ${beforeCount} → ${data.results.length} records`);
  }

  console.log(`[DEBUG] first 3 results after filter: ${JSON.stringify(data.results.slice(0, 3), null, 2)}`);
  

  return data;
}

export async function collapseSearch(query, searchType = 'X', scope = '171', sort = 'D', availableOnly = false, city = '', branch = '') {
  console.log(`[aladi] collapseSearch(query="${query}", type=${searchType}, scope=${scope}, city="${city}", branch="${branch}")`);
  const results = await search(query, searchType, scope, sort, 1, false, city, branch);
  const books = results.results.filter(b => b.bib_id && !b.is_browse_entry);

  // Fetch hold forms in parallel
  const formPromises = books.map(async (book) => {
    try {
      const form = await getHoldForm(book.bib_id);
      if (!form) return [];
      return form.copies.map(copy => ({
        library: copy.location,
        edition_title: book.title,
        bib_id: book.bib_id,
        item_id: copy.item_id,
        call_number: copy.call_number,
        status: copy.status,
        notes: copy.notes,
        media_type: book.media_type || '',
      }));
    } catch {
      return [];
    }
  });

  const allLists = await Promise.all(formPromises);
  let allCopies = allLists.flat();
  console.log(`[aladi] collapseSearch: fetched ${books.length} hold forms → ${allCopies.length} total copies`);

  // Apply city / branch filter on the copy's library location field.
  // getHoldForm returns all copies from the catalog regardless of scope,
  // so we must re-apply the same location filter used in search().
  if (city || branch) {
    const before = allCopies.length;
    allCopies = allCopies.filter(c => locationMatchesFilter(c.library, city, branch));
    console.log(`[aladi] collapseSearch city/branch filter (city="${city}" branch="${branch}"): ${before} → ${allCopies.length} copies`);
  }

  allCopies.sort((a, b) => {
    const lib = a.library.toLowerCase().localeCompare(b.library.toLowerCase());
    if (lib !== 0) return lib;
    return (a.status === 'Available' ? 0 : 1) - (b.status === 'Available' ? 0 : 1);
  });

  if (availableOnly) {
    const before = allCopies.length;
    allCopies = allCopies.filter(c => c.status === 'Available');
    console.log(`[aladi] collapseSearch availableOnly: ${before} → ${allCopies.length} copies`);
  }

  const grouped = {};
  for (const copy of allCopies) {
    if (!grouped[copy.library]) grouped[copy.library] = [];
    grouped[copy.library].push(copy);
  }
  const groupedCopies = Object.entries(grouped);
  console.log(`[aladi] collapseSearch: ${groupedCopies.length} libraries, ${allCopies.length} copies total`);

  return {
    query,
    search_type: searchType,
    scope,
    total_results: results.total,
    editions_fetched: books.length,
    copies: allCopies,
    grouped_copies: groupedCopies,
    collapsed: true,
  };
}

function parseResults(html, query, searchType, scope, page) {
  const doc = parseHTML(html);
  let total = 0;
  const header = doc.querySelector('td.browseHeaderData');
  if (header) {
    const m = header.textContent.match(/(\d+)\s+of\s+(\d+)/);
    if (m) {
      total = parseInt(m[2], 10);
      console.log(`[aladi] parseResults: browseHeader says ${m[1]} of ${total}`);
    }
  }

  const briefRows = doc.querySelectorAll('td.briefCitRow');
  let books;
  let isBrowse = false;

  if (briefRows.length) {
    console.log(`[aladi] parseResults: found ${briefRows.length} briefCitRow elements`);
    books = [];
    briefRows.forEach(row => {
      const b = parseBriefRow(row);
      if (b) books.push(b);
    });
    console.log(`[aladi] parseResults: parsed ${books.length} book records`);
  } else {
    console.warn(`[aladi] parseResults: no briefCitRows — falling back to browse list`);
    books = parseBrowseList(doc, searchType, scope);
    isBrowse = books.length > 0;
    if (!total && books.length) total = books.length;
    console.log(`[aladi] parseResults: browse list entries: ${books.length}`);
  }

  const pages = Math.max(1, Math.ceil(total / 12));

  return { results: books, total, page, pages, query, search_type: searchType, scope, is_browse: isBrowse };
}

function parseBriefRow(row) {
  try {
    const checkbox = row.querySelector('input[type="checkbox"]');
    const bibId = checkbox ? checkbox.value : null;

    const mediaDiv = row.querySelector('div.briefcitMedia');
    let mediaType = '';
    if (mediaDiv) {
      const img = mediaDiv.querySelector('img');
      if (img) mediaType = img.getAttribute('alt') || '';
    }

    let coverUrl = '';
    const portadaDiv = row.querySelector('div.brief_portada');
    if (portadaDiv) {
      const img = portadaDiv.querySelector('img');
      if (img) coverUrl = img.getAttribute('src') || '';
    }

    let title = '';
    const titular = row.querySelector('span.titular');
    if (titular) {
      const titleLink = titular.querySelector('a');
      if (titleLink) title = titleLink.textContent.trim();
    }

    let recordUrl = '';
    if (bibId) recordUrl = `${BASE_URL}/record=${bibId}~S${SCOPE}`;

    let author = '';
    let year = '';
    let pub = '';
    const descript = row.querySelector('div.descript');
    if (descript) {
      const titClone = descript.querySelector('span.titular');
      if (titClone) titClone.remove();
      descript.querySelectorAll('span, img').forEach(el => el.remove());

      const lines = [];
      const walker = document.createTreeWalker(descript, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent.trim();
        if (t && t !== 'Rating:' && t !== 'Request item') lines.push(t);
      }

      for (const line of lines) {
        if (line.includes(' : ')) {
          pub = line;
          const ym = line.match(/\[?(\d{4})\]?/);
          if (ym) year = ym[1];
        } else if (!author && line) {
          author = line;
        }
      }
    }

    const availability = parseAvailability(row);

    return { bib_id: bibId, title, author, year, pub, cover_url: coverUrl, media_type: mediaType, record_url: recordUrl, availability };
  } catch {
    return null;
  }
}

function parseAvailability(context) {
  const items = [];
  let parent = context;
  for (let i = 0; i < 5; i++) {
    parent = parent.parentElement;
    if (!parent) break;
    const bibitems = parent.querySelector('table.bibItems');
    if (bibitems) {
      bibitems.querySelectorAll('tr.bibItemsEntry').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          items.push({
            location: cells[0].textContent.trim(),
            call_number: cells[1].textContent.trim(),
            status: cells[2].textContent.trim(),
            notes: cells.length > 3 ? cells[3].textContent.trim() : '',
          });
        }
      });
      break;
    }
  }
  return items;
}

function parseBrowseList(doc, searchType, scope) {
  const books = [];
  const typeLabels = { t: 'Titles', a: 'Authors', d: 'Subjects', i: 'ISBN', c: 'Call Number' };
  const kind = typeLabels[searchType] || 'Results';

  doc.querySelectorAll('tr.browseEntry').forEach(row => {
    const linkTd = row.querySelector('td.browseEntryData');
    const countTd = row.querySelector('td.browseEntryEntries');
    if (!linkTd) return;

    let aTag = null;
    for (const a of linkTd.querySelectorAll('a')) {
      if (a.getAttribute('href')) { aTag = a; break; }
    }
    if (!aTag) return;

    const entryText = aTag.textContent.trim();
    const count = countTd ? countTd.textContent.trim() : '?';
    const href = aTag.getAttribute('href') || '';
    const fullHref = href.startsWith('/') ? BASE_URL + href : href;

    books.push({
      bib_id: null,
      title: entryText,
      author: `${count} item(s)`,
      year: '',
      pub: kind,
      cover_url: '',
      media_type: kind,
      record_url: fullHref,
      availability: [],
      is_browse_entry: true,
    });
  });
  return books;
}

// ── Book detail ────────────────────────────────────────────────────

export async function getBook(bibId) {
  const url = `${BASE_URL}/record=${bibId}~S${SCOPE}`;
  const resp = await proxyFetch(url);
  if (resp.status !== 200) return null;
  const book = parseBookDetail(resp.text, bibId);

  // Enrich availability with item_ids
  const holdData = await getHoldForm(bibId);
  if (holdData) {
    const itemMap = {};
    for (const copy of holdData.copies) {
      const key = copy.location.substring(0, 30).toLowerCase() + '|' + copy.call_number.substring(0, 12).toLowerCase();
      itemMap[key] = copy.item_id;
    }
    for (const avail of book.availability) {
      const key = avail.location.substring(0, 30).toLowerCase() + '|' + avail.call_number.substring(0, 12).toLowerCase();
      avail.item_id = itemMap[key] || '';
    }
  } else {
    for (const avail of book.availability) avail.item_id = '';
  }

  return book;
}

function parseBookDetail(html, bibId) {
  const doc = parseHTML(html);

  let coverUrl = '';
  const fitxa = doc.querySelector('div.fitxa_imatge');
  if (fitxa) {
    const img = fitxa.querySelector('img');
    if (img) coverUrl = img.getAttribute('src') || '';
  }

  const allFields = [];
  for (const tbl of doc.querySelectorAll('table.bibDetail')) {
    const inner = tbl.querySelector('table');
    if (!inner) continue;
    let currentLabel = '';
    for (const rowEl of inner.querySelectorAll('tr')) {
      const labelTd = rowEl.querySelector('td.bibInfoLabel');
      const dataTd = rowEl.querySelector('td.bibInfoData');
      if (labelTd) currentLabel = labelTd.textContent.trim();
      if (dataTd) {
        const val = dataTd.textContent.trim();
        if (val) allFields.push({ label: currentLabel, value: val });
      }
    }
  }

  const fields = {};
  for (const entry of allFields) {
    if (entry.label && !(entry.label in fields)) {
      fields[entry.label] = entry.value;
    }
  }

  const availability = [];
  for (const bibitems of doc.querySelectorAll('table.bibItems')) {
    for (const rowEl of bibitems.querySelectorAll('tr.bibItemsEntry')) {
      const cells = rowEl.querySelectorAll('td');
      if (cells.length >= 3) {
        availability.push({
          location: cells[0].textContent.trim(),
          call_number: cells[1].textContent.trim(),
          status: cells[2].textContent.trim(),
          notes: cells.length > 3 ? cells[3].textContent.trim() : '',
        });
      }
    }
  }

  return { bib_id: bibId, fields, all_fields: allFields, cover_url: coverUrl, availability };
}

// ── Patron account ─────────────────────────────────────────────────

export async function getPatronItems() {
  const cfg = loadConfig();
  if (!cfg.patron_id) return [];
  const url = `${BASE_URL}/patroninfo~S${SCOPE}/${cfg.patron_id}/items`;
  const resp = await proxyFetch(url);
  return parsePatronItems(resp.text);
}

function parsePatronItems(html) {
  const doc = parseHTML(html);
  const items = [];
  const table = doc.querySelector('table.patFunc');
  if (!table) return items;

  for (const row of table.querySelectorAll('tr.patFuncEntry')) {
    const titleTh = row.querySelector('th.patFuncBibTitle');
    let title = titleTh ? titleTh.textContent.trim() : '';
    let bibId = '';
    if (titleTh) {
      const a = titleTh.querySelector('a[href*="/record="]');
      if (a) {
        const m = (a.getAttribute('href') || '').match(/\/record=([^~]+)~/);
        if (m) bibId = m[1];
      }
    }

    const barcodeTd = row.querySelector('td.patFuncBarcode');
    const statusTd = row.querySelector('td.patFuncStatus');
    const callnoTd = row.querySelector('td.patFuncCallNo');

    let dueDate = '';
    let renewed = '';
    if (statusTd) {
      const renewSpan = statusTd.querySelector('span.patFuncRenewCount');
      if (renewSpan) {
        renewed = renewSpan.textContent.trim();
        renewSpan.remove();
      }
      dueDate = statusTd.textContent.trim();
    }

    items.push({
      title,
      bib_id: bibId,
      barcode: barcodeTd ? barcodeTd.textContent.trim() : '',
      due_date: dueDate,
      renewed,
      call_number: callnoTd ? callnoTd.textContent.trim() : '',
    });
  }
  return items;
}

export async function getPatronHolds() {
  const cfg = loadConfig();
  if (!cfg.patron_id) return [];
  const url = `${BASE_URL}/patroninfo~S${SCOPE}/${cfg.patron_id}/holds`;
  const resp = await proxyFetch(url);
  return parsePatronHolds(resp.text);
}

function parsePatronHolds(html) {
  const doc = parseHTML(html);
  const items = [];
  const table = doc.querySelector('table.patFunc');
  if (!table) return items;

  for (const row of table.querySelectorAll('tr.patFuncEntry')) {
    const titleTh = row.querySelector('th.patFuncBibTitle');
    let title = titleTh ? titleTh.textContent.trim() : '';
    let bibId = '';
    if (titleTh) {
      const a = titleTh.querySelector('a[href*="/record="]');
      if (a) {
        const m = (a.getAttribute('href') || '').match(/\/record=([^~]+)~/);
        if (m) bibId = m[1];
      }
    }

    const statusTd = row.querySelector('td.patFuncStatus');
    const pickupTd = row.querySelector('td.patFuncPickup');

    // ── hold_id extraction ────────────────────────────────────────
    // The cancel checkbox in III Millennium encodes the item ID in its NAME:
    //   name="name_pfmark_cancel{itemId}"  (e.g. name_pfmark_canceli23891110x04)
    // There is no meaningful value attribute — the token IS the name suffix.
    let holdId = '';
    let cancelBy = '';

    // Primary: find any checkbox whose name starts with 'name_pfmark_cancel'
    for (const inp of row.querySelectorAll('input[type="checkbox"], input[type="CHECKBOX"]')) {
      const name = inp.getAttribute('name') || '';
      const match = name.match(/name_pfmark_cancel(.+)/i);
      if (match) {
        holdId = match[1]; // e.g. "i23891110x04"
        break;
      }
    }

    // Fallback: any input whose name contains 'cancel' and has a non-empty name suffix
    if (!holdId) {
      for (const inp of row.querySelectorAll('input')) {
        const name = inp.getAttribute('name') || '';
        const match = name.match(/cancel[_]?(.+)/i);
        if (match && match[1]) { holdId = match[1]; break; }
      }
    }

    // Extract cancel-by date from the cancel column text
    const cancelTd = row.querySelector('td.patFuncCancel');
    if (cancelTd) {
      const cancelTdClone = cancelTd.cloneNode(true);
      cancelTdClone.querySelectorAll('input').forEach(el => el.remove());
      cancelBy = cancelTdClone.textContent.trim();
    }

    items.push({
      title,
      bib_id: bibId,
      hold_id: holdId,
      status: statusTd ? statusTd.textContent.trim() : '',
      pickup: pickupTd ? pickupTd.textContent.trim() : '',
      cancel_by: cancelBy,
    });
  }
  return items;
}

export async function cancelHold(holdId) {
  // holdId is the item token from the checkbox name suffix, e.g. "i23891110x04"
  const cfg = loadConfig();
  if (!cfg.patron_id || !holdId) return false;
  const holdsUrl = `${BASE_URL}/patroninfo~S${SCOPE}/${cfg.patron_id}/holds`;

  // Step 1: POST checkbox=on + holdpagecmd set to requestUpdateHoldsSome
  // Mirrors: check the box → click "Cancel·lar seleccionats" (submitHold JS sets
  // holdpagecmd.name = 'requestUpdateHoldsSome', holdpagecmd.value = 'requestUpdateHoldsSome')
  const checkboxName = `name_pfmark_cancel${holdId}`;
  const pickupName   = `name_pfpickup_loc${holdId}`;
  const step1Body = [
    `${encodeURIComponent(checkboxName)}=on`,
    `requestUpdateHoldsSome=requestUpdateHoldsSome`,
    `SORT=D`,
    `extended=0`,
    `currentsortorder=current_pickup`,
  ].join('&');
  const step1 = await proxyFetch(holdsUrl, { method: 'POST', body: step1Body });
  if (step1.status !== 200) return false;

  // Step 2: Confirm — the confirmation page posts back to the same URL.
  // Server pre-fills name_pfmark_cancel{holdId}=on and name_pfpickup_loc{holdId}=''
  // as hidden inputs; we replay them plus the "SÍ" submit button.
  const confirmUrl = step1.finalUrl || holdsUrl;
  const step2Body = [
    `${encodeURIComponent(pickupName)}=`,
    `${encodeURIComponent(checkboxName)}=on`,
    `currentsortorder=current_pickup`,
    `updateholdssome=${encodeURIComponent('S\u00CD')}`,
  ].join('&');
  const step2 = await proxyFetch(confirmUrl, { method: 'POST', body: step2Body });
  return step2.status === 200;
}

// ── Hold / Reserve ─────────────────────────────────────────────────

export async function getHoldForm(bibId) {
  const url = `${BASE_URL}/search~S${SCOPE}?/.${bibId}/.${bibId}/1%2C1%2C1%2CB/request~${bibId}`;
  let resp;
  try {
    resp = await proxyFetch(url);
  } catch {
    return null;
  }
  if (resp.status !== 200) return null;
  const doc = parseHTML(resp.text);

  const form = doc.querySelector('form[method="post"], form[method="POST"]');
  if (!form) return null;

  let patronName = '';
  let patronCode = '';
  for (const inp of form.querySelectorAll('input[type="hidden"]')) {
    const name = inp.getAttribute('name');
    if (name === 'name') patronName = inp.getAttribute('value') || '';
    else if (name === 'code') patronCode = inp.getAttribute('value') || '';
  }

  const copies = [];
  const bibitems = form.querySelector('table.bibItems');
  if (bibitems) {
    for (const row of bibitems.querySelectorAll('tr.bibItemsEntry')) {
      const radio = row.querySelector('input[type="radio"]');
      if (!radio) continue;
      const itemId = radio.value || radio.getAttribute('value') || '';
      const cells = row.querySelectorAll('td');
      const location = cells.length > 1 ? cells[1].textContent.trim() : '';
      const callNumber = cells.length > 2 ? cells[2].textContent.trim() : '';
      const status = cells.length > 3 ? cells[3].textContent.trim() : '';
      const notes = cells.length > 4 ? cells[4].textContent.trim() : '';
      if (notes.toLowerCase().includes('cannot be requested')) continue;
      copies.push({ item_id: itemId, location, call_number: callNumber, status, notes });
    }
  }

  let holdTitle = '';
  const main = doc.querySelector('div.pageContentColumn');
  if (main) {
    const text = main.textContent.trim();
    const m = text.match(/Requesting\n(.+)/);
    if (m) holdTitle = m[1].trim();
  }

  return { form_url: url, bib_id: bibId, title: holdTitle, copies, patron_name: patronName, patron_code: patronCode };
}

export async function placeHold(bibId, itemId) {
  const cfg = loadConfig();
  const formUrl = `${BASE_URL}/search~S${SCOPE}?/.${bibId}/.${bibId}/1%2C1%2C1%2CB/request~${bibId}`;
  const body = `radio=${encodeURIComponent(itemId)}&name=${encodeURIComponent(cfg.patron_name || '')}&code=${encodeURIComponent(cfg.barcode || '')}`;
  const resp = await proxyFetch(formUrl, { method: 'POST', body });
  const text = resp.text.toLowerCase();

  if (text.includes('your hold') || (text.includes('request') && text.includes('success'))) {
    return { success: true, message: 'Hold placed successfully.' };
  }
  if (text.includes('already')) {
    return { success: false, message: 'You already have a hold on this item.' };
  }
  if (resp.finalUrl && resp.finalUrl.includes('holds')) {
    return { success: true, message: 'Hold placed successfully.' };
  }
  return { success: true, message: 'Request submitted.' };
}

// ── Test proxy ─────────────────────────────────────────────────────

export async function testProxy() {
  const resp = await proxyFetch(`${BASE_URL}/search~S${SCOPE}/`);
  return resp.status === 200;
}
