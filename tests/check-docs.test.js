import test from 'node:test';
import assert from 'node:assert/strict';
import { localLinks } from '../scripts/check-docs.mjs';

test('document links exclude external destinations and fenced examples', () => {
  assert.deepEqual(localLinks('[local](docs/a.md#section) [remote](https://example.invalid) [anchor](#x)\n```md\n[example](missing.md)\n```\n![image](public/a.png)'), ['docs/a.md#section', 'public/a.png']);
});
