import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { shouldPublish, checkPlan, changedFilesForEvent } from '../scripts/ci-policy.mjs';
import { publishStatic } from '../scripts/publish-static.mjs';

test('check selection keeps unknown and application changes on the complete suite', () => {
  assert.deepEqual(checkPlan(['docs/GIT_WORKFLOW.md']), { documentation: true, management: false, application: false });
  assert.deepEqual(checkPlan(['scripts/github-management.mjs', 'tests/github-management.test.js']), { documentation: true, management: true, application: false });
  for (const files of [[], ['package-lock.json'], ['src/core.js'], ['assets/blender/city.blend'], ['.github/workflows/site.yml'], ['unknown.config']]) assert.equal(checkPlan(files).application, true);
  assert.equal(checkPlan(['README.md'], true).application, true);
  const calls = [];
  assert.deepEqual(changedFilesForEvent('pull_request', { pull_request: { base: { sha: 'a'.repeat(40) } } }, 'b'.repeat(40), args => { calls.push(args); return 'docs/a.md\0src/core.js\0'; }), ['docs/a.md', 'src/core.js']);
  assert.equal(calls[0].at(-2), 'a'.repeat(40));
  assert.throws(() => changedFilesForEvent('push', {}, 'b'.repeat(40)), /valid comparison/);
});

test('only dev application pushes and explicit dev runs can publish', () => {
  for (const eventName of ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target', 'workflow_run']) {
    for (const ref of ['refs/heads/main', 'refs/heads/gh-pages', 'refs/pull/1/merge', 'refs/heads/dev']) {
      assert.equal(shouldPublish({ eventName, ref, changedFiles: ['src/main.js'] }),
        ref === 'refs/heads/dev' && ['push', 'workflow_dispatch'].includes(eventName));
    }
  }
  assert.equal(shouldPublish({ eventName: 'push', ref: 'refs/heads/dev', changedFiles: ['README.md', 'AGENTS.md', 'docs/PROGRESS.md'] }), false);
  assert.equal(shouldPublish({ eventName: 'push', ref: 'refs/heads/dev', changedFiles: ['docs/PROGRESS.md', 'public/models/house.glb'] }), true);
  assert.equal(shouldPublish({ eventName: 'push', ref: 'refs/heads/dev', changedFiles: ['.github/workflows/project-management.yml', 'scripts/github-management.mjs', 'tests/github-management.test.js'] }), false);
  assert.equal(shouldPublish({ eventName: 'push', ref: 'refs/heads/dev', changedFiles: ['scripts/github-settings.mjs', 'scripts/ci-policy.mjs', 'tests/github-settings.test.js', 'tests/ci.test.js'] }), false);
});

test('static snapshots preserve source checkout, update assets, remove obsolete output, and keep history', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'riverlight-ci-test-'));
  try {
    const cwd = path.join(temporary, 'source'), remote = path.join(temporary, 'remote.git'), dist = path.join(cwd, 'dist');
    mkdirSync(cwd); mkdirSync(dist);
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    git('init', '--bare', remote); git('init', '-b', 'dev');
    git('config', 'user.name', 'CI Test'); git('config', 'user.email', 'ci-test@example.invalid');
    git('config', 'commit.gpgsign', 'false'); // Fixture commits must not depend on the developer's signing key.
    writeFileSync(path.join(cwd, '.gitignore'), 'dist/\n');
    writeFileSync(path.join(cwd, 'source.txt'), 'source remains private to source branches');
    git('add', '.'); git('commit', '-m', 'test source'); git('remote', 'add', 'origin', remote);
    const sourceSha = git('rev-parse', 'HEAD');
    writeFileSync(path.join(dist, 'index.html'), 'first output');
    writeFileSync(path.join(dist, 'obsolete.js'), 'obsolete');
    const first = publishStatic({ cwd, dist, sourceSha, tempRoot: temporary });
    assert.equal(first.changed, true);
    assert.equal(git('show', `${first.commit}:index.html`), 'first output');
    assert.equal(git('ls-tree', '-r', '--name-only', first.commit).includes('source.txt'), false);
    assert.equal(publishStatic({ cwd, dist, sourceSha, tempRoot: temporary }).changed, false);
    rmSync(path.join(dist, 'obsolete.js'));
    writeFileSync(path.join(dist, 'index.html'), 'second output');
    const second = publishStatic({ cwd, dist, sourceSha, tempRoot: temporary });
    assert.equal(git('rev-parse', `${second.commit}^`), first.commit);
    assert.equal(git('show', `${second.commit}:index.html`), 'second output');
    assert.equal(git('ls-tree', '-r', '--name-only', second.commit), 'index.html');
    assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'dev');
    assert.equal(git('rev-parse', 'HEAD'), sourceSha);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(readFileSync(path.join(cwd, 'source.txt'), 'utf8'), 'source remains private to source branches');
    assert.throws(() => publishStatic({ cwd, dist, sourceSha: first.commit }), /validated commit/);
  } finally {
    // This directory is exclusively created by this test, under the OS temp root.
    if (!temporary.startsWith(path.join(tmpdir(), 'riverlight-ci-test-'))) throw new Error('Unsafe test cleanup target.');
    rmSync(temporary, { recursive: true, force: true });
  }
});
