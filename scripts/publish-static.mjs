import { execFileSync } from 'node:child_process';
import { mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDist } from './check-dist.mjs';

// An isolated index builds a tree from dist without switching the source checkout
// or staging its files. A regular push rejects concurrent branch changes.
export function publishStatic({ cwd, dist, sourceSha, remote = 'origin', tempRoot = tmpdir() }) {
  const run = (args, options = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  if (run(['rev-parse', 'HEAD']) !== sourceSha) throw new Error('Source checkout does not match the validated commit.');
  const ref = 'refs/heads/gh-pages';
  const previous = run(['ls-remote', '--heads', remote, ref]).split(/\s/)[0];
  if (previous) run(['fetch', '--no-tags', remote, ref]);
  const temporary = mkdtempSync(path.join(tempRoot, 'riverlight-index-'));
  const index = path.join(temporary, 'index');
  try {
    const env = { ...process.env, GIT_INDEX_FILE: index, GIT_WORK_TREE: path.resolve(dist),
      GIT_AUTHOR_NAME: 'github-actions[bot]', GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'github-actions[bot]', GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com' };
    run(['read-tree', '--empty'], { env });
    run(['add', '--all'], { env });
    const tree = run(['write-tree'], { env });
    if (previous && run(['rev-parse', `${previous}^{tree}`]) === tree) return { changed: false, commit: previous };
    const commit = run(['commit-tree', tree, ...(previous ? ['-p', previous] : [])], {
      env, input: `build: publish static output from ${sourceSha}\n`,
    });
    run(['push', remote, `${commit}:${ref}`]);
    return { changed: true, commit };
  } finally {
    if (existsSync(index)) unlinkSync(index);
    rmdirSync(temporary);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/dev' ||
      !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error('Static publication is restricted to trusted dev workflow runs.');
  }
  const cwd = fileURLToPath(new URL('../', import.meta.url)), dist = path.join(cwd, 'dist');
  checkDist(dist, process.env.SITE_BASE);
  console.log(publishStatic({ cwd, dist, sourceSha: process.env.GITHUB_SHA, tempRoot: process.env.RUNNER_TEMP }));
}
