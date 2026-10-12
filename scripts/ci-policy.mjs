import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function shouldPublish({ eventName, ref, changedFiles = [] }) {
  if (ref !== 'refs/heads/dev') return false;
  if (eventName === 'workflow_dispatch') return true;
  if (eventName !== 'push') return false;
  return changedFiles.some(file => {
    if (['scripts/github-management.mjs', 'scripts/github-settings.mjs', 'scripts/ci-policy.mjs',
      'tests/github-management.test.js', 'tests/github-settings.test.js', 'tests/ci.test.js'].includes(file)) return false;
    return /^(src\/|public\/|tests\/|scripts\/|\.github\/workflows\/site\.yml$|index\.html$|vite\.config\.[^/]+$|package(?:-lock)?\.json$)/.test(file);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_EVENT_NAME: eventName, GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output } = process.env;
  let changedFiles = [];
  if (eventName === 'push' && ref === 'refs/heads/dev') {
    const { before } = JSON.parse(readFileSync(eventPath, 'utf8'));
    const args = /^0+$/.test(before) ? ['ls-tree', '-r', '--name-only', '-z', sha] : ['diff', '--name-only', '-z', before, sha];
    changedFiles = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  const publish = shouldPublish({ eventName, ref, changedFiles });
  appendFileSync(output, `publish=${publish}\n`);
  console.log(`Publication eligible: ${publish}`);
}
