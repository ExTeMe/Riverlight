import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../src/catalog.js';

export function checkDist(root, base) {
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('Base must be an absolute URL path ending in /.');
  const files = [];
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir)) {
      const name = `${prefix}${entry}`, location = path.join(dir, entry), stat = lstatSync(location);
      if (stat.isSymbolicLink()) throw new Error(`Symlink in output: ${name}`);
      if (stat.isDirectory()) walk(location, `${name}/`);
      else {
        if (!/^(index\.html|favicon\.svg|\.nojekyll|assets\/[^/]+\.(js|css)|models\/[^/]+\.glb)$/.test(name)) {
          throw new Error(`Unexpected public output: ${name}`);
        }
        files.push(name);
      }
    }
  }
  walk(root);
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  if (!urls.some(url => url.endsWith('.js'))) throw new Error('Built HTML has no script.');
  for (const url of urls) {
    if (!url.startsWith(base) || !files.includes(url.slice(base.length))) throw new Error(`Invalid built resource URL: ${url}`);
  }
  let models = 0;
  for (const item of CATALOG.filter(item => !['road', 'bridge', 'path'].includes(item.id))) {
    const stem = item.id === 'mall' ? 'shopping-gallery' : item.id;
    for (const suffix of ['', '_lod']) {
      const file = `models/${stem}${suffix}.glb`, data = readFileSync(path.join(root, file));
      if (data.length < 12 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(8) !== data.length) {
        throw new Error(`Missing or invalid GLB: ${file}`);
      }
      models++;
    }
  }
  return { files: files.length, models, base };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  console.log('Static output verified:', checkDist(root, process.argv[2] || '/'));
}
