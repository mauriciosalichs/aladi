// Aladí Library Portal — Config (localStorage)

const STORAGE_KEY = 'aladi_config';

const DEFAULTS = {
  language: 'en',
  search_type: 'X',
  scope: '171',
  sort: 'D',
  available_only: false,
  collapse_editions: false,
  proxy_url: 'https://YOUR_WORKER_NAME.YOUR_SUBDOMAIN.workers.dev/',
  session_cookies: {},
  patron_id: '',
  patron_name: '',
  barcode: '',
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return { ...DEFAULTS, ...data };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function saveConfig(cfg) {
  const toSave = {};
  for (const key of Object.keys(DEFAULTS)) {
    toSave[key] = cfg[key] !== undefined ? cfg[key] : DEFAULTS[key];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* ignore */ }
}

export function clearSession() {
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    session_cookies: {},
    patron_id: '',
    patron_name: '',
  });
}

export function isLoggedIn() {
  const cfg = loadConfig();
  return !!(cfg.patron_id && Object.keys(cfg.session_cookies).length);
}

export function getProxyUrl() {
  const cfg = loadConfig();
  return cfg.proxy_url || '';
}
