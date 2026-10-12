import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const STATUS = ['待办', '进行中', '待验收', '完成', '阻塞'];

export function issueMetadata(issue) {
  const body = issue.body || '';
  return {
    task: issue.title.match(/^\[([A-Z]+-\d+)\]/)?.[1],
    phase: body.match(/\*\*阶段\*\*：\s*(R\d+)/)?.[1],
    priority: body.match(/\*\*系统与优先级\*\*：[^\n]*(P[0-3])/)?.[1],
    dependencies: [...(body.match(/\*\*前置\*\*：([^\n]+)/)?.[1] || '').matchAll(/([A-Z]+-\d+|R\d+)\b/g)].map(m => m[1]),
    visual: /\*\*视觉验收\*\*：需要用户确认/.test(body),
  };
}

export function desiredStatus(issue) {
  const names = new Set((issue.labels || []).map(label => typeof label === 'string' ? label : label.name));
  if (issue.state === 'closed') {
    return issueMetadata(issue).visual && !names.has('visual-approved') ? '待验收' : '完成';
  }
  const selected = ['status:blocked', 'status:review', 'status:in-progress'].filter(name => names.has(name));
  if (selected.length > 1) throw new Error(`Issue #${issue.number} has conflicting status labels.`);
  return ({ 'status:blocked': '阻塞', 'status:review': '待验收', 'status:in-progress': '进行中' })[selected[0]] || '待办';
}

export function apiClient(token, request = fetch) {
  if (!token) throw new Error('A GitHub access token is required.');
  const call = async (endpoint, method = 'GET', body) => {
    const response = await request(`https://api.github.com/${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
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

async function syncRepository(api, repository, issues, root, targets, bootstrap) {
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
    if (milestone && !issue.milestone) await api(`${base}/issues/${issue.number}`, 'PATCH', { milestone: milestone.number });
    if (metadata.priority && !issue.labels.some(label => label.name === `priority:${metadata.priority}`)) {
      await api(`${base}/issues/${issue.number}/labels`, 'POST', { labels: [`priority:${metadata.priority}`] });
    }
    const parent = stageParents.get(metadata.phase);
    if (metadata.task && parent) {
      const children = await api.all(`${base}/issues/${parent.number}/sub_issues`);
      if (!children.some(child => child.id === issue.id)) await api(`${base}/issues/${parent.number}/sub_issues`, 'POST', { sub_issue_id: issue.id, replace_parent: true });
    }
    if (metadata.task || /^\[R\d+\]/.test(issue.title)) {
      const blockers = await api.all(`${base}/issues/${issue.number}/dependencies/blocked_by`);
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

async function syncProject(api, project, issues, bootstrap) {
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
  const items = new Map(); let cursor = null;
  do {
    const data = await api.graphql('query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{id}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}} pageInfo{hasNextPage endCursor}}}}}', { id: project.id, cursor });
    const page = data.node.items;
    for (const item of page.nodes) if (item.content?.id) items.set(item.content.id, item);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  for (const issue of issues) {
    let item = items.get(issue.node_id);
    if (!item) {
      const added = await api.graphql('mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}', { project: project.id, content: issue.node_id });
      item = added.addProjectV2ItemById.item;
    }
    const status = desiredStatus(issue);
    if (item.fieldValueByName?.name !== status) await api.graphql('mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}', {
      project: project.id, item: item.id, field: field.id, option: field.options.find(o => o.name === status).id,
    });
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
  const issues = bootstrap || !event.issue ? allIssues : [await api(`repos/${repository}/issues/${event.issue.number}`)];
  await syncRepository(api, repository, allIssues, fileURLToPath(new URL('../', import.meta.url)), issues, bootstrap);
  if (!env.PROJECT_TOKEN) throw new Error('Repository metadata is prepared; PROJECT_TOKEN is required for personal Projects.');
  const projectApi = apiClient(env.PROJECT_TOKEN, request), owner = repository.split('/')[0];
  const repositoryInfo = await api(`repos/${repository}`);
  const project = await findProject(projectApi, owner, repositoryInfo.node_id, env.PROJECT_NUMBER, env.PROJECT_TITLE || 'Riverlight 开发', bootstrap);
  await syncProject(projectApi, project, issues, bootstrap);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `Project synchronized: ${project.url}\nIssues checked: ${issues.length}\n`);
  console.log(`Project synchronized: ${project.url}; ${issues.length} issues checked.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagement().catch(error => { console.error(error.message); process.exitCode = 1; });
}
