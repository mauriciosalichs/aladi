// geocode-branches-retry.mjs
// Second pass: retry failed branches (no lat/lng) with simpler city-level queries
// Usage: node scripts/geocode-branches-retry.mjs

import { readFileSync, writeFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const SRC = new URL('../js/translations.js', import.meta.url).pathname;
const raw = readFileSync(SRC, 'utf8');

const start = raw.indexOf('export const LIBRARY_BRANCHES = [');
const end   = raw.indexOf('];', start) + 2;
const arrayLiteral = raw.slice(start + 'export const LIBRARY_BRANCHES = '.length, end - 1);
const branches = (new Function(`return ${arrayLiteral}`))();

const toRetry = branches.filter(b => b.lat === undefined);
console.log(`Retrying ${toRetry.length} branches with simplified queries…\n`);

let ok = 0, failed = 0;

for (let i = 0; i < toRetry.length; i++) {
  const b = toRetry[i];

  // Try progressively simpler queries
  const queries = [];
  const dot = b.name.indexOf('. ');
  if (dot !== -1) {
    const city   = b.name.slice(0, dot);
    const branch = b.name.slice(dot + 2);
    // Try just the branch name + city
    queries.push(`${branch} ${city} Catalunya Spain`);
    // Try just "biblioteca" + city
    queries.push(`biblioteca ${city} Catalunya Spain`);
    // Try plain city
    queries.push(`${city} Catalunya Spain`);
  } else {
    queries.push(`biblioteca ${b.name} Catalunya Spain`);
    queries.push(`${b.city} Catalunya Spain`);
  }

  let found = false;
  for (const q of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ca,es,en`;
    try {
      const res  = await fetch(url, { headers: { 'User-Agent': 'AladiPortal/1.0 geocoding-retry' } });
      const json = await res.json();
      if (json.length) {
        b.lat = parseFloat(json[0].lat);
        b.lng = parseFloat(json[0].lon);
        ok++;
        process.stdout.write(`  [${i+1}/${toRetry.length}] ✓  ${b.name}  →  "${q}"\n`);
        found = true;
        break;
      }
    } catch (err) {
      process.stdout.write(`  [${i+1}/${toRetry.length}] error  ${err.message}\n`);
    }
    await sleep(1100);
  }
  if (!found) {
    failed++;
    process.stdout.write(`  [${i+1}/${toRetry.length}] ✗  ${b.name}\n`);
  }
  if (i < toRetry.length - 1) await sleep(1100);
}

console.log(`\nRetry done: ${ok} recovered, ${failed} still missing.\n`);

// Serialize back
const newArray = JSON.stringify(branches, null, 2)
  .replace(/\{\s*"code":\s*"([^"]+)",\s*"name":\s*"([^"]+)",\s*"city":\s*"([^"]+)"(?:,\s*"lat":\s*([\d.-]+),\s*"lng":\s*([\d.-]+))?\s*\}/g,
    (_, code, name, city, lat, lng) => {
      const nameSafe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const citySafe = city.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const coords   = lat ? `, lat: ${lat}, lng: ${lng}` : '';
      return `{ code: '${code}', name: '${nameSafe}', city: '${citySafe}'${coords} }`;
    });

const newSrc = raw.slice(0, start) +
  `export const LIBRARY_BRANCHES = ${newArray};\n` +
  raw.slice(end);

writeFileSync(SRC, newSrc, 'utf8');
console.log('translations.js updated.');
