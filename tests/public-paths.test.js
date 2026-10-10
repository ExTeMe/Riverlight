import test from 'node:test';
import assert from 'node:assert/strict';
import { containsLocalPath } from '../scripts/check-public-paths.mjs';

test('privacy check rejects local Windows locations with both separators', () => {
  for (const separator of ['/', '\\']) {
    assert.equal(containsLocalPath(['C:', 'Users', 'local-person', 'project'].join(separator)), true);
    assert.equal(containsLocalPath(['D:', 'project'].join(separator)), true);
  }
});
test('privacy check rejects personal Unix paths and UTF-16 binary metadata', () => {
  const personal = ['', 'home', 'local-person', 'project'].join('/');
  assert.equal(containsLocalPath(personal), true);
  assert.equal(containsLocalPath(Buffer.from(['C:', 'Users', 'local-person'].join('/'), 'utf16le')), true);
});
test('privacy check allows repository relative paths and web URLs', () => {
  for (const value of ['docs/PROGRESS.md', 'assets/blender/library.blend', 'https://example.com/models/a.glb', 'RIVERLIGHT_PROJECT_ROOT']) {
    assert.equal(containsLocalPath(value), false);
  }
  assert.equal(containsLocalPath(Buffer.from([0, 83, 58, 47, 0, 255])), false);
});
