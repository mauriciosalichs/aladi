/**
 * Cloudflare Worker — CORS Proxy for Aladí Library Portal (GitHub Pages edition)
 *
 * Deploy this worker to Cloudflare Workers (free tier: 100 000 req/day).
 * It relays requests to aladi.diba.cat, forwarding cookies bidirectionally
 * via custom headers so the browser-based SPA can maintain an authenticated session.
 *
 * Setup (web UI — no CLI needed):
 *   1. Create a Cloudflare account (free) at https://dash.cloudflare.com
 *   2. Go to Workers & Pages → Create application → Create Worker
 *   3. Give it a name → click "Deploy" (deploys the hello-world placeholder)
 *   4. Click "Edit code" — this opens an online code editor
 *   5. Select ALL the placeholder code in the editor (Ctrl+A) and DELETE it
 *   6. PASTE the entire content of this file into the editor  ← do NOT upload the file
 *   7. Click "Deploy" (top right of the editor)
 *   8. Copy the worker URL (e.g. https://aladi-proxy.YOUR_SUBDOMAIN.workers.dev/)
 *   9. Paste that URL as the proxy_url default in js/config.js
 */

const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|.*\.github\.io)$/;
const TARGET_HOST = 'aladi.diba.cat';

// Service Worker format — works with the Cloudflare web UI editor (no wrangler needed)
addEventListener('fetch', event => {
  event.respondWith(
    event.request.method === 'OPTIONS'
      ? handleCORS(event.request)
      : handleRequest(event.request).catch(err =>
          jsonResponse({ error: err.message }, 500, event.request)
        )
  );
});

function handleCORS(request) {
  const origin = request.headers.get('Origin') || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Custom-Cookie, X-Target-URL',
      'Access-Control-Expose-Headers': 'X-Set-Cookie, X-Final-URL',
      'Access-Control-Max-Age': '86400',
    },
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const targetUrl = request.headers.get('X-Target-URL') || url.searchParams.get('url');

  if (!targetUrl) {
    return jsonResponse({ error: 'Missing target URL. Use X-Target-URL header or ?url= param.' }, 400, request);
  }

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return jsonResponse({ error: 'Invalid target URL.' }, 400, request);
  }

  if (parsedTarget.hostname !== TARGET_HOST) {
    return jsonResponse({ error: `Only ${TARGET_HOST} is allowed.` }, 403, request);
  }

  // Build forwarded headers
  const fwdHeaders = new Headers();
  fwdHeaders.set('User-Agent',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  fwdHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  fwdHeaders.set('Accept-Language', 'en-US,en;q=0.5');

  // Forward cookies from the client's custom header
  const customCookie = request.headers.get('X-Custom-Cookie');
  if (customCookie) {
    fwdHeaders.set('Cookie', customCookie);
  }

  // Forward Content-Type for POST
  const ct = request.headers.get('Content-Type');
  if (ct) fwdHeaders.set('Content-Type', ct);

  // Forward Referer/Origin for POST
  if (request.method === 'POST') {
    fwdHeaders.set('Referer', targetUrl);
    fwdHeaders.set('Origin', `https://${TARGET_HOST}`);
  }

  // Follow redirect chain manually to accumulate cookies
  let currentUrl = targetUrl;
  let body = request.method !== 'GET' && request.method !== 'HEAD'
    ? await request.text()
    : undefined;
  let method = request.method;
  const allCookies = {};
  let response;

  for (let i = 0; i < 10; i++) {
    // Rebuild cookie header with accumulated cookies
    const cookieParts = [];
    if (customCookie) cookieParts.push(customCookie);
    for (const [k, v] of Object.entries(allCookies)) {
      cookieParts.push(`${k}=${v}`);
    }
    if (cookieParts.length) {
      fwdHeaders.set('Cookie', cookieParts.join('; '));
    }

    response = await fetch(currentUrl, {
      method,
      headers: fwdHeaders,
      body: method === 'POST' ? body : undefined,
      redirect: 'manual',
    });

    // Collect Set-Cookie headers
    // Cloudflare Workers: response.headers.getAll is available
    const setCookieHeaders = response.headers.getAll
      ? response.headers.getAll('set-cookie')
      : [response.headers.get('set-cookie')].filter(Boolean);

    for (const sc of setCookieHeaders) {
      // May contain multiple cookies separated by comma (rare but possible)
      const nameVal = sc.split(';')[0];
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) {
        allCookies[nameVal.substring(0, eqIdx).trim()] = nameVal.substring(eqIdx + 1).trim();
      }
    }

    // Follow redirects
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        currentUrl = new URL(location, currentUrl).href;
        method = 'GET';
        body = undefined;
        fwdHeaders.delete('Content-Type');
        continue;
      }
    }
    break;
  }

  // Build the response with CORS headers
  const origin = request.headers.get('Origin') || '*';
  const respHeaders = new Headers();
  respHeaders.set('Access-Control-Allow-Origin', origin);
  respHeaders.set('Access-Control-Expose-Headers', 'X-Set-Cookie, X-Final-URL');
  respHeaders.set('Content-Type', response.headers.get('Content-Type') || 'text/html; charset=utf-8');

  // Expose cookies and final URL
  const cookieEntries = Object.entries(allCookies);
  if (cookieEntries.length) {
    respHeaders.set('X-Set-Cookie', JSON.stringify(
      cookieEntries.map(([k, v]) => `${k}=${v}`)
    ));
  }
  respHeaders.set('X-Final-URL', currentUrl);

  return new Response(response.body, {
    status: response.status >= 300 && response.status < 400 ? 200 : response.status,
    headers: respHeaders,
  });
}

function jsonResponse(obj, status, request) {
  const origin = request?.headers?.get('Origin') || '*';
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  });
}
