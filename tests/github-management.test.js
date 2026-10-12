import test from 'node:test';
import assert from 'node:assert/strict';
import { issueMetadata, desiredStatus, apiClient, runManagement, STATUS } from '../scripts/github-management.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('task metadata retains phase, requirements dependencies, and visual review scope', () => {
  const issue = { title: '[LOOK-03] 城市构图', body: '**阶段**：R6\n**系统与优先级**：S10 / P1\n**前置**：ASSET-04、ROAD-05、R5 出口\n**视觉验收**：需要用户确认' };
  assert.deepEqual(issueMetadata(issue), { task: 'LOOK-03', phase: 'R6', priority: 'P1', dependencies: ['ASSET-04', 'ROAD-05', 'R5'], visual: true });
});

test('project transitions distinguish implementation, review, blockers, reopening, and accepted completion', () => {
  const issue = { number: 1, title: '[ART-04] 视觉验收', body: '**视觉验收**：需要用户确认', state: 'open', labels: [] };
  assert.equal(desiredStatus(issue), '待办');
  assert.equal(desiredStatus({ ...issue, labels: [{ name: 'status:in-progress' }] }), '进行中');
  assert.equal(desiredStatus({ ...issue, labels: ['status:review'] }), '待验收');
  assert.equal(desiredStatus({ ...issue, labels: ['status:blocked'] }), '阻塞');
  assert.equal(desiredStatus({ ...issue, state: 'closed' }), '待验收');
  assert.equal(desiredStatus({ ...issue, state: 'closed', labels: ['visual-approved'] }), '完成');
  assert.equal(desiredStatus({ ...issue, state: 'open', labels: ['visual-approved'] }), '待办');
  assert.equal(desiredStatus({ ...issue, state: 'closed', body: '' }), '完成');
  assert.throws(() => desiredStatus({ ...issue, labels: ['status:blocked', 'status:review'] }), /conflicting/);
});

test('API pagination visits all pages and failure output excludes credentials and response body', async () => {
  const endpoints = [];
  const api = apiClient('test-credential', async (url, options) => {
    endpoints.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-credential');
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: true, status: 200, json: async () => page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }] };
  });
  assert.equal((await api.all('repos/owner/repo/issues?state=all')).length, 101);
  assert.equal(endpoints.length, 2);
  const failing = apiClient('test-credential', async () => ({ ok: false, status: 403, json: async () => ({ token: 'test-credential' }) }));
  await assert.rejects(failing('graphql', 'POST', {}), error => error.message.includes('403') && !error.message.includes('test-credential'));
});

test('bootstrap links repository and project; later issue events use fresh state without duplicating setup', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'riverlight-management-test-'));
  try {
    const eventPath = path.join(temporary, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ issue: { number: 2, labels: [] } }));
    const issues = [
      { id: 1, node_id: 'I1', number: 1, title: '[R0] 基线阶段验收', body: '**阶段**：R0', labels: [], state: 'open' },
      { id: 2, node_id: 'I2', number: 2, title: '[BASE-02] 基线', body: '**阶段**：R0\n**系统与优先级**：S13 / P1\n**前置**：BASE-01', labels: [], state: 'open' },
    ];
    const labels = [], milestones = [], children = [], items = new Map();
    let options = ['Todo', 'In Progress', 'Done'].map((name, i) => ({ id: `O${i}`, name }));
    let linked = false, linkWrites = 0, optionWrites = 0, childWrites = 0;
    let freshLabels = [];
    const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
    const graphResponse = data => response({ data });
    const mock = async (url, request) => {
      const endpoint = new URL(url).pathname.slice(1), body = request.body ? JSON.parse(request.body) : null;
      if (endpoint === 'graphql') {
        const { query, variables: v } = body;
        if (query.includes('projectsV2(first:100')) return graphResponse({ user: { id: 'OWNER', projectsV2: { nodes: [{ id: 'P', number: 7, title: 'Riverlight 开发' }], pageInfo: { hasNextPage: false } } } });
        if (query.includes('repositories(first:100')) return graphResponse({ node: { repositories: { nodes: linked ? [{ id: 'REPO' }] : [], pageInfo: { hasNextPage: false } } } });
        if (query.includes('linkProjectV2ToRepository')) { linked = true; linkWrites++; return graphResponse({ linkProjectV2ToRepository: { repository: { id: 'REPO' } } }); }
        if (query.includes('fields(first:30')) return graphResponse({ node: { id: 'P', url: 'https://github.com/users/owner/projects/7', items: { totalCount: items.size }, fields: { nodes: [{ id: 'STATUS', name: 'Status', options }] } } });
        if (query.includes('updateProjectV2Field')) { optionWrites++; options = v.options.map((option, i) => ({ id: `O${i}`, name: option.name })); return graphResponse({ updateProjectV2Field: { projectV2Field: { id: 'STATUS', name: 'Status', options } } }); }
        if (query.includes('items(first:100')) return graphResponse({ node: { items: { nodes: [...items.values()], pageInfo: { hasNextPage: false } } } });
        if (query.includes('addProjectV2ItemById')) { const item = { id: `ITEM${v.content}`, content: { id: v.content } }; items.set(v.content, item); return graphResponse({ addProjectV2ItemById: { item } }); }
        if (query.includes('updateProjectV2ItemFieldValue')) { const item = [...items.values()].find(i => i.id === v.item); item.fieldValueByName = { name: options.find(o => o.id === v.option).name }; return graphResponse({ updateProjectV2ItemFieldValue: { projectV2Item: { id: item.id } } }); }
        throw new Error('Unexpected GraphQL contract');
      }
      if (endpoint === 'repos/owner/repo') return response({ node_id: 'REPO' });
      if (endpoint === 'repos/owner/repo/labels') { if (request.method === 'POST') labels.push(body); return response(labels); }
      if (endpoint === 'repos/owner/repo/milestones') { if (request.method === 'POST') { const milestone = { ...body, number: milestones.length + 1 }; milestones.push(milestone); return response(milestone); } return response(milestones); }
      if (endpoint === 'repos/owner/repo/issues') return response(issues);
      if (/\/issues\/\d+\/dependencies\/blocked_by$/.test(endpoint)) return response([]);
      if (endpoint.endsWith('/sub_issues')) { if (request.method === 'POST') { childWrites++; children.push(issues.find(i => i.id === body.sub_issue_id)); } return response(children); }
      const match = endpoint.match(/\/issues\/(\d+)(\/labels)?$/);
      if (match) {
        const issue = issues.find(i => i.number === Number(match[1]));
        if (match[2]) { issue.labels.push(...body.labels.map(name => ({ name }))); return response(issue.labels); }
        if (request.method === 'PATCH') { issue.milestone = milestones.find(m => m.number === body.milestone); return response(issue); }
        return response({ ...issue, labels: [...issue.labels, ...freshLabels] });
      }
      throw new Error(`Unexpected REST contract: ${endpoint}`);
    };
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'repository-test', PROJECT_TOKEN: 'project-test', MANAGEMENT_BOOTSTRAP: 'true', GITHUB_EVENT_PATH: eventPath };
    await runManagement(env, mock);
    assert.equal(milestones.length, 9);
    assert.equal(linkWrites, 1);
    assert.equal(optionWrites, 1);
    assert.deepEqual(options.map(o => o.name), STATUS);
    assert.equal(childWrites, 1);
    assert.equal(items.get('I2').fieldValueByName.name, '待办');
    freshLabels = [{ name: 'status:review' }];
    await runManagement({ ...env, MANAGEMENT_BOOTSTRAP: 'false' }, mock);
    assert.equal(milestones.length, 9);
    assert.equal(linkWrites, 1);
    assert.equal(optionWrites, 1);
    assert.equal(childWrites, 1);
    assert.equal(items.get('I2').fieldValueByName.name, '待验收');
  } finally {
    if (!temporary.startsWith(path.join(tmpdir(), 'riverlight-management-test-'))) throw new Error('Unsafe test cleanup target.');
    rmSync(temporary, { recursive: true, force: true });
  }
});
