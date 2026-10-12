import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const STATUS = ['待办', '进行中', '待验收', '完成', '阻塞'];

export function issueField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(`\\*\\*${escaped}\\*\\*[：:]\\s*([^\\n]*)`))?.[1]?.trim()
    ?? body.match(new RegExp(`^### ${escaped}\\s*\\r?\\n+([^\\n]+)`, 'm'))?.[1]?.trim();
}

export function issueMetadata(issue) {
  const body = issue.body || '';
  return {
    task: issue.title.match(/^\[([A-Z]+-\d+)\]/)?.[1] || issueField(body, '任务编号')?.match(/^[A-Z]+-\d+$/)?.[0],
    phase: issueField(body, '阶段')?.match(/^R\d+\b/)?.[0],
    priority: (issueField(body, '优先级') || issueField(body, '系统与优先级'))?.match(/P[0-3]\b/)?.[0],
    dependencies: [...(issueField(body, '前置') || '').matchAll(/([A-Z]+-\d+|R\d+)\b/g)].map(m => m[1]),
    visual: issueField(body, '视觉验收') === '需要用户确认',
  };
}

export function acceptanceFingerprint(issue) {
  // Acceptance records and progress notes are outside the reviewed requirement scope.
  const scope = (issue.body || '').split(/^## (?:验收记录|执行记录|交接记录)\s*$/m)[0].trim().replace(/\r\n/g, '\n');
  return createHash('sha256').update(`${issue.title}\n${scope}`).digest('hex');
}

export function visualApprovalValid(issue) {
  const body = issue.body || '';
  const delivered = issueField(body, '交付版本');
  return /^[a-f0-9]{40}$/.test(delivered || '')
    && issueField(body, '验收版本') === delivered
    && issueField(body, '验收范围摘要') === acceptanceFingerprint(issue)
    && /^https:\/\/github\.com\//.test(issueField(body, '验收证据') || '')
    && /^https:\/\/github\.com\/.+#issuecomment-\d+$/.test(issueField(body, '确认来源') || '');
}

export async function approvalSurvivesReopening(api, repository, issue) {
  if (!visualApprovalValid(issue)) return false;
  const source = issueField(issue.body || '', '确认来源');
  const prefix = `https://github.com/${repository}/issues/${issue.number}#issuecomment-`;
  if (!source.startsWith(prefix)) return false;
  const commentId = Number(source.slice(prefix.length));
  const comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
  const confirmation = comments.find(comment => comment.id === commentId);
  if (!confirmation?.created_at) return false;
  const events = await api.all(`repos/${repository}/issues/${issue.number}/timeline`);
  return !events.some(event => event.event === 'reopened' && event.created_at >= confirmation.created_at);
}

export function managementProblems(issues) {
  const indexed = new Map(), problems = new Map();
  const add = (issue, message) => problems.set(issue.number, [...(problems.get(issue.number) || []), message]);
  for (const issue of issues) {
    const meta = issueMetadata(issue), id = meta.task || issue.title.match(/^\[(R\d+)\]/)?.[1];
    if (!id) { add(issue, '缺任务编号'); continue; }
    if (indexed.has(id)) throw new Error(`Duplicate task identifier: ${id}`);
    indexed.set(id, issue);
    if (!/^R[0-8]$/.test(meta.phase || '')) add(issue, '缺有效阶段');
    if (meta.task && !meta.priority) add(issue, '缺优先级');
    const dependencies = issueField(issue.body || '', '前置');
    if (!dependencies || /待分诊|_No response_/.test(dependencies)
      || (dependencies !== '无' && !meta.dependencies.length)) add(issue, '缺明确前置（无依赖填写无）');
    const selected = (issue.labels || []).filter(l => /^status:(blocked|review|in-progress)$/.test(typeof l === 'string' ? l : l.name));
    if (selected.length > 1) add(issue, '状态标签冲突');
  }
  for (const issue of issues) for (const id of issueMetadata(issue).dependencies) {
    if (!indexed.has(id)) add(issue, `未知依赖 ${id}`);
  }
  const visiting = new Set(), visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) {
      for (const node of trail.slice(trail.indexOf(id))) add(indexed.get(node), '依赖循环');
      return;
    }
    if (visited.has(id) || !indexed.has(id)) return;
    visiting.add(id);
    for (const dep of issueMetadata(indexed.get(id)).dependencies) visit(dep, [...trail, id]);
    visiting.delete(id); visited.add(id);
  };
  for (const id of indexed.keys()) visit(id);
  return problems;
}

export function desiredStatus(issue, issues = [], problems = new Map(), stack = new Set()) {
  const names = new Set((issue.labels || []).map(label => typeof label === 'string' ? label : label.name));
  if (problems.has(issue.number)) return '阻塞';
  if (issue.state === 'closed') {
    if (issueMetadata(issue).visual && (!names.has('visual-approved') || !visualApprovalValid(issue))) return '待验收';
    const stage = issue.title.match(/^\[(R\d+)\]/)?.[1];
    if (stage) {
      if (stack.has(issue.number)) return '待验收';
      const next = new Set([...stack, issue.number]);
      const children = issues.filter(i => issueMetadata(i).task && issueMetadata(i).phase === stage);
      if (!children.length || !/- \[x\]/i.test(issue.body || '') || /- \[ \]/.test(issue.body || '')
        || children.some(i => desiredStatus(i, issues, problems, next) !== '完成')) return '待验收';
    }
    return '完成';
  }
  const selected = ['status:blocked', 'status:review', 'status:in-progress'].filter(name => names.has(name));
  if (selected.length > 1) throw new Error(`Issue #${issue.number} has conflicting status labels.`);
  return ({ 'status:blocked': '阻塞', 'status:review': '待验收', 'status:in-progress': '进行中' })[selected[0]] || '待办';
}

export function apiClient(token, request = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!token) throw new Error('A GitHub access token is required.');
  const call = async (endpoint, method = 'GET', body) => {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await request(`https://api.github.com/${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
      });
      // Retry safe reads only; a timed-out mutation may already have succeeded.
      if (method !== 'GET' || ![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
      const delay = Math.min(5000, Math.max(1000, Number(response.headers?.get('retry-after') || 0) * 1000));
      await pause(delay * (attempt + 1));
    }
    // Never print request headers, tokens, or untrusted response bodies.
    if (!response.ok) throw new Error(`GitHub API ${method} ${endpoint.split('?')[0]} failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
  call.all = async endpoint => {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await call(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      result.push(...data); if (data.length < 100) return result;
    }
  };
  call.graphql = async (query, variables = {}) => {
    const result = await call('graphql', 'POST', { query, variables });
    if (result.errors?.length) throw new Error('GitHub GraphQL rejected the operation; check Projects authorization and configuration.');
    return result.data;
  };
  return call;
}

async function syncRepository(api, repository, issues, root, targets, bootstrap, problems) {
  const base = `repos/${repository}`;
  const plan = readFileSync(path.join(root, 'docs/DEVELOPMENT_PLAN.md'), 'utf8');
  const stages = plan.split(/\r?\n/).filter(line => /^\| R\d /.test(line)).map(line => {
    const parts = line.split('|').slice(1, -1).map(x => x.trim());
    return { id: parts[0].match(/^R\d+/)[0], title: parts[0], description: parts[2] };
  });
  const labels = await api.all(`${base}/labels`);
  for (const [name, color, description] of [
    ['status:in-progress', '0969da', '任务正在实现'], ['status:review', 'd4a72c', '实现结束，等待验收'],
    ['status:blocked', 'cf222e', '有明确阻塞原因'], ['visual-approved', '1a7f37', '已收到用户对当前版本的视觉验收确认'],
    ['management:triage', 'cf222e', '元数据或依赖需要分诊；不能视为可开始'],
    ['management:ready', '1a7f37', '前置已验收且元数据有效；执行前仍需核对复现场景'],
    ...[0, 1, 2, 3].map(p => [`priority:P${p}`, p === 0 ? 'cf222e' : '57606a', `优先级 P${p}`]),
  ]) {
    if (!labels.some(label => label.name === name)) await api(`${base}/labels`, 'POST', { name, color, description });
  }
  const milestones = await api.all(`${base}/milestones?state=all`);
  const stageParents = new Map(), tasks = new Map();
  for (const issue of issues) {
    const id = issueMetadata(issue).task || issue.title.match(/^\[(R\d+)\]/)?.[1];
    if (!id) continue;
    if (tasks.has(id) || stageParents.has(id)) throw new Error(`Duplicate task identifier: ${id}`);
    (id.startsWith('R') && /^R\d+$/.test(id) ? stageParents : tasks).set(id, issue);
  }
  for (const stage of stages) {
    if (bootstrap && !milestones.some(m => m.title === stage.title)) milestones.push(await api(`${base}/milestones`, 'POST', {
      title: stage.title, description: stage.description,
    }));
  }
  for (const issue of targets) {
    const metadata = issueMetadata(issue), milestone = milestones.find(m => m.title.startsWith(`${metadata.phase} `));
    const setLabel = async (name, present) => {
      const current = issue.labels.some(label => label.name === name);
      if (current === present) return;
      if (present) {
        await api(`${base}/issues/${issue.number}/labels`, 'POST', { labels: [name] });
        issue.labels.push({ name });
      } else {
        await api(`${base}/issues/${issue.number}/labels/${encodeURIComponent(name)}`, 'DELETE');
        issue.labels = issue.labels.filter(label => label.name !== name);
      }
    };
    // Reopening and changed requirements invalidate the old version's visual approval.
    if (metadata.visual && issue.labels.some(label => label.name === 'visual-approved')) {
      if (!await approvalSurvivesReopening(api, repository, issue)) await setLabel('visual-approved', false);
    }
    await setLabel('management:triage', problems.has(issue.number));
    const parentDependencies = issueMetadata(stageParents.get(metadata.phase) || { title: '', body: '' }).dependencies;
    const blockers = [...new Set([...metadata.dependencies, ...parentDependencies])].map(id => tasks.get(id) || stageParents.get(id));
    const ready = issue.state === 'open' && !!metadata.task && !problems.has(issue.number)
      && !problems.has(stageParents.get(metadata.phase)?.number)
      && blockers.every(blocker => blocker && desiredStatus(blocker, issues, problems) === '完成');
    await setLabel('management:ready', ready);
    if (milestone && issue.milestone?.number !== milestone.number) await api(`${base}/issues/${issue.number}`, 'PATCH', { milestone: milestone.number });
    if (metadata.priority) for (const priority of ['P0', 'P1', 'P2', 'P3']) await setLabel(`priority:${priority}`, priority === metadata.priority);
    const parent = stageParents.get(metadata.phase);
    if (metadata.task && parent) {
      const children = await api.all(`${base}/issues/${parent.number}/sub_issues`);
      if (!children.some(child => child.id === issue.id)) await api(`${base}/issues/${parent.number}/sub_issues`, 'POST', { sub_issue_id: issue.id, replace_parent: true });
    }
    if (!problems.has(issue.number) && (metadata.task || /^\[R\d+\]/.test(issue.title))) {
      const blockers = await api.all(`${base}/issues/${issue.number}/dependencies/blocked_by`);
      const expected = new Set(metadata.dependencies.map(id => (tasks.get(id) || stageParents.get(id))?.id).filter(Boolean));
      // Only reconcile dependencies within this task namespace when the field is explicit.
      // Preserve external/manual references that do not belong to the managed task set.
      if (issueField(issue.body || '', '前置') !== undefined) {
        const managedIds = new Set([...tasks.values(), ...stageParents.values()].map(i => i.id));
        for (const blocker of blockers) {
          if (managedIds.has(blocker.id) && !expected.has(blocker.id)) {
            await api(`${base}/issues/${issue.number}/dependencies/blocked_by/${blocker.id}`, 'DELETE');
          }
        }
      }
      for (const id of metadata.dependencies) {
        const blocker = tasks.get(id) || stageParents.get(id);
        if (blocker && blocker.id !== issue.id && !blockers.some(b => b.id === blocker.id)) {
          await api(`${base}/issues/${issue.number}/dependencies/blocked_by`, 'POST', { issue_id: blocker.id });
        }
      }
    }
  }
}

const FIELD_QUERY = 'fields(first:30){nodes{... on ProjectV2Field{id name} ... on ProjectV2SingleSelectField{id name options{id name}}}}';

export const PROJECT_VIEWS = [
  { name: '当前可开始', filter: 'is:open label:management:ready -label:status:in-progress -label:status:review -label:status:blocked' },
  { name: '当前工作', filter: 'is:open label:status:in-progress' },
  { name: '等待验收', filter: 'status:待验收' },
  { name: '阻塞与分诊', filter: 'status:阻塞' },
];

export async function syncProjectViews(api, project) {
  const views = []; let cursor = null;
  do {
    const data = await api.graphql('query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{views(first:100,after:$cursor){nodes{id name filter} pageInfo{hasNextPage endCursor}}}}}', { id: project.id, cursor });
    views.push(...data.node.views.nodes);
    cursor = data.node.views.pageInfo.hasNextPage ? data.node.views.pageInfo.endCursor : null;
  } while (cursor);
  for (const expected of PROJECT_VIEWS) {
    const matches = views.filter(view => view.name === expected.name);
    if (matches.length > 1) throw new Error('Multiple managed views share a name; resolve the duplicate before synchronization.');
    let view = matches[0];
    if (!view) {
      const created = await api.graphql('mutation($id:ID!,$name:String!){createProjectV2View(input:{projectId:$id,name:$name,layout:TABLE_LAYOUT}){projectV2View{id name filter}}}', { id: project.id, name: expected.name });
      view = created.createProjectV2View.projectV2View;
    }
    if (view.filter !== expected.filter) {
      const result = await api.graphql('mutation($id:ID!,$filter:String!){updateProjectV2View(input:{viewId:$id,filter:$filter}){projectV2View{id name filter}}}', { id: view.id, filter: expected.filter });
      if (result.updateProjectV2View.projectV2View.filter !== expected.filter) throw new Error('Project view filter could not be verified.');
    }
  }
}

async function findProject(api, owner, repositoryId, number, title, bootstrap) {
  const ownerQuery = `query($owner:String!,$cursor:String){user(login:$owner){id projectsV2(first:100,after:$cursor){nodes{id number title} pageInfo{hasNextPage endCursor}}}}`;
  let cursor = null, ownerId, project;
  if (number) {
    const result = await api.graphql(`query($owner:String!,$number:Int!){user(login:$owner){projectV2(number:$number){id number title}}}`, { owner, number: Number(number) });
    project = result.user?.projectV2;
    if (!project) throw new Error('Configured project does not exist or is inaccessible.');
  } else {
    do {
      const result = await api.graphql(ownerQuery, { owner, cursor });
      ownerId = result.user?.id;
      const page = result.user?.projectsV2;
      if (!page) throw new Error('Personal Projects are inaccessible.');
      const matches = page.nodes.filter(p => p.title === title);
      if (matches.length > 1 || (project && matches.length)) throw new Error('Multiple projects share the title; set PROJECT_NUMBER.');
      project ||= matches[0];
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    if (!project) {
      if (!bootstrap) throw new Error('Project not initialized; run the repository bootstrap.');
      const created = await api.graphql('mutation($owner:ID!,$repo:ID!,$title:String!){createProjectV2(input:{ownerId:$owner,repositoryId:$repo,title:$title}){projectV2{id number title}}}', { owner: ownerId, repo: repositoryId, title });
      project = created.createProjectV2.projectV2;
    }
  }
  const result = await api.graphql(`query($id:ID!){node(id:$id){... on ProjectV2{id number title url public items(first:1){totalCount} ${FIELD_QUERY}}}}`, { id: project.id });
  const projectData = result.node;
  let repositoryCursor = null, linked = false;
  do {
    const links = await api.graphql('query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{repositories(first:100,after:$cursor){nodes{id} pageInfo{hasNextPage endCursor}}}}}', { id: project.id, cursor: repositoryCursor });
    const page = links.node.repositories;
    linked ||= page.nodes.some(repository => repository.id === repositoryId);
    repositoryCursor = !linked && page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (repositoryCursor);
  if (!linked) await api.graphql('mutation($project:ID!,$repository:ID!){linkProjectV2ToRepository(input:{projectId:$project,repositoryId:$repository}){repository{id}}}', { project: project.id, repository: repositoryId });
  return projectData;
}

async function syncProject(api, project, issues, bootstrap, problems) {
  let field = project.fields.nodes.find(f => f.name === 'Status');
  if (!field) throw new Error('Project Status field is missing.');
  if (!STATUS.every(name => field.options.some(option => option.name === name))) {
    if (!bootstrap || project.items.totalCount > 0) throw new Error('Existing Status options differ; refusing to replace options on a populated project.');
    const colors = ['GRAY', 'BLUE', 'YELLOW', 'GREEN', 'RED'];
    const result = await api.graphql('mutation($id:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field(input:{fieldId:$id,singleSelectOptions:$options}){projectV2Field{... on ProjectV2SingleSelectField{id name options{id name}}}}}', {
      id: field.id, options: STATUS.map((name, index) => ({ name, color: colors[index], description: `${name}阶段` })),
    });
    field = result.updateProjectV2Field.projectV2Field;
  }
  const readItems = async () => {
    const items = new Map(); let cursor = null;
    do {
      const data = await api.graphql('query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{id}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}} pageInfo{hasNextPage endCursor}}}}}', { id: project.id, cursor });
      const page = data.node.items;
      for (const item of page.nodes) if (item.content?.id) items.set(item.content.id, item);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    return items;
  };
  const items = await readItems();
  for (const issue of issues) {
    let item = items.get(issue.node_id);
    if (!item) {
      const added = await api.graphql('mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}', { project: project.id, content: issue.node_id });
      item = added.addProjectV2ItemById.item;
    }
    const status = desiredStatus(issue, issues, problems);
    if (item.fieldValueByName?.name !== status) await api.graphql('mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}', {
      project: project.id, item: item.id, field: field.id, option: field.options.find(o => o.name === status).id,
    });
  }
  const synchronized = await readItems();
  for (const issue of issues) {
    if (synchronized.get(issue.node_id)?.fieldValueByName?.name !== desiredStatus(issue, issues, problems)) {
      throw new Error(`Project synchronization could not be verified for Issue #${issue.number}.`);
    }
  }
}

export async function runManagement(env = process.env, request = fetch) {
  if (env.GITHUB_ACTIONS !== 'true' || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')) {
    throw new Error('Run project management only inside the authorized repository workflow.');
  }
  const api = apiClient(env.GITHUB_TOKEN, request), repository = env.GITHUB_REPOSITORY;
  const bootstrap = env.MANAGEMENT_BOOTSTRAP === 'true';
  const allIssues = (await api.all(`repos/${repository}/issues?state=all`)).filter(i => !i.pull_request);
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  // Always fetch the latest issue state; queued old events must not overwrite newer status.
  // Reconcile every task each time: dropped/coalesced events and changed blockers
  // must not leave another issue, parent stage or readiness label stale.
  if (event.issue) {
    const latest = await api(`repos/${repository}/issues/${event.issue.number}`);
    const index = allIssues.findIndex(i => i.number === latest.number);
    if (index >= 0) allIssues[index] = latest; else allIssues.push(latest);
  }
  const issues = allIssues;
  const problems = managementProblems(issues);
  await syncRepository(api, repository, allIssues, fileURLToPath(new URL('../', import.meta.url)), issues, bootstrap, problems);
  if (!env.PROJECT_TOKEN) throw new Error('Repository metadata is prepared; PROJECT_TOKEN is required for personal Projects.');
  const projectApi = apiClient(env.PROJECT_TOKEN, request), owner = repository.split('/')[0];
  const repositoryInfo = await api(`repos/${repository}`);
  const project = await findProject(projectApi, owner, repositoryInfo.node_id, env.PROJECT_NUMBER, env.PROJECT_TITLE || 'Riverlight 开发', bootstrap);
  await syncProject(projectApi, project, issues, bootstrap, problems);
  if (bootstrap) await syncProjectViews(projectApi, project);
  const warnings = [...problems].map(([number, messages]) => `- #${number}: ${messages.join('；')}`).join('\n');
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `Project synchronized: ${project.url}\nIssues checked: ${issues.length}\n\n${warnings}\n`);
  console.log(`Project synchronized: ${project.url}; ${issues.length} issues checked.`);
  if (problems.size) throw new Error(`${problems.size} issues require triage; see the workflow summary. Project status reflects those blockers.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagement().catch(error => { console.error(error.message); process.exitCode = 1; });
}
