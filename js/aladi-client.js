// Aladí Library Portal — HTTP Client (browser-side, uses CORS proxy)

import { loadConfig, saveConfig } from './config.js';

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

export async function search(query, searchType = 'X', scope = '171', sort = 'D', page = 1, availableOnly = false) {
  const params = new URLSearchParams({
    searchtype: searchType,
    searcharg: query,
    searchscope: scope,
    SORT: sort,
  });
  const url = `${BASE_URL}/search~S${scope}/?${params}`;
  const resp = await proxyFetch(url);
  const data = parseResults(resp.text, query, searchType, scope, page);
  if (availableOnly) {
    data.results = data.results.filter(
      r => r.availability && r.availability.some(i => i.status === 'Available')
    );
  }
  return data;
}

export async function collapseSearch(query, searchType = 'X', scope = '171', sort = 'D', availableOnly = false) {
  const results = await search(query, searchType, scope, sort);
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

  allCopies.sort((a, b) => {
    const lib = a.library.toLowerCase().localeCompare(b.library.toLowerCase());
    if (lib !== 0) return lib;
    return (a.status === 'Available' ? 0 : 1) - (b.status === 'Available' ? 0 : 1);
  });

  if (availableOnly) {
    allCopies = allCopies.filter(c => c.status === 'Available');
  }

  const grouped = {};
  for (const copy of allCopies) {
    if (!grouped[copy.library]) grouped[copy.library] = [];
    grouped[copy.library].push(copy);
  }
  const groupedCopies = Object.entries(grouped);

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
    if (m) total = parseInt(m[2], 10);
  }

  const briefRows = doc.querySelectorAll('td.briefCitRow');
  let books;
  let isBrowse = false;

  if (briefRows.length) {
    books = [];
    briefRows.forEach(row => {
      const b = parseBriefRow(row);
      if (b) books.push(b);
    });
  } else {
    books = parseBrowseList(doc, searchType, scope);
    isBrowse = books.length > 0;
    if (!total && books.length) total = books.length;
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

    // ── ROBUST hold_id extraction ──────────────────────────────────
    // Strategy 1: Look in patFuncCancel column for checkbox
    // Strategy 2: Look for any input with value matching h\d+ in the entire row
    // Strategy 3: Look for hidden inputs with name containing 'cancel'
    // Strategy 4: Look in name attribute of any input
    // Strategy 5: Regex the full row HTML for hold record pattern
    let holdId = '';
    let cancelBy = '';

    // Strategy 1: Standard cancel column
    const cancelTd = row.querySelector('td.patFuncCancel');
    if (cancelTd) {
      const chk = cancelTd.querySelector('input[type="checkbox"], input[type="CHECKBOX"]');
      if (chk) {
        holdId = chk.value || chk.getAttribute('value') || '';
      }
      // If not found, try any input in the cancel cell
      if (!holdId) {
        for (const inp of cancelTd.querySelectorAll('input')) {
          const val = inp.value || inp.getAttribute('value') || '';
          if (/^h\d+$/i.test(val)) { holdId = val; break; }
        }
      }
      // Extract cancel-by date (remove inputs first for clean text)
      const cancelTdClone = cancelTd.cloneNode(true);
      cancelTdClone.querySelectorAll('input').forEach(el => el.remove());
      cancelBy = cancelTdClone.textContent.trim();
    }

    // Strategy 2: Search entire row for any input with h\d+ value
    if (!holdId) {
      for (const inp of row.querySelectorAll('input')) {
        const val = inp.value || inp.getAttribute('value') || '';
        if (/^h\d+$/i.test(val)) { holdId = val; break; }
        const name = inp.name || inp.getAttribute('name') || '';
        if (/^h\d+$/i.test(name)) { holdId = name; break; }
      }
    }

    // Strategy 3: Look for cancel-related names
    if (!holdId) {
      for (const inp of row.querySelectorAll('input[name*="cancel"], input[name*="Cancel"]')) {
        const val = inp.value || inp.getAttribute('value') || '';
        if (val && /^h?\d+$/.test(val)) {
          holdId = val.startsWith('h') ? val : 'h' + val;
          break;
        }
      }
    }

    // Strategy 4: Regex the raw HTML of the row
    if (!holdId) {
      const rowHtml = row.innerHTML || '';
      const htmlMatch = rowHtml.match(/value\s*=\s*["']?(h\d+)["']?/i);
      if (htmlMatch) holdId = htmlMatch[1];
    }

    // Strategy 5: Look for hold ID in any href containing "holds"
    if (!holdId) {
      for (const a of row.querySelectorAll('a[href*="hold"]')) {
        const href = a.getAttribute('href') || '';
        const hm = href.match(/(h\d+)/);
        if (hm) { holdId = hm[1]; break; }
      }
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
  const cfg = loadConfig();
  if (!cfg.patron_id || !holdId) return false;
  const url = `${BASE_URL}/patroninfo~S${SCOPE}/${cfg.patron_id}/holds`;
  const body = `cancelHold%5B%5D=${encodeURIComponent(holdId)}&updateHoldsAccount=${encodeURIComponent('Cancel Marked')}`;
  const resp = await proxyFetch(url, { method: 'POST', body });
  return resp.status === 200;
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
