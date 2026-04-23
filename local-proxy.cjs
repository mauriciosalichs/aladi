#!/usr/bin/env node
/**
 * Aladí Library Portal — Local CORS Proxy
 *
 * Zero-dependency Node.js proxy for local development.
 * Mirrors the Cloudflare Worker API exactly:
 *   - Receives requests from the browser with X-Target-URL header
 *   - Forwards them to aladi.diba.cat
 *   - Returns CORS headers + X-Set-Cookie + X-Final-URL
 *
 * Requirements: Node.js 18+ (built-in http/https only, no npm install needed)
 *
 * Usage:
 *   node local-proxy.cjs
 *
 * Then in the portal Settings, set the proxy URL to:
 *   http://localhost:8787/
 *
 * To serve the site files at the same time, open a second terminal and run:
 *   npx serve .        (if you have npx)
 *   python3 -m http.server 8080   (zero dependencies)
 *
 * Then open: http://localhost:8080
 */

'use strict';
const http  = require('http');
const https = require('https');
const { URL } = require('url');

const PORT        = 8787;
const TARGET_HOST = 'aladi.diba.cat';

// ── helpers ────────────────────────────────────────────────────────

function setCorsHeaders(res, origin) {
  res.setHeader('Access-Control-Allow-Origin',  origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Custom-Cookie, X-Target-URL');
  res.setHeader('Access-Control-Expose-Headers','X-Set-Cookie, X-Final-URL');
  res.setHeader('Access-Control-Max-Age',       '86400');
}

function jsonErr(res, origin, code, msg) {
  setCorsHeaders(res, origin);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

function parseCookieHeader(setCookieArr) {
  const cookies = {};
  for (const sc of setCookieArr) {
    const nameVal = sc.split(';')[0];
    const eq = nameVal.indexOf('=');
    if (eq > 0) {
      cookies[nameVal.slice(0, eq).trim()] = nameVal.slice(eq + 1).trim();
    }
  }
  return cookies;
}

// Perform one HTTPS request, return { statusCode, headers, body, setCookies[] }
function httpsRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method,
      headers,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawCookies = [];
        // Node.js may merge set-cookie; prefer the raw headers object
        if (res.headers['set-cookie']) {
          rawCookies.push(...(Array.isArray(res.headers['set-cookie'])
            ? res.headers['set-cookie']
            : [res.headers['set-cookie']]));
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          setCookies: rawCookies,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Follow redirects, accumulate cookies
async function fetchFollowRedirects(method, startUrl, fwdHeaders, body) {
  let currentUrl = startUrl;
  let currentMethod = method;
  let currentBody = body;
  const allCookies = {};
  let last;

  for (let i = 0; i < 10; i++) {
    // Merge accumulated cookies into the Cookie header
    const cookieParts = [];
    const customCookie = fwdHeaders['X-Custom-Cookie'] || fwdHeaders['x-custom-cookie'] || '';
    if (customCookie) cookieParts.push(customCookie);
    for (const [k, v] of Object.entries(allCookies)) {
      // Skip if already present in customCookie
      if (!customCookie.includes(`${k}=`)) {
        cookieParts.push(`${k}=${v}`);
      }
    }

    const sendHeaders = { ...fwdHeaders };
    delete sendHeaders['x-custom-cookie'];
    delete sendHeaders['X-Custom-Cookie'];
    delete sendHeaders['x-target-url'];
    delete sendHeaders['X-Target-URL'];
    delete sendHeaders['host'];
    sendHeaders['Host'] = TARGET_HOST;
    if (cookieParts.length) sendHeaders['Cookie'] = cookieParts.join('; ');
    if (currentMethod === 'POST' && currentBody) {
      sendHeaders['Content-Length'] = Buffer.byteLength(currentBody).toString();
      sendHeaders['Referer'] = currentUrl;
      sendHeaders['Origin'] = `https://${TARGET_HOST}`;
    } else {
      delete sendHeaders['Content-Type'];
      delete sendHeaders['Content-Length'];
    }

    last = await httpsRequest(currentMethod, currentUrl, sendHeaders, currentMethod === 'POST' ? currentBody : null);

    // Collect cookies
    Object.assign(allCookies, parseCookieHeader(last.setCookies));

    // Follow redirect
    if (last.statusCode >= 300 && last.statusCode < 400 && last.headers.location) {
      const loc = last.headers.location;
      currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
      currentMethod = 'GET';
      currentBody = null;
    } else {
      break;
    }
  }

  return { response: last, finalUrl: currentUrl, allCookies };
}

// ── HTTP server ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'] || '*';

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  const targetUrl = req.headers['x-target-url'];
  if (!targetUrl) {
    return jsonErr(res, origin, 400, 'Missing X-Target-URL header');
  }

  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return jsonErr(res, origin, 400, 'Invalid target URL'); }

  if (parsed.hostname !== TARGET_HOST) {
    return jsonErr(res, origin, 403, `Only ${TARGET_HOST} is allowed`);
  }

  // Read request body
  const bodyChunks = [];
  req.on('data', c => bodyChunks.push(c));
  req.on('end', async () => {
    const bodyBuf = bodyChunks.length ? Buffer.concat(bodyChunks) : null;

    const fwdHeaders = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };

    if (req.headers['x-custom-cookie'])  fwdHeaders['X-Custom-Cookie']  = req.headers['x-custom-cookie'];
    if (req.headers['content-type'])     fwdHeaders['Content-Type']      = req.headers['content-type'];

    try {
      const { response, finalUrl, allCookies } = await fetchFollowRedirects(
        req.method,
        targetUrl,
        fwdHeaders,
        bodyBuf ? bodyBuf.toString() : null
      );

      setCorsHeaders(res, origin);
      res.setHeader('X-Final-URL', finalUrl);
      res.setHeader('Content-Type', response.headers['content-type'] || 'text/html; charset=utf-8');

      const cookieEntries = Object.entries(allCookies);
      if (cookieEntries.length) {
        res.setHeader('X-Set-Cookie', JSON.stringify(cookieEntries.map(([k, v]) => `${k}=${v}`)));
      }

      const statusCode = (response.statusCode >= 300 && response.statusCode < 400) ? 200 : response.statusCode;
      res.writeHead(statusCode);
      res.end(response.body);
    } catch (err) {
      jsonErr(res, origin, 500, err.message);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ Aladí local proxy running at http://127.0.0.1:${PORT}/`);
  console.log('');
  console.log('Configure the portal Settings URL to:  http://127.0.0.1:8787/');
  console.log('');
  console.log('To serve the site, run in another terminal:');
  console.log('  python3 -m http.server 8080   →  open http://localhost:8080');
  console.log('');
  console.log('Press Ctrl+C to stop.');
});
