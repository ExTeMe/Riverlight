import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, readReceipts, receiptBody, decideCommand, reconcileClaims, resourcesOverlap, codeReviewState, maintainerReview } from '../scripts/github-collaboration.mjs';
import { approvalSurvivesReopening, acceptanceFingerprint, desiredStatus, syncCoordinationFields, COORD_FIELDS } from '../scripts/github-management.mjs';

const issue = { number: 71, state: 'open', assignees: [] };
const request = { action: 'claim', id: 1, actor: 'owner', at: '2026-10-14T01:00:00Z', executor: 'agent-a', branch: 'codex/71-test', scope: '修复认领', resources: ['file:assets/blender/library.blend', 'blender:shared-session'] };
const decide = (command = request, states = new Map(), extra = {}) => decideCommand({ command, issue, states, permission: 'write', ready: true, ...extra });

test('first claim wins across Issue, shared files, directories, and Blender sessions', () => {
  const result = decide(); assert.equal(result.accepted, true);
  const states = new Map([[71, { claim: result.claim }]]);
  assert.equal(decide({ ...request, id: 2, executor: 'agent-b' }, states).accepted, false);
  assert.equal(decide({ ...request, id: 3, branch: 'codex/72-other' }, states, { issue: { ...issue, number: 72 } }).accepted, false);
  assert.equal(resourcesOverlap('file:src', 'file:src/core.js'), true);
  assert.equal(resourcesOverlap('file:src/core.js', 'file:src/core-other.js'), false);
  assert.equal(decide({ ...request, branch: 'dev' }).accepted, false);
  assert.equal(decide({ ...request, resources: ['file:../private'] }).accepted, false);
  assert.equal(decide(request, new Map(), { permission: 'read' }).accepted, false);
  assert.equal(decide(request, new Map(), { ready: false }).accepted, false);
  assert.equal(decide({ ...request, override: '维护基础设施，不等待产品出口' }, new Map(), { ready: false, permission: 'admin' }).accepted, true);
  assert.equal(decide({ ...request, override: '提前开发' }, new Map(), { ready: false, metadataValid: false, permission: 'admin' }).accepted, false);
});

test('shared accounts retain execution identity; stale release cannot free a successor', () => {
  const claim = decide().claim, states = new Map([[71, { claim }]]);
  const release = { action: 'release', actor: 'owner', executor: 'agent-a', claim: 1, reason: '实现已提交，后续补验收' };
  assert.equal(decide(release, states).accepted, true);
  assert.equal(decide({ ...release, executor: 'agent-b' }, states).accepted, false);
  assert.equal(decide({ ...release, claim: 99 }, states).accepted, false);
  assert.equal(decide({ ...release, actor: 'maintainer', reason: '接手停滞任务' }, states, { permission: 'maintain' }).accepted, true);
  assert.equal(decide({ ...release, action: 'touch', at: 'later' }, states).claim.updated, 'later');
});

test('claims recover from a lost POST response without granting a second owner or writing a duplicate receipt', async () => {
  const comments = [{ id: 1, user: { login: 'owner', type: 'User' }, created_at: request.at, body: `/riverlight claim ${JSON.stringify(request)}` }];
  let loseResponse = true, writes = 0;
  const api = Object.assign(async (endpoint, method, body) => {
    if (endpoint.endsWith('/permission')) return { permission: 'write' };
    if (method === 'POST') {
      writes++; comments.push({ id: 100, user: { login: 'github-actions[bot]', type: 'Bot' }, body: body.body });
      if (loseResponse) { loseResponse = false; throw new Error('Response lost'); }
    }
  }, { all: async () => comments });
  await assert.rejects(reconcileClaims(api, 'owner/repo', [issue], () => true), /Response lost/);
  const state = await reconcileClaims(api, 'owner/repo', [issue], () => true);
  assert.equal(state.get(71).claim.executor, 'agent-a'); assert.equal(writes, 1);
  assert.equal(readReceipts([{ id: 3, user: { login: 'owner', type: 'User' }, body: receiptBody(request, decide()) }]).length, 0);
  assert.equal(parseCommand({ id: 2, created_at: 'now', user: { login: 'owner' }, body: '/riverlight claim {"actor":"impostor","id":99,"action":"release"}' }).action, 'claim');
});

test('approval is bound to authorized identity, explicit decision, SHA and requirement scope', async () => {
  const target = { number: 1, title: '[ART-01] sample', body: '**视觉验收**：需要用户确认' };
  const fingerprint = acceptanceFingerprint(target), sha = 'a'.repeat(40);
  target.body += `\n\n## 验收记录\n**交付版本**：${sha}\n**验收版本**：${sha}\n**验收范围摘要**：${fingerprint}\n**验收证据**：https://github.com/owner/repo/issues/1\n**确认来源**：https://github.com/owner/repo/issues/1#issuecomment-123`;
  const comment = { id: 123, user: { login: 'owner', type: 'User' }, created_at: '2026-10-14T01:00:00Z', body: `/riverlight approve-visual ${JSON.stringify({ sha, fingerprint })}` };
  const api = { all: async endpoint => endpoint.endsWith('/comments') ? [comment] : [] };
  assert.equal(await approvalSurvivesReopening(api, 'owner/repo', target), true);
  comment.user.login = 'other'; assert.equal(await approvalSurvivesReopening(api, 'owner/repo', target), false);
  comment.user.login = 'owner'; comment.body = '看起来不错'; assert.equal(await approvalSurvivesReopening(api, 'owner/repo', target), false);
  assert.equal(desiredStatus({ title: '[BASE-01] new', body: '**协作流程**：v2', labels: [], state: 'closed' }), '待验收');
});

test('code review distinguishes stale approvals, shared-account self approval, requested changes and integration', () => {
  const pr = { state: 'open', draft: false, user: { login: 'owner' }, head: { sha: 'a' } };
  assert.equal(codeReviewState(pr, [{ user: { login: 'owner' }, state: 'APPROVED', commit_id: 'a' }]), '待代码审查');
  assert.equal(codeReviewState(pr, [{ user: { login: 'peer' }, state: 'APPROVED', commit_id: 'old' }]), '待代码审查');
  assert.equal(codeReviewState(pr, [{ user: { login: 'peer' }, author_association: 'COLLABORATOR', state: 'APPROVED', commit_id: 'a' }]), '已审查');
  assert.equal(codeReviewState(pr, [{ user: { login: 'outside' }, author_association: 'NONE', state: 'APPROVED', commit_id: 'a' }]), '待代码审查');
  assert.equal(codeReviewState(pr, [{ user: { login: 'peer' }, state: 'CHANGES_REQUESTED' }]), '需修改');
  assert.equal(codeReviewState({ ...pr, merged_at: 'now' }, []), '已集成');
});

test('shared-account automated review is explicit, authorized, and cannot follow another head', () => {
  const pr = { head: { sha: 'a' } }, comment = { user: { login: 'owner', type: 'User' }, body: '/riverlight review {"sha":"a","mode":"automated","summary":"检查了认领状态、响应丢失恢复和投影一致性"}' };
  assert.equal(maintainerReview(pr, [comment], ['owner']), true);
  assert.equal(maintainerReview({ head: { sha: 'b' } }, [comment], ['owner']), false);
  assert.equal(maintainerReview(pr, [comment], ['peer']), false);
});

test('Project fields are verified and released claims clear stale executor and branch without deleting fields', async () => {
  const project = { id: 'P', fields: { nodes: [] } }, item = { id: 'I', content: { id: 'N' }, fieldValues: { nodes: [] } };
  let discard = false;
  const api = { graphql: async (query, v) => {
    if (query.includes('createProjectV2Field')) return { createProjectV2Field: { projectV2Field: { id: v.name, name: v.name } } };
    if (query.includes('items(first:100')) return { node: { items: { nodes: [structuredClone(item)], pageInfo: { hasNextPage: false } } } };
    if (!discard) {
      item.fieldValues.nodes = item.fieldValues.nodes.filter(f => f.field.id !== v.field);
      if (query.includes('updateProjectV2ItemFieldValue')) item.fieldValues.nodes.push({ text: v.text, field: { id: v.field, name: v.field } });
    }
    return {};
  } };
  const target = { ...issue, node_id: 'N', title: '[MGMT-03] coordination', body: '', labels: [] };
  await syncCoordinationFields(api, project, [target], new Map([[71, { claim: decide().claim }]]));
  assert.equal(project.fields.nodes.length, COORD_FIELDS.length);
  assert.equal(item.fieldValues.nodes.find(v => v.field.name === '执行者').text, 'agent-a');
  await syncCoordinationFields(api, project, [target], new Map());
  assert.equal(item.fieldValues.nodes.some(v => v.field.name === '执行者'), false);
  discard = true;
  await assert.rejects(syncCoordinationFields(api, project, [target], new Map([[71, { claim: decide().claim }]])), /could not be verified/);
});
