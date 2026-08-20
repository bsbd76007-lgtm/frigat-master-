/**
 * FRIGAT — i18n key validator
 *
 * Two checks the type system cannot make:
 *   1. every t('a.b.c') in the source resolves against en.json
 *   2. en.json and ru.json hold exactly the same key set
 *
 * `Messages = typeof en` already makes a key *missing from ru.json* a compile
 * error, but a key that exists in neither — a typo in a t() call — type-checks
 * fine and renders the raw path to the player. That is what this catches.
 *
 *   node scripts/check-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url)));
const ru = JSON.parse(readFileSync(new URL('../locales/ru.json', import.meta.url)));

const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]
  );

const enKeys = new Set(flat(en).map(([k]) => k));
const ruKeys = new Set(flat(ru).map(([k]) => k));

let failures = 0;

for (const k of enKeys) if (!ruKeys.has(k)) { console.error(`missing in ru.json: ${k}`); failures++; }
for (const k of ruKeys) if (!enKeys.has(k)) { console.error(`orphan in ru.json:  ${k}`); failures++; }

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'scripts') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(entry)) files.push(p);
  }
})(fileURLToPath(new URL('..', import.meta.url)));

const root = fileURLToPath(new URL('..', import.meta.url));
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) {
    if (!enKeys.has(m[1])) {
      console.error(`unknown key ${m[1]} -> ${f.replace(root, '')}`);
      failures++;
    }
  }
}

console.log(
  failures
    ? `\n${failures} i18n problem(s)`
    : `i18n OK - ${enKeys.size} keys, en/ru in sync, every t() resolves`
);
process.exit(failures ? 1 : 0);
