import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const managementFile = file => /^(?:scripts\/(?:github-[^/]+|ci-policy|check-docs|workflow-command)\.mjs|tests\/(?:github-[^/]+|ci|check-docs|workflow-command)\.test\.js|\.github\/workflows\/(?:project-management|repository-settings)\.yml)$/.test(file);
const documentationFile = file => /\.md$/.test(file) || /^\.github\/(?:ISSUE_TEMPLATE\/[^/]+\.yml|CODEOWNERS)$/.test(file);

export function checkPlan(changedFiles, full = false) {
  // Unknown paths and explicit manual runs keep the complete regression suite.
  const application = full || !changedFiles.length || changedFiles.some(file => !managementFile(file) && !documentationFile(file));
  return { documentation: true, management: application || changedFiles.some(managementFile), application };
}

export function changedFilesForEvent(eventName, event, sha, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  if (eventName === 'workflow_dispatch') return [];
  const before = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  if (!/^[a-f0-9]{40}$/.test(before || '') || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Check selection requires valid comparison revisions.');
  const args = /^0+$/.test(before) ? ['ls-tree', '-r', '--name-only', '-z', sha]
    : ['diff', '--name-only', '-z', before, sha];
  return git(args).split('\0').filter(Boolean);
}

export function shouldPublish({ eventName, ref, changedFiles = [] }) {
  if (ref !== 'refs/heads/dev') return false;
  if (eventName === 'workflow_dispatch') return true;
  if (eventName !== 'push') return false;
  return changedFiles.some(file => {
    if (managementFile(file) || documentationFile(file)) return false;
    if (['scripts/github-management.mjs', 'scripts/github-collaboration.mjs', 'scripts/github-settings.mjs', 'scripts/ci-policy.mjs',
      'tests/github-management.test.js', 'tests/github-collaboration.test.js', 'tests/github-settings.test.js', 'tests/ci.test.js'].includes(file)) return false;
    return /^(src\/|public\/|tests\/|scripts\/|\.github\/workflows\/site\.yml$|index\.html$|vite\.config\.[^/]+$|package(?:-lock)?\.json$)/.test(file);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_EVENT_NAME: eventName, GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output } = process.env;
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const changedFiles = changedFilesForEvent(eventName, event, sha);
  const plan = checkPlan(changedFiles, eventName === 'workflow_dispatch');
  const publish = shouldPublish({ eventName, ref, changedFiles });
  appendFileSync(output, `publish=${publish}\nmanagement=${plan.management}\napplication=${plan.application}\n`);
  console.log(`Checks: ${JSON.stringify(plan)}; publication eligible: ${publish}`);
}
