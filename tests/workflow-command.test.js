import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowComment } from '../scripts/workflow-command.mjs';
import { parseCommand, receiptBody } from '../scripts/github-collaboration.mjs';

test('generated updates inherit claim identity, preserve resources and bind releases to the original claim', () => {
  const claim = { id: 12, executor: 'agent-a', owner: 'owner', branch: 'task-a', scope: 'scope', resources: ['file:src/a.js', 'file:src/b.js', 'blender:shared-session'] };
  const comments = [{ id: 13, user: { login: 'github-actions[bot]', type: 'Bot' }, body: receiptBody({ id: 12 }, { accepted: true, claim }) }];
  const update = workflowComment({ action: 'update', branch: 'task-a', comments, addFiles: 'src/c.js', removeFiles: 'src/a.js' });
  const parsed = parseCommand({ id: 14, user: { login: 'owner' }, body: update });
  assert.equal(parsed.claim, 12); assert.equal(parsed.executor, 'agent-a');
  assert.deepEqual(parsed.resources, ['file:src/b.js', 'file:src/c.js', 'blender:shared-session']);
  assert.match(workflowComment({ action: 'release', branch: 'task-a', comments, scope: 'next step' }), /认领编号\*\*：12/);
  assert.throws(() => workflowComment({ action: 'release', branch: 'other-task', comments, scope: 'next step' }), /current claim/);
  assert.throws(() => workflowComment({ action: 'release', branch: 'task-a', comments, executor: 'agent-b', scope: 'next step' }), /current claim/);
  assert.throws(() => workflowComment({ action: 'claim', branch: 'dev', scope: 'scope' }), /task branch/);
});
