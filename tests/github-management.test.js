import test from 'node:test';
import assert from 'node:assert/strict';
import { issueMetadata, desiredStatus, apiClient, runManagement, STATUS, acceptanceFingerprint, managementProblems, approvalSurvivesReopening } from '../scripts/github-management.mjs';
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
  assert.equal(desiredStatus({ ...issue, state: 'closed', labels: ['visual-approved'] }), '待验收');
  const accepted = { ...issue, state: 'closed', labels: ['visual-approved'] };
  accepted.body += `\n\n## 验收记录\n**交付版本**：${'a'.repeat(40)}\n**验收版本**：${'a'.repeat(40)}\n**验收范围摘要**：${acceptanceFingerprint(accepted)}\n**验收证据**：https://github.com/owner/repo/issues/1\n**确认来源**：https://github.com/owner/repo/issues/1#issuecomment-123`;
  assert.equal(desiredStatus(accepted), '完成');
  assert.equal(desiredStatus({ ...accepted, title: '[ART-04] Changed scope' }), '待验收');
  assert.equal(desiredStatus({ ...accepted, body: accepted.body.replace('**交付版本**：' + 'a'.repeat(40), '**交付版本**：' + 'b'.repeat(40)) }), '待验收');
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
      { id: 1, node_id: 'I1', number: 1, title: '[R0] 基线阶段验收', body: '**阶段**：R0\n**前置**：无', labels: [], state: 'open' },
      { id: 2, node_id: 'I2', number: 2, title: '[BASE-02] 基线', body: '**阶段**：R0\n**系统与优先级**：S13 / P1\n**前置**：无', labels: [], state: 'open' },
      { id: 3, node_id: 'I3', number: 3, title: '[R1] 画风阶段验收', body: '**阶段**：R1\n**前置**：R0 出口', labels: [], state: 'open' },
    ];
    const labels = [], milestones = [], children = new Map(), items = new Map();
    const views = [];
    let options = ['Todo', 'In Progress', 'Done'].map((name, i) => ({ id: `O${i}`, name }));
    const blockers = new Map();
    let linked = false, linkWrites = 0, optionWrites = 0, childWrites = 0, blockerWrites = 0;
    let freshLabels = [], discardStatusWrites = false;
    const response = data => ({ ok: true, status: 200, json: async () => structuredClone(data) });
    const graphResponse = data => response({ data });
    const mock = async (url, request) => {
      const endpoint = new URL(url).pathname.slice(1), body = request.body ? JSON.parse(request.body) : null;
      if (endpoint === 'graphql') {
        const { query, variables: v } = body;
        if (query.includes('views(first:100')) return graphResponse({ node: { views: { nodes: views, pageInfo: { hasNextPage: false } } } });
        if (query.includes('createProjectV2View')) { const view = { id: `V${views.length}`, name: v.name, filter: '' }; views.push(view); return graphResponse({ createProjectV2View: { projectV2View: view } }); }
        if (query.includes('updateProjectV2View')) { const view = views.find(x => x.id === v.id); view.filter = v.filter; return graphResponse({ updateProjectV2View: { projectV2View: view } }); }
        if (query.includes('projectsV2(first:100')) return graphResponse({ user: { id: 'OWNER', projectsV2: { nodes: [{ id: 'P', number: 7, title: 'Riverlight 开发' }], pageInfo: { hasNextPage: false } } } });
        if (query.includes('repositories(first:100')) return graphResponse({ node: { repositories: { nodes: linked ? [{ id: 'REPO' }] : [], pageInfo: { hasNextPage: false } } } });
        if (query.includes('linkProjectV2ToRepository')) { linked = true; linkWrites++; return graphResponse({ linkProjectV2ToRepository: { repository: { id: 'REPO' } } }); }
        if (query.includes('fields(first:30')) return graphResponse({ node: { id: 'P', url: 'https://github.com/users/owner/projects/7', items: { totalCount: items.size }, fields: { nodes: [{ id: 'STATUS', name: 'Status', options }] } } });
        if (query.includes('updateProjectV2Field')) { optionWrites++; options = v.options.map((option, i) => ({ id: `O${i}`, name: option.name })); return graphResponse({ updateProjectV2Field: { projectV2Field: { id: 'STATUS', name: 'Status', options } } }); }
        if (query.includes('items(first:100')) return graphResponse({ node: { items: { nodes: [...items.values()], pageInfo: { hasNextPage: false } } } });
        if (query.includes('addProjectV2ItemById')) { const item = { id: `ITEM${v.content}`, content: { id: v.content } }; items.set(v.content, item); return graphResponse({ addProjectV2ItemById: { item } }); }
        if (query.includes('updateProjectV2ItemFieldValue')) { const item = [...items.values()].find(i => i.id === v.item); if (!discardStatusWrites) item.fieldValueByName = { name: options.find(o => o.id === v.option).name }; return graphResponse({ updateProjectV2ItemFieldValue: { projectV2Item: { id: item.id } } }); }
        throw new Error('Unexpected GraphQL contract');
      }
      if (endpoint === 'repos/owner/repo') return response({ node_id: 'REPO' });
      if (endpoint === 'repos/owner/repo/labels') { if (request.method === 'POST') labels.push(body); return response(labels); }
      if (endpoint === 'repos/owner/repo/milestones') { if (request.method === 'POST') { const milestone = { ...body, number: milestones.length + 1 }; milestones.push(milestone); return response(milestone); } return response(milestones); }
      if (endpoint === 'repos/owner/repo/issues') return response(issues);
      if (/\/issues\/\d+\/dependencies\/blocked_by$/.test(endpoint)) {
        const number = Number(endpoint.match(/\/issues\/(\d+)/)[1]);
        if (!blockers.has(number)) blockers.set(number, []);
        if (request.method === 'POST') { blockerWrites++; blockers.get(number).push(issues.find(i => i.id === body.issue_id)); }
        return response(blockers.get(number));
      }
      const deletion = endpoint.match(/\/issues\/(\d+)\/dependencies\/blocked_by\/(\d+)$/);
      if (deletion && request.method === 'DELETE') {
        const number = Number(deletion[1]);
        blockers.set(number, blockers.get(number).filter(i => i.id !== Number(deletion[2])));
        return response(issues.find(i => i.id === Number(deletion[2])));
      }
      const labelDeletion = endpoint.match(/\/issues\/(\d+)\/labels\/(.+)$/);
      if (labelDeletion && request.method === 'DELETE') {
        const issue = issues.find(i => i.number === Number(labelDeletion[1]));
        issue.labels = issue.labels.filter(l => l.name !== decodeURIComponent(labelDeletion[2]));
        return response(issue.labels);
      }
      if (endpoint.endsWith('/sub_issues')) {
        const parent = Number(endpoint.match(/\/issues\/(\d+)/)[1]);
        if (!children.has(parent)) children.set(parent, []);
        if (request.method === 'POST') {
          childWrites++;
          for (const [number, entries] of children) children.set(number, entries.filter(i => i.id !== body.sub_issue_id));
          children.get(parent).push(issues.find(i => i.id === body.sub_issue_id));
        }
        return response(children.get(parent));
      }
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
    assert.equal(blockerWrites, 1);
    assert.equal(blockers.get(3)[0].number, 1);
    assert.equal(items.get('I2').fieldValueByName.name, '待办');
    assert.equal(views.length, 4);
    assert.equal(issues[1].labels.some(l => l.name === 'management:ready'), true);
    freshLabels = [{ name: 'status:review' }];
    await runManagement({ ...env, MANAGEMENT_BOOTSTRAP: 'false' }, mock);
    assert.equal(milestones.length, 9);
    assert.equal(linkWrites, 1);
    assert.equal(optionWrites, 1);
    assert.equal(childWrites, 1);
    assert.equal(blockerWrites, 1);
    assert.equal(items.get('I2').fieldValueByName.name, '待验收');
    // An event about #2 must also reconcile another changed task (#1).
    issues[0].labels.push({ name: 'status:blocked' });
    await runManagement({ ...env, MANAGEMENT_BOOTSTRAP: 'false' }, mock);
    assert.equal(items.get('I1').fieldValueByName.name, '阻塞');
    issues[0].labels = issues[0].labels.filter(l => l.name !== 'status:blocked');
    const external = { id: 99, number: 99 };
    blockers.set(2, [issues[0], external]);
    issues[1].body = '**阶段**：R1\n**系统与优先级**：S13 / P1\n**前置**：无';
    await runManagement({ ...env, MANAGEMENT_BOOTSTRAP: 'false' }, mock);
    assert.equal(issues[1].milestone.title.startsWith('R1 '), true);
    assert.deepEqual(children.get(1), []);
    assert.equal(children.get(3)[0].id, 2);
    assert.deepEqual(blockers.get(2), [external]);
    issues[1].body = issues[1].body.replace('P1', 'P2');
    await runManagement({ ...env, MANAGEMENT_BOOTSTRAP: 'false' }, mock);
    assert.equal(issues[1].labels.some(l => l.name === 'priority:P1'), false);
    assert.equal(issues[1].labels.some(l => l.name === 'priority:P2'), true);
    freshLabels = [{ name: 'status:blocked' }];
    discardStatusWrites = true;
    await assert.rejects(runManagement({ ...env, MANAGEMENT_BOOTSTRAP: 'false' }, mock), /could not be verified/);
  } finally {
    if (!temporary.startsWith(path.join(tmpdir(), 'riverlight-management-test-'))) throw new Error('Unsafe test cleanup target.');
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('real form headings map to metadata and unresolvable/cyclic dependencies require triage', () => {
  const a = { number: 1, title: 'Form task', body: '### 任务编号\n\nEDIT-01\n\n### 阶段\n\nR2\n\n### 优先级\n\nP1\n\n### 前置\n\nEDIT-02\n\n### 视觉验收\n\n需要用户确认', labels: [] };
  assert.deepEqual(issueMetadata(a), { task: 'EDIT-01', phase: 'R2', priority: 'P1', dependencies: ['EDIT-02'], visual: true });
  assert.match(managementProblems([a]).get(1).join(), /未知依赖/);
  const b = { ...a, number: 2, title: '[EDIT-02] second', body: '**阶段**：R2\n**优先级**：P1\n**前置**：EDIT-01' };
  const problems = managementProblems([a, b]);
  assert.match(problems.get(1).join(), /依赖循环/);
  assert.match(problems.get(2).join(), /依赖循环/);
  assert.equal(desiredStatus({ ...a, state: 'closed' }, [a, b], problems), '阻塞');
  assert.equal(managementProblems([{ number: 3, title: 'Untriaged', body: '', labels: [] }]).has(3), true);
});

test('phase completion requires accepted children and a checked exit checklist', () => {
  const parent = { number: 1, title: '[R0] stage', body: '**阶段**：R0\n**前置**：无\n## 阶段出口\n- [x] exit', state: 'closed', labels: [] };
  const child = { number: 2, title: '[BASE-02] task', body: '**阶段**：R0\n**优先级**：P1\n**前置**：无', state: 'open', labels: [] };
  assert.equal(desiredStatus(parent, [parent, child]), '待验收');
  assert.equal(desiredStatus(parent, [parent, { ...child, state: 'closed' }]), '完成');
  assert.equal(desiredStatus({ ...parent, body: parent.body.replace('[x]', '[ ]') }, [parent, { ...child, state: 'closed' }]), '待验收');
});

test('transient GET failures retry with a cap, while mutations are never blindly replayed', async () => {
  let calls = 0;
  const delays = [];
  const api = apiClient('test', async () => (++calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ recovered: true }) }), async ms => delays.push(ms));
  assert.deepEqual(await api('repos/owner/repo'), { recovered: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
  calls = 0;
  await assert.rejects(api('repos/owner/repo/issues', 'POST', {}), /503/);
  assert.equal(calls, 1);
});

test('full audit invalidates pre-reopen approval but preserves a newer confirmation despite an old queued event', async () => {
  const issue = { number: 1, title: '[ART-01] scope', body: '**视觉验收**：需要用户确认' };
  issue.body += `\n\n## 验收记录\n**交付版本**：${'a'.repeat(40)}\n**验收版本**：${'a'.repeat(40)}\n**验收范围摘要**：${acceptanceFingerprint(issue)}\n**验收证据**：https://github.com/owner/repo/issues/1\n**确认来源**：https://github.com/owner/repo/issues/1#issuecomment-123`;
  let confirmedAt = '2026-10-12T10:00:00Z';
  const api = { all: async endpoint => endpoint.endsWith('/comments')
    ? [{ id: 123, created_at: confirmedAt }] : [{ event: 'reopened', created_at: '2026-10-12T11:00:00Z' }] };
  assert.equal(await approvalSurvivesReopening(api, 'owner/repo', issue), false);
  confirmedAt = '2026-10-12T12:00:00Z';
  assert.equal(await approvalSurvivesReopening(api, 'owner/repo', issue), true);
});
