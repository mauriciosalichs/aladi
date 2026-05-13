// geocode-branches.mjs
// Geocodes all LIBRARY_BRANCHES via Nominatim and writes coords back.
// Usage: node scripts/geocode-branches.mjs
// Respects Nominatim 1 req/sec policy.

import { readFileSync, writeFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const SRC = new URL('../js/translations.js', import.meta.url).pathname;
const raw = readFileSync(SRC, 'utf8');

// Extract the LIBRARY_BRANCHES array literal via a simple regex slice
const start = raw.indexOf('export const LIBRARY_BRANCHES = [');
const end   = raw.indexOf('];', start) + 2;
const arrayLiteral = raw.slice(start + 'export const LIBRARY_BRANCHES = '.length, end - 1); // strip trailing ;

// Evaluate safely using Function (it's our own trusted source)
const branches = (new Function(`return ${arrayLiteral}`))();

console.log(`Geocoding ${branches.length} branches…\n`);

let ok = 0, failed = 0;

for (let i = 0; i < branches.length; i++) {
  const b = branches[i];
  // Build the best possible query from the branch name
  const dot = b.name.indexOf('. ');
  let q;
  if (dot !== -1) {
    const city   = b.name.slice(0, dot);
    const branch = b.name.slice(dot + 2);
    q = `biblioteca ${branch}, ${city}, Catalunya, Spain`;
  } else {
    q = `biblioteca ${b.name}, Catalunya, Spain`;
  }

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ca,es,en`;

  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'AlaPadPortal/1.0 geocoding-script' } });
    const json = await res.json();
    if (json.length) {
      b.lat = parseFloat(json[0].lat);
      b.lng = parseFloat(json[0].lon);
      ok++;
      process.stdout.write(`  [${i+1}/${branches.length}] ✓  ${b.name}\n`);
    } else {
      failed++;
      process.stdout.write(`  [${i+1}/${branches.length}] ✗  ${b.name}  (no result)\n`);
    }
  } catch (err) {
    failed++;
    process.stdout.write(`  [${i+1}/${branches.length}] ✗  ${b.name}  (${err.message})\n`);
  }

  // Nominatim rate-limit: 1 request per second
  if (i < branches.length - 1) await sleep(1100);
}

console.log(`\nDone: ${ok} geocoded, ${failed} failed.\n`);

// Serialize updated array back into the source file
const newArray = JSON.stringify(branches, null, 2)
  // prettier: keep each object on one line like the original style
  .replace(/\{\s*"code":\s*"([^"]+)",\s*"name":\s*"([^"]+)",\s*"city":\s*"([^"]+)"(?:,\s*"lat":\s*([\d.]+),\s*"lng":\s*([\d.]+))?\s*\}/g,
    (_, code, name, city, lat, lng) => {
      const nameSafe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const citySafe = city.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const coords   = lat ? `, lat: ${lat}, lng: ${lng}` : '';
      return `{ code: '${code}', name: '${nameSafe}', city: '${citySafe}'${coords} }`;
    })
  .replace(/^  /gm, '  '); // ensure 2-space indent

const newSrc = raw.slice(0, start) +
  `export const LIBRARY_BRANCHES = ${newArray};\n` +
  raw.slice(end);

writeFileSync(SRC, newSrc, 'utf8');
console.log('translations.js updated with coordinates.');
