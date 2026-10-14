import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readReceipts, taskBranchValid } from './github-collaboration.mjs';

const split = value => (value || '').split('、').map(part => part.trim()).filter(Boolean);
export function workflowComment({ action, branch, comments = [], executor, display, scope, addFiles, removeFiles, sessions }) {
  if (!taskBranchValid(branch)) throw new Error('Select a valid task branch first.');
  const current = readReceipts(comments).filter(record => record.accepted).at(-1)?.claim;
  const identity = executor || (action === 'claim' ? 'agent-' + createHash('sha256').update(branch).digest('hex').slice(0, 12) : current?.executor);
  if (!['claim', 'update', 'release'].includes(action)) throw new Error('Choose claim, update or release.');
  if (action !== 'claim' && (!current || current.branch !== branch || identity !== current.executor)) throw new Error('The snapshot must contain the current claim for this branch and executor.');
  if (action === 'claim' && current) throw new Error('The snapshot already contains an active claim.');
  if (['claim', 'release'].includes(action) && (!scope?.trim() || /[\r\n]/.test(scope))) throw new Error('Provide a one-line delivery scope or task handoff.');
  const fields = action === 'claim' ? { 执行者: display || identity, 执行者代号: identity, 任务分支: branch, 交付范围: scope }
    : { 认领编号: current.id, 执行者代号: identity, ...(action === 'release' ? { 交接说明: scope } : {}) };
  if (action === 'claim' || addFiles !== undefined || removeFiles !== undefined || sessions !== undefined) {
    const old = action === 'claim' ? [] : current.resources;
    const removed = new Set(split(removeFiles).map(file => 'file:' + file));
    const files = [...new Set([...old.filter(resource => resource.startsWith('file:') && !removed.has(resource)), ...split(addFiles).map(file => 'file:' + file)])];
    fields.独占文件 = files.map(file => file.slice(5)).join('、') || '无';
    fields.独占会话 = (sessions === undefined ? old.filter(resource => resource.startsWith('blender:')).map(resource => resource.slice(8)) : split(sessions)).join('、') || '无';
  }
  return `## ${({ claim: '任务认领', update: '认领更新', release: '任务交接' })[action]}\n\n`
    + Object.entries(fields).map(([name, value]) => `- **${name}**：${value}`).join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      snapshot: { type: 'string' }, executor: { type: 'string' }, display: { type: 'string' }, scope: { type: 'string' },
      'add-files': { type: 'string' }, 'remove-files': { type: 'string' }, sessions: { type: 'string' },
    } });
    // Connected tools provide the current comment snapshot. This helper never posts,
    // stores credentials, or maintains a local task database.
    const snapshot = values.snapshot ? JSON.parse(readFileSync(values.snapshot, 'utf8')) : {};
    const comments = snapshot.comments || snapshot.structuredContent?.comments || [];
    const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
    console.log(workflowComment({ action: positionals[0], branch, comments, executor: values.executor, display: values.display,
      scope: values.scope, addFiles: values['add-files'], removeFiles: values['remove-files'], sessions: values.sessions }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
