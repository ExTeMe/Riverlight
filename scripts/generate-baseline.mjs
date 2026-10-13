import { mkdir, writeFile } from 'node:fs/promises';
import { createBaseline, createLegacyBaseline } from '../src/baseline.js';

const folder = new URL('../tests/fixtures/', import.meta.url);
await mkdir(folder, { recursive: true });
for (const [name, data] of [['base-02-v2.json', createBaseline()], ['base-02-v1.json', createLegacyBaseline()]]) {
  await writeFile(new URL(name, folder), JSON.stringify(data, null, 2) + '\n');
}
