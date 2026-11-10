import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('retired management entry exits without credentials, event files or API access', () => {
  const output = execFileSync(process.execPath, ['scripts/github-management.mjs'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'example/example', GITHUB_EVENT_PATH: 'nonexistent-event.json',
      GITHUB_TOKEN: '', PROJECT_TOKEN: '', COLLABORATION_ENABLED: 'true' },
  });
  assert.match(output, /retired/);
});
