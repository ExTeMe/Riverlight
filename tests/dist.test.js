import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CATALOG } from '../src/catalog.js';
import { checkDist } from '../scripts/check-dist.mjs';

test('static output requires subpath URLs, all model variants, and public files only', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'riverlight-dist-test-'));
  try {
    mkdirSync(path.join(root, 'assets')); mkdirSync(path.join(root, 'models'));
    writeFileSync(path.join(root, 'index.html'), '<script src="/Riverlight/assets/main.js"></script>');
    writeFileSync(path.join(root, 'assets/main.js'), '');
    const glb = Buffer.alloc(12); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(12, 8);
    for (const item of CATALOG.filter(item => !['road', 'bridge', 'path'].includes(item.id))) {
      const stem = item.id === 'mall' ? 'shopping-gallery' : item.id;
      for (const suffix of ['', '_lod']) writeFileSync(path.join(root, `models/${stem}${suffix}.glb`), glb);
    }
    assert.equal(checkDist(root, '/Riverlight/').models, 68);
    writeFileSync(path.join(root, 'index.html'), '<script src="/assets/main.js"></script>');
    assert.throws(() => checkDist(root, '/Riverlight/'), /Invalid built resource URL/);
    writeFileSync(path.join(root, 'index.html'), '<script src="/Riverlight/assets/main.js"></script>');
    writeFileSync(path.join(root, 'source.blend'), 'source file must not deploy');
    assert.throws(() => checkDist(root, '/Riverlight/'), /Unexpected public output/);
    rmSync(path.join(root, 'source.blend'));
    writeFileSync(path.join(root, 'models/shopping-gallery_lod.glb'), 'version https://git-lfs.github.com/spec/v1');
    assert.throws(() => checkDist(root, '/Riverlight/'), /invalid GLB/);
  } finally {
    if (!root.startsWith(path.join(tmpdir(), 'riverlight-dist-test-'))) throw new Error('Unsafe test cleanup target.');
    rmSync(root, { recursive: true, force: true });
  }
});
