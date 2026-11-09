import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the actual recorder with a screenshot failure after the first sample.
// No browser timing or rendering is simulated as evidence by this unit test.
test('recording retains samples and the failing stage when a screenshot fails', async () => {
  const source = (await readFile(new URL('./evidence/dynamics.spec.js', import.meta.url), 'utf8'))
    .replace("import { test, expect } from '@playwright/test';", '')
    .replace("import { writeFile } from 'node:fs/promises';", '');
  const cases = [];
  const { writeFile } = await import('node:fs/promises');
  const register = new Function('test', 'expect', 'writeFile', source);
  register((name, run) => cases.push(run), () => ({ toHaveCount: async () => {} }), writeFile);
  const directory = await mkdtemp(join(tmpdir(), 'riverlight-evidence-'));
  const failure = new Error('Screenshot interrupted');
  let evaluations = 0;
  let attached;
  try {
    await assert.rejects(cases[0]({ page: {
      on() {}, goto: async () => {},
      locator: () => ({ click: async () => {} }),
      evaluate: async () => ++evaluations === 1 ? { revision: 'test-revision' } : { entities: 76 },
      waitForTimeout: async () => {},
      screenshot: async () => { throw failure; },
    } }, {
      outputPath: name => join(directory, name),
      attach: async (name, attachment) => { attached = attachment.path; },
    }), error => error === failure);
    const result = JSON.parse(await readFile(join(directory, 'observations.json'), 'utf8'));
    assert.equal(result.status, 'failed');
    assert.equal(result.stage, 'initial');
    assert.equal(result.failure, failure.message);
    assert.equal(result.context.revision, 'test-revision');
    assert.equal(result.samples.length, 1);
    assert.deepEqual(result.samples[0].stats, { entities: 76 });
    assert.equal(attached, join(directory, 'observations.json'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
