import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reconcileClaims, codeReviewState, workflowReviewValid, readableApproval, readReceipts, commentField } from './github-collaboration.mjs';

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

export function legacyAcceptanceFingerprint(issue) {
  const scope = (issue.body || '').split(/^## (?:验收记录|执行记录|交接记录)\s*$/m)[0].trim().replace(/\r\n/g, '\n');
  return createHash('sha256').update(`${issue.title}\n${scope}`).digest('hex');
}

export function acceptanceFingerprint(issue) {
  // Unknown sections remain in scope; exclude only explicit records and metadata.
  const excluded = new Set(['验收记录', '验收准备', '实现与证据', '执行记录', '交接记录', '依据', '任务编号', '协作流程', '阶段', '优先级', '前置']);
  let include = true;
  const scope = (issue.body || '').replace(/\r\n/g, '\n').split('\n').filter(line => {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) include = !excluded.has(heading[1]);
    return include && !/^\s*(?:-\s*)?\*\*(?:任务|协作流程|阶段|系统与优先级|优先级|前置|阶段父任务|交付版本)\*\*[：:]/.test(line);
  }).map(line => line.replace(/^(\s*[-*+] )\[[ xX]\]/, '$1[ ]').trimEnd()).join('\n').trim();
  return 'scope-v2:' + createHash('sha256').update(`${issue.title}\n${scope}`).digest('hex');
}

const fingerprintMatches = (issue, value) => value === acceptanceFingerprint(issue)
  || (!value?.startsWith('scope-v2:') && value === legacyAcceptanceFingerprint(issue));
export const acceptanceBody = issue => (issue.body || '').match(/^## 验收记录[^\S\n]*\n([^]*?)(?=^## |$(?![^]))/m)?.[1] || issue.body || '';
const acceptanceField = (issue, name) => issueField(acceptanceBody(issue), name);

export function visualApprovalValid(issue) {
  const body = acceptanceBody(issue);
  const delivered = issueField(body, '交付版本');
  return /^[a-f0-9]{40}$/.test(delivered || '')
    && issueField(body, '验收版本') === delivered
    && fingerprintMatches(issue, issueField(body, '验收范围摘要'))
    && /^https:\/\/github\.com\//.test(issueField(body, '验收证据') || '')
    && /^https:\/\/github\.com\/.+#issuecomment-\d+$/.test(issueField(body, '确认来源') || '');
}

export function objectiveApprovalValid(issue) {
  return visualApprovalValid(issue);
}

export async function approvalSurvivesReopening(api, repository, issue, reviewers = [repository.split('/')[0]]) {
  if (!visualApprovalValid(issue)) return false;
  const source = acceptanceField(issue, '确认来源');
  const prefix = `https://github.com/${repository}/issues/${issue.number}#issuecomment-`;
  if (!source.startsWith(prefix)) return false;
  const commentId = Number(source.slice(prefix.length));
  const comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
  const confirmation = comments.find(comment => comment.id === commentId);
  if (trustedRecord(confirmation, CLOSE_MARKER)) {
    const closed = await currentClosure(api, repository, issue, reviewers);
    return !!closed && commentField(confirmation.body, '关闭事件') === String(closed.id)
      && commentField(confirmation.body, '确认人') === closed.actor.login
      && commentField(confirmation.body, '交付版本') === acceptanceField(issue, '交付版本')
      && fingerprintMatches(issue, commentField(confirmation.body, '验收范围摘要'))
      && commentField(confirmation.body, '验收证据') === acceptanceField(issue, '验收证据');
  }
  if (!confirmation?.created_at || confirmation.user?.type === 'Bot'
    || !reviewers.some(login => login.toLowerCase() === confirmation.user?.login?.toLowerCase())) return false;
  const approved = await approvalFromComment(confirmation, issue, comments, repository);
  if (!approved || approved.sha !== acceptanceField(issue, '交付版本') || !fingerprintMatches(issue, approved.fingerprint)) return false;
  const events = await api.all(`repos/${repository}/issues/${issue.number}/timeline`);
  return !events.some(event => event.event === 'reopened' && event.created_at >= confirmation.created_at);
}

export async function approvalFromComment(confirmation, issue, comments, repository) {
  const match = confirmation.body?.trim().match(/^\/riverlight (approve-visual|approve-objective)\s+(\{[^]*\})$/);
  let approved;
  if (match) {
    if (match[1] !== (issueMetadata(issue).visual ? 'approve-visual' : 'approve-objective')) return null;
    try { approved = JSON.parse(match[2]); } catch { return null; }
  } else approved = readableApproval(confirmation.body, issueMetadata(issue).visual);
  if (!approved?.preparation) return approved;
  const prefix = `https://github.com/${repository}/issues/${issue.number}#issuecomment-`;
  if (!approved.preparation.startsWith(prefix) || !/^\d+$/.test(approved.preparation.slice(prefix.length))) return null;
  const preparation = comments.find(comment => comment.id === Number(approved.preparation.slice(prefix.length)));
  if (preparation?.user?.login !== 'github-actions[bot]' || preparation.user.type !== 'Bot'
    || !preparation.body?.startsWith('<!-- riverlight:acceptance-preparation:v2 -->')
    || !preparation.created_at || preparation.created_at > confirmation.created_at) return null;
  try {
    return { sha: commentField(preparation.body, '交付版本'), fingerprint: commentField(preparation.body, '验收范围摘要'),
      evidence: commentField(preparation.body, '验收证据') };
  } catch { return null; }
}

export function updateAcceptanceBody(body, fields) {
  const expression = /^## 验收记录[^\S\n]*\n([^]*?)(?=^## |$(?![^]))/m;
  const existing = body.match(expression)?.[1] || '';
  const remaining = existing.split('\n').filter(line => !/^\s*(?:-\s*)?\*\*(?:交付版本|验收版本|验收范围摘要|验收证据|确认来源)\*\*[：:]/.test(line)).join('\n').trim();
  const record = '## 验收记录\n\n' + Object.entries(fields).map(([name, value]) => `- **${name}**：${value}`).join('\n') + (remaining ? `\n\n${remaining}` : '') + '\n\n';
  return expression.test(body) ? body.replace(expression, () => record) : body.trimEnd() + '\n\n' + record;
}

export async function reconcileAcceptanceRecord(api, repository, issue, reviewers, snapshot) {
  if (await approvalSurvivesReopening(api, repository, issue, reviewers)) return;
  await reconcileCloseAcceptance(api, repository, issue, reviewers, snapshot);
  if (await approvalSurvivesReopening(api, repository, issue, reviewers)) return;
  const comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
  for (const comment of [...comments].sort((a, b) => b.id - a.id)) {
    if (!comment.created_at || comment.user?.type === 'Bot' || !reviewers.some(login => login.toLowerCase() === comment.user?.login?.toLowerCase())) continue;
    const approval = await approvalFromComment(comment, issue, comments, repository);
    if (!approval?.evidence || approval.sha !== acceptanceField(issue, '交付版本') || !fingerprintMatches(issue, approval.fingerprint)
      || !/^https:\/\/github\.com\//.test(approval.evidence)) continue;
    const source = `https://github.com/${repository}/issues/${issue.number}#issuecomment-${comment.id}`;
    const body = updateAcceptanceBody(issue.body || '', { 交付版本: approval.sha, 验收版本: approval.sha, 验收范围摘要: approval.fingerprint, 验收证据: approval.evidence, 确认来源: source });
    const candidate = { ...issue, body };
    if (!await approvalSurvivesReopening(api, repository, candidate, reviewers)) continue;
    if (body !== issue.body) {
      const latest = await api(`repos/${repository}/issues/${issue.number}`);
      if (latest.body !== issue.body) throw new Error('Issue changed during acceptance recording; rerun from its current scope.');
      await api(`repos/${repository}/issues/${issue.number}`, 'PATCH', { body });
      issue.body = body;
    }
    return;
  }
}

const PREPARATION_MARKER = '<!-- riverlight:acceptance-preparation:v2 -->';
const CLOSE_MARKER = '<!-- riverlight:close-acceptance:v1 -->';
const trustedRecord = (comment, marker) => comment?.user?.login === 'github-actions[bot]'
  && comment.user.type === 'Bot' && comment.body?.startsWith(marker);

async function currentClosure(api, repository, issue, reviewers) {
  if (issue.state !== 'closed' || issue.state_reason !== 'completed' || !issue.closed_at) return null;
  const events = await api.all(`repos/${repository}/issues/${issue.number}/timeline`);
  // API timeline order distinguishes close/reopen cycles even within one second.
  const closed = events.filter(event => ['closed', 'reopened'].includes(event.event)).at(-1);
  if (closed?.event !== 'closed' || !closed.id || closed.created_at !== issue.closed_at
    || closed.commit_id || closed.commit_url || closed.actor?.type !== 'User'
    || !reviewers.some(login => login.toLowerCase() === closed.actor.login?.toLowerCase())) return null;
  const permission = await api(`repos/${repository}/collaborators/${encodeURIComponent(closed.actor.login)}/permission`);
  return ['admin', 'maintain', 'write'].includes(permission.permission) ? closed : null;
}

export async function reconcileCloseAcceptance(api, repository, issue, reviewers, snapshot) {
  const closed = await currentClosure(api, repository, issue, reviewers);
  if (!closed || !issue.labels?.some(label => (label.name || label) === 'status:review')) return;
  // A queued close must never approve a delivery or requirement added afterwards.
  if (snapshot && (snapshot.closed_at !== issue.closed_at || snapshot.state_reason !== 'completed'
    || !snapshot.labels?.some(label => (label.name || label) === 'status:review')
    || acceptanceFingerprint(snapshot) !== acceptanceFingerprint(issue)
    || acceptanceField(snapshot, '交付版本') !== acceptanceField(issue, '交付版本'))) return;
  const sha = acceptanceField(issue, '交付版本'), fingerprint = acceptanceFingerprint(issue);
  if (!/^[a-f0-9]{40}$/.test(sha || '')) return;
  const comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
  // Only a bot snapshot published before closing can supply the approved scope.
  const prepared = [...comments].reverse().find(comment => trustedRecord(comment, PREPARATION_MARKER)
    && comment.created_at && comment.created_at < closed.created_at
    && (!comment.updated_at || comment.updated_at < closed.created_at)
    && commentField(comment.body, '交付版本') === sha
    && commentField(comment.body, '验收范围摘要') === fingerprint
    && /^https:\/\/github\.com\//.test(commentField(comment.body, '验收证据') || ''));
  if (!prepared) return;
  const evidence = commentField(prepared.body, '验收证据');
  let receipt = comments.find(comment => trustedRecord(comment, CLOSE_MARKER)
    && commentField(comment.body, '关闭事件') === String(closed.id)
    && commentField(comment.body, '交付版本') === sha
    && commentField(comment.body, '验收范围摘要') === fingerprint);
  // First approval requires the real close webhook's immutable Issue snapshot.
  // Compensation may restore a persisted receipt, never infer a missing snapshot.
  if (!receipt && !snapshot) return;
  if (!receipt) receipt = await api(`repos/${repository}/issues/${issue.number}/comments`, 'POST', {
    body: `${CLOSE_MARKER}\n## 关闭验收记录\n\n- **确认方式**：Close as completed\n- **确认人**：${closed.actor.login}\n- **关闭事件**：${closed.id}\n- **交付版本**：${sha}\n- **验收范围摘要**：${fingerprint}\n- **验收证据**：${evidence}\n\n授权验收者直接关闭了本次交付，无需另发验收评论。重开、需求或交付变化后须重新验收。`,
  });
  const latest = await api(`repos/${repository}/issues/${issue.number}`);
  if (latest.body !== issue.body || latest.state !== issue.state || latest.closed_at !== issue.closed_at
    || latest.state_reason !== 'completed') throw new Error('Issue changed during close acceptance; rerun from its current state.');
  const body = updateAcceptanceBody(issue.body || '', { 交付版本: sha, 验收版本: sha, 验收范围摘要: fingerprint,
    验收证据: evidence, 确认来源: `https://github.com/${repository}/issues/${issue.number}#issuecomment-${receipt.id}` });
  if (body !== issue.body) {
    await api(`repos/${repository}/issues/${issue.number}`, 'PATCH', { body });
    issue.body = body;
  }
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
    const selected = (issue.labels || []).filter(l => /^status:(blocked|review|in-progress|code-review)$/.test(typeof l === 'string' ? l : l.name));
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
    if (issue.state_reason && issue.state_reason !== 'completed') return '待验收';
    if (issueField(issue.body || '', '协作流程') === 'v2'
      && (!names.has('acceptance-approved') || !objectiveApprovalValid(issue))) return '待验收';
    if (issueMetadata(issue).visual && (!names.has('visual-approved') || !visualApprovalValid(issue))) return '待验收';
    const stage = issue.title.match(/^\[(R\d+)\]/)?.[1];
    if (stage) {
      if (stack.has(issue.number)) return '待验收';
      const next = new Set([...stack, issue.number]);
      const children = issues.filter(i => issueMetadata(i).task && issueMetadata(i).phase === stage);
      const exit = (issue.body || '').match(/^## 阶段出口[^\S\n]*\n([^]*?)(?=^## |$(?![^]))/m)?.[1] || '';
      if (!children.length || !/- \[x\]/i.test(exit) || /- \[ \]/.test(exit)
        || children.some(i => desiredStatus(i, issues, problems, next) !== '完成')) return '待验收';
    }
    return '完成';
  }
  const selected = ['status:blocked', 'status:review', 'status:in-progress', 'status:code-review'].filter(name => names.has(name));
  if (selected.length > 1) throw new Error(`Issue #${issue.number} has conflicting status labels.`);
  return ({ 'status:blocked': '阻塞', 'status:review': '待验收', 'status:in-progress': '进行中', 'status:code-review': '进行中' })[selected[0]] || '待办';
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

export function cacheManagementReads(api) {
  const reads = new Map();
  const remember = (key, read) => {
    if (!reads.has(key)) reads.set(key, Promise.resolve().then(read).catch(error => { reads.delete(key); throw error; }));
    return reads.get(key);
  };
  const cached = async (endpoint, method = 'GET', body) => {
    if (method === 'GET' && endpoint.endsWith('/permission')) return remember(endpoint, () => api(endpoint));
    if (method !== 'GET') {
      for (const key of reads.keys()) if (key === endpoint || key.startsWith(endpoint + '/') || endpoint.startsWith(key + '/')
        || (/\/issues\/comments\//.test(endpoint) && key.endsWith('/comments'))) reads.delete(key);
    }
    return api(endpoint, method, body);
  };
  cached.all = endpoint => /\/(?:comments|sub_issues|reviews|timeline)$/.test(endpoint)
    ? remember(endpoint, () => api.all(endpoint)) : api.all(endpoint);
  cached.graphql = (...args) => api.graphql(...args);
  return cached;
}

export function managementEventRelevant(eventName, event) {
  if (eventName !== 'issue_comment') return true;
  if (event.issue?.pull_request) return false; // PR body/review events own review state.
  return [event.comment?.body, event.changes?.body?.from].some(body => /^(?:#{2,3} (?:任务认领|认领更新|任务交接|视觉验收|客观验收)\s*\n|\/riverlight (?:claim|release|touch|approve-visual|approve-objective)\b)/.test((body || '').trim()));
}

export async function prepareAcceptance(api, repository, issue, sha, evidence, actor, reviewers = [repository.split('/')[0]]) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^https:\/\/github\.com\//.test(evidence || '')) throw new Error('Acceptance preparation requires a full delivered SHA and a GitHub evidence link.');
  const permission = await api(`repos/${repository}/collaborators/${encodeURIComponent(actor)}/permission`);
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) throw new Error('Acceptance preparation requires repository write permission.');
  await api(`repos/${repository}/commits/${sha}`); // The delivery must exist in this repository.
  const fingerprint = acceptanceFingerprint(issue);
  const comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
  let candidate = comments.find(comment => comment.user?.login === 'github-actions[bot]' && comment.user.type === 'Bot'
    && comment.body?.startsWith('<!-- riverlight:acceptance-preparation:v2 -->')
    && commentField(comment.body, '交付版本') === sha && commentField(comment.body, '验收范围摘要') === fingerprint && commentField(comment.body, '验收证据') === evidence);
  if (!candidate) candidate = await api(`repos/${repository}/issues/${issue.number}/comments`, 'POST', {
    body: `<!-- riverlight:acceptance-preparation:v2 -->\n## 验收准备\n\n- **交付版本**：${sha}\n- **验收范围摘要**：${fingerprint}\n- **验收证据**：${evidence}\n\n核对本任务交付后，直接选择 Close as completed 即表示验收通过，无需另发评论或手动修改 Project。此准备记录不代表验收通过。`,
  });
  const latest = await api(`repos/${repository}/issues/${issue.number}`);
  if (latest.body !== issue.body) throw new Error('Issue changed during preparation; rerun from its current scope.');
  const alreadyAccepted = acceptanceField(issue, '交付版本') === sha && await approvalSurvivesReopening(api, repository, issue, reviewers);
  const body = alreadyAccepted ? issue.body : updateAcceptanceBody(issue.body || '', { 交付版本: sha, 验收证据: evidence });
  if (body !== issue.body) await api(`repos/${repository}/issues/${issue.number}`, 'PATCH', { body });
  return `## ${issueMetadata(issue).visual ? '视觉验收' : '客观验收'}\n\n- **验收结论**：通过\n- **验收准备**：https://github.com/${repository}/issues/${issue.number}#issuecomment-${candidate.id}\n`;
}

export async function runReviewOnly(env, event, api, repository, issues) {
  const pr = await api(`repos/${repository}/pulls/${env.REVIEW_PR}`);
  const linked = issues.filter(issue => new RegExp(`(?:关联|Refs:?)\\s+#${issue.number}\\b`, 'i').test(pr.body || ''));
  if (linked.length !== 1) throw new Error('Review confirmation requires one unambiguous task Issue reference.');
  const issue = linked[0], comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
  const claim = readReceipts(comments).filter(receipt => receipt.accepted).at(-1)?.claim;
  const problems = managementProblems(issues);
  if (!claim || claim.branch !== pr.head.ref || problems.has(issue.number) || issue.state !== 'open'
    || (issue.assignees || []).some(assignee => assignee.login.toLowerCase() !== claim.owner.toLowerCase())) throw new Error('Review confirmation requires a valid task claim.');
  const stages = issues.find(item => item.title.startsWith(`[${issueMetadata(issue).phase}]`));
  const indexed = new Map(issues.map(item => [issueMetadata(item).task || item.title.match(/^\[(R\d+)\]/)?.[1], item]));
  if (!claim.override && [...issueMetadata(issue).dependencies, ...issueMetadata(stages || { title: '', body: '' }).dependencies]
    .some(id => !indexed.has(id) || desiredStatus(indexed.get(id), issues, problems) !== '完成')) throw new Error('Review confirmation has unresolved task dependencies.');
  await recordWorkflowReview(env, event, api, repository, new Map([[issue.number, { claim }]]));
  await api(`repos/${repository}/statuses/${pr.head.sha}`, 'POST', { state: 'success', context: 'collaboration',
    description: 'Task claim and current revision review verified', target_url: pr.html_url });
}

async function syncRepository(api, repository, issues, root, targets, bootstrap, problems, reviewers) {
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
    ['status:code-review', '8250df', '代码审查中；尚未完成产品验收'],
    ['management:stale', 'd4a72c', '认领长期无更新，提醒协调，不自动释放'],
    ['acceptance-approved', '1a7f37', '授权验收者已确认当前版本和范围'],
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
    if (metadata.visual || issueField(issue.body || '', '协作流程') === 'v2') {
      await reconcileAcceptanceRecord(api, repository, issue, reviewers);
      const valid = await approvalSurvivesReopening(api, repository, issue, reviewers);
      await setLabel(metadata.visual ? 'visual-approved' : 'acceptance-approved', valid);
      if (metadata.visual && issueField(issue.body || '', '协作流程') === 'v2') await setLabel('acceptance-approved', valid);
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
  { name: '当前可开始', filter: 'is:open no:assignee label:management:ready -label:status:in-progress -label:status:code-review -label:status:review -label:status:blocked' },
  { name: '当前工作', filter: 'is:open status:进行中' },
  { name: '等待验收', filter: 'status:待验收' },
  { name: '阻塞与分诊', filter: 'status:阻塞' },
  { name: '我的任务', filter: 'is:open assignee:@me' },
  { name: '代码审查', filter: 'is:open label:status:code-review' },
  { name: '认领需协调', filter: 'is:open label:management:stale' },
];

export const COORD_FIELDS = ['执行者', '任务分支', '交付范围', '独占资源', '认领更新', '代码审查', '产品验收', '发布状态'];

export async function syncCoordinationFields(api, project, issues, states) {
  for (const name of COORD_FIELDS) {
    if (!project.fields.nodes.some(f => f.name === name)) {
      const result = await api.graphql('mutation($project:ID!,$name:String!){createProjectV2Field(input:{projectId:$project,dataType:TEXT,name:$name}){projectV2Field{... on ProjectV2Field{id name}}}}', { project: project.id, name });
      project.fields.nodes.push(result.createProjectV2Field.projectV2Field);
    }
  }
  let cursor = null;
  const items = new Map();
  const query = 'query($id:ID!,$cursor:String){node(id:$id){... on ProjectV2{items(first:100,after:$cursor){nodes{id content{... on Issue{id}} fieldValues(first:100){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2Field{id name}}}}}} pageInfo{hasNextPage endCursor}}}}}';
  do {
    const data = await api.graphql(query, { id: project.id, cursor });
    const page = data.node.items;
    for (const item of page.nodes) items.set(item.content?.id, item);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  const expected = new Map();
  for (const issue of issues) {
    const state = states.get(issue.number) || {}, claim = state.claim, delivery = claim || state.lastClaim;
    const values = [claim?.display || claim?.executor || '', delivery?.branch || '', delivery?.scope || '', claim?.resources.map(r => r.replace(/^file:/, '').replace(/^blender:/, 'Blender 会话 ')).join('、') || '', claim?.updated || '',
      state.review || '无当前任务 PR', desiredStatus(issue, issues) === '完成' ? '已验收' : issue.labels.some(l => l.name === 'status:review') ? '待验收' : '未验收',
      state.pr?.merged_at ? '已集成 dev；发布单独确认' : state.pr ? '未集成' : '未记录发布'];
    const item = items.get(issue.node_id);
    if (!item) throw new Error(`Missing Project item for #${issue.number}`);
    expected.set(issue.node_id, values);
    for (let index = 0; index < COORD_FIELDS.length; index++) {
      const field = project.fields.nodes.find(f => f.name === COORD_FIELDS[index]), text = values[index];
      const previous = item.fieldValues.nodes.find(v => v.field?.id === field.id)?.text || '';
      if (previous === text) continue;
      if (text) await api.graphql('mutation($project:ID!,$item:ID!,$field:ID!,$text:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{text:$text}}){projectV2Item{id}}}', { project: project.id, item: item.id, field: field.id, text });
      else await api.graphql('mutation($project:ID!,$item:ID!,$field:ID!){clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}){projectV2Item{id}}}', { project: project.id, item: item.id, field: field.id });
    }
  }
  cursor = null;
  do {
    const data = await api.graphql(query, { id: project.id, cursor });
    const page = data.node.items;
    for (const item of page.nodes) {
      const values = expected.get(item.content?.id);
      if (!values) continue;
      for (let i = 0; i < COORD_FIELDS.length; i++) {
        if ((item.fieldValues.nodes.find(v => v.field?.name === COORD_FIELDS[i])?.text || '') !== values[i]) throw new Error('Coordination field synchronization could not be verified.');
      }
      expected.delete(item.content.id);
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  if (expected.size) throw new Error('Missing Project coordination items after synchronization.');
}

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

export async function recordWorkflowReview(env, event, api, repository, states) {
  if (!env.REVIEW_PR && !env.REVIEW_SHA && !env.REVIEW_SCOPE) return;
  const reviewers = (env.CODE_REVIEWERS || repository.split('/')[0]).split(',').map(s => s.trim().toLowerCase());
  const actor = env.GITHUB_ACTOR || '';
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || event.sender?.login?.toLowerCase() !== actor.toLowerCase()
    || !reviewers.includes(actor.toLowerCase())) throw new Error('Only an authorized workflow initiator can confirm a review.');
  if (!/^[1-9]\d*$/.test(env.REVIEW_PR || '') || !/^[a-f0-9]{40}$/.test(env.REVIEW_SHA || '')
    || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || typeof env.REVIEW_SCOPE !== 'string'
    || env.REVIEW_SCOPE.trim().length < 12 || env.REVIEW_SCOPE.length > 500 || /[\r\n]/.test(env.REVIEW_SCOPE)) {
    throw new Error('Review confirmation requires a PR, full current SHA and a concise scope.');
  }
  const permission = await api(`repos/${repository}/collaborators/${encodeURIComponent(actor)}/permission`);
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) throw new Error('Review initiator lacks repository write permission.');
  const pr = await api(`repos/${repository}/pulls/${env.REVIEW_PR}`);
  const claimed = [...states.values()].some(s => s.claim?.branch === pr.head.ref);
  if (!claimed || pr.state !== 'open' || pr.draft || pr.head.repo?.full_name !== repository || pr.base.ref !== 'dev') {
    throw new Error('Review confirmation requires an active task claim and an open task PR into dev.');
  }
  if (pr.head.sha !== env.REVIEW_SHA) throw new Error('PR head changed; review the current revision before confirming.');
  const reviews = await api.all(`repos/${repository}/pulls/${pr.number}/reviews`);
  if (codeReviewState(pr, reviews) === '需修改') throw new Error('Resolve requested changes before confirming an automated review.');
  const desired = { state: 'success', context: 'maintainer-review',
    description: `Automated review by ${actor} for ${pr.head.sha}`,
    target_url: `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}` };
  const previous = (await api.all(`repos/${repository}/commits/${pr.head.sha}/statuses`)).find(s => s.context === desired.context);
  if (previous?.state !== desired.state || previous?.description !== desired.description) {
    await api(`repos/${repository}/statuses/${pr.head.sha}`, 'POST', desired);
  }
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `\nAutomated review (shared account): PR #${pr.number}, ${pr.head.sha}, @${actor}\n\n${env.REVIEW_SCOPE.trim()}\n`);
}

export async function runManagement(env = process.env, request = fetch) {
  if (env.GITHUB_ACTIONS !== 'true' || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '')) {
    throw new Error('Run project management only inside the authorized repository workflow.');
  }
  const repository = env.GITHUB_REPOSITORY;
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  if (!managementEventRelevant(env.GITHUB_EVENT_NAME, event)) { console.log('Discussion comment: no management synchronization required.'); return; }
  const api = cacheManagementReads(apiClient(env.GITHUB_TOKEN, request));
  const choices = [!!(env.REVIEW_PR || env.REVIEW_SHA || env.REVIEW_SCOPE), !!(env.ACCEPTANCE_ISSUE || env.DELIVERY_SHA || env.ACCEPTANCE_EVIDENCE), env.MANAGEMENT_BOOTSTRAP === 'true'];
  if (choices.filter(Boolean).length > 1) throw new Error('Choose synchronization/bootstrap, review confirmation or acceptance preparation in separate runs.');
  const bootstrap = env.MANAGEMENT_BOOTSTRAP === 'true';
  const allIssues = (await api.all(`repos/${repository}/issues?state=all`)).filter(i => !i.pull_request);
  if (env.REVIEW_PR || env.REVIEW_SHA || env.REVIEW_SCOPE) {
    await runReviewOnly(env, event, api, repository, allIssues);
    console.log('Current revision review recorded; Project projection follows the next synchronization.');
    return;
  }
  if (env.ACCEPTANCE_ISSUE || env.DELIVERY_SHA || env.ACCEPTANCE_EVIDENCE) {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || event.sender?.login !== env.GITHUB_ACTOR || !/^[1-9]\d*$/.test(env.ACCEPTANCE_ISSUE)) throw new Error('Acceptance preparation requires an authenticated workflow request.');
    const issue = await api(`repos/${repository}/issues/${env.ACCEPTANCE_ISSUE}`);
    const delivery = env.DELIVERY_SHA || acceptanceField(issue, '交付版本') || env.GITHUB_SHA;
    const reviewers = (env.VISUAL_REVIEWERS || repository.split('/')[0]).split(',').map(login => login.trim());
    const confirmation = await prepareAcceptance(api, repository, issue, delivery, env.ACCEPTANCE_EVIDENCE, env.GITHUB_ACTOR, reviewers);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\nPrepared acceptance record; confirm only after reviewing the delivery:\n\n\`\`\`markdown\n${confirmation}\`\`\`\n`);
    console.log('Acceptance prepared; no approval or closure was performed.');
    return;
  }
  // Always fetch the latest issue state; queued old events must not overwrite newer status.
  // Reconcile every task each time: dropped/coalesced events and changed blockers
  // must not leave another issue, parent stage or readiness label stale.
  if (event.issue && !event.issue.pull_request) {
    const latest = await api(`repos/${repository}/issues/${event.issue.number}`);
    const index = allIssues.findIndex(i => i.number === latest.number);
    if (index >= 0) allIssues[index] = latest; else allIssues.push(latest);
  }
  const issues = allIssues;
  const problems = managementProblems(issues);
  let states;
  if (env.COLLABORATION_ENABLED === 'true') {
    const labels = await api.all(`repos/${repository}/labels`);
    for (const [name, color] of [['status:code-review', '8250df'], ['management:stale', 'd4a72c']]) {
      if (!labels.some(l => l.name === name)) await api(`repos/${repository}/labels`, 'POST', { name, color });
    }
    const stages = new Map(issues.filter(i => /^\[R\d+\]/.test(i.title)).map(i => [i.title.match(/^\[(R\d+)\]/)[1], i]));
    const indexed = new Map(issues.map(i => [issueMetadata(i).task || i.title.match(/^\[(R\d+)\]/)?.[1], i]));
    const isReady = issue => {
      const meta = issueMetadata(issue), parent = stages.get(meta.phase);
      return !!meta.task && !problems.has(issue.number) && !problems.has(parent?.number)
        && [...meta.dependencies, ...issueMetadata(parent || { title: '', body: '' }).dependencies].every(id => indexed.has(id) && desiredStatus(indexed.get(id), issues, problems) === '完成');
    };
    isReady.valid = issue => !!issueMetadata(issue).task && !problems.has(issue.number);
    states = await reconcileClaims(api, repository, issues, isReady);
    const prs = await api.all(`repos/${repository}/pulls?state=all`);
    await recordWorkflowReview(env, event, api, repository, states);
    for (const issue of issues) {
      const state = states.get(issue.number), claim = state?.claim;
      if (!claim && state?.lastClaim) {
        state.pr = prs.find(pr => pr.head.ref === state.lastClaim.branch && pr.head.repo?.full_name === repository && pr.base.ref === 'dev');
        state.review = state.pr ? codeReviewState(state.pr, await api.all(`repos/${repository}/pulls/${state.pr.number}/reviews`)) : '无当前任务 PR';
      }
      if (!claim && state?.releasedOwner) {
        if (issue.assignees?.some(a => a.login.toLowerCase() === state.releasedOwner.toLowerCase())) {
          await api(`repos/${repository}/issues/${issue.number}/assignees`, 'DELETE', { assignees: [state.releasedOwner] });
          issue.assignees = issue.assignees.filter(a => a.login.toLowerCase() !== state.releasedOwner.toLowerCase());
        }
        for (const label of issue.labels.filter(l => ['status:in-progress', 'status:code-review'].includes(l.name))) {
          await api(`repos/${repository}/issues/${issue.number}/labels/${encodeURIComponent(label.name)}`, 'DELETE');
          issue.labels = issue.labels.filter(l => l.name !== label.name);
        }
      }
      const active = issue.labels.some(l => ['status:in-progress', 'status:code-review'].includes(l.name));
      if (active && !claim) problems.set(issue.number, [...(problems.get(issue.number) || []), '进行中任务缺有效认领']);
      if (claim) {
        if (!isReady(issue) && !claim.override) problems.set(issue.number, [...(problems.get(issue.number) || []), '认领后的前置不再满足，需重新协调']);
        if (!(issue.assignees || []).some(a => a.login.toLowerCase() === claim.owner.toLowerCase())) {
          await api(`repos/${repository}/issues/${issue.number}/assignees`, 'POST', { assignees: [claim.owner] });
          issue.assignees = [...(issue.assignees || []), { login: claim.owner }];
        }
        if (issue.assignees.some(a => a.login.toLowerCase() !== claim.owner.toLowerCase())) problems.set(issue.number, [...(problems.get(issue.number) || []), '负责人和认领冲突，需明确交接']);
        state.pr = prs.find(pr => pr.head.ref === claim.branch && pr.head.repo?.full_name === repository && pr.base.ref === 'dev');
        state.review = state.pr ? codeReviewState(state.pr, await api.all(`repos/${repository}/pulls/${state.pr.number}/reviews`)) : '无当前任务 PR';
        if (state.pr?.state === 'open') {
          const reviewers = (env.CODE_REVIEWERS || repository.split('/')[0]).split(',').map(s => s.trim());
          const statuses = await api.all(`repos/${repository}/commits/${state.pr.head.sha}/statuses`);
          if (state.review === '待代码审查' && workflowReviewValid(state.pr, statuses, reviewers, repository)) state.review = '已自动审查（共用账号）';
          const linked = new RegExp(`(?:关联|Refs:?)\\s+#${issue.number}\\b`, 'i').test(state.pr.body || '');
          const approved = linked && !problems.has(issue.number) && ['已审查', '已自动审查（共用账号）'].includes(state.review);
          const desired = { state: approved ? 'success' : 'pending', context: 'collaboration', description: approved ? 'Task claim and current revision review verified' : 'Requires Issue reference and review of current head', target_url: state.pr.html_url };
          const previous = statuses.find(s => s.context === 'collaboration');
          if (previous?.state !== desired.state || previous?.description !== desired.description) await api(`repos/${repository}/statuses/${state.pr.head.sha}`, 'POST', desired);
        }
        const label = state.pr?.state === 'open' && !state.pr.draft ? 'status:code-review' : 'status:in-progress';
        if (!issue.labels.some(l => ['status:review', 'status:blocked'].includes(l.name)) && issue.state === 'open') {
          for (const old of issue.labels.filter(l => ['status:in-progress', 'status:code-review'].includes(l.name) && l.name !== label)) {
            await api(`repos/${repository}/issues/${issue.number}/labels/${encodeURIComponent(old.name)}`, 'DELETE');
            issue.labels = issue.labels.filter(l => l.name !== old.name);
          }
          if (!issue.labels.some(l => l.name === label)) {
            await api(`repos/${repository}/issues/${issue.number}/labels`, 'POST', { labels: [label] }); issue.labels.push({ name: label });
          }
        }
      }
      const stale = claim && issue.state === 'open' && Date.now() - Date.parse(claim.updated) > Number(env.CLAIM_REMINDER_DAYS || 7) * 86400000;
      if (!!stale !== issue.labels.some(l => l.name === 'management:stale')) {
        if (stale) { await api(`repos/${repository}/issues/${issue.number}/labels`, 'POST', { labels: ['management:stale'] }); issue.labels.push({ name: 'management:stale' }); }
        else { await api(`repos/${repository}/issues/${issue.number}/labels/management%3Astale`, 'DELETE'); issue.labels = issue.labels.filter(l => l.name !== 'management:stale'); }
      }
    }
  }
  const reviewers = (env.VISUAL_REVIEWERS || repository.split('/')[0]).split(',').map(s => s.trim()).filter(Boolean);
  if (env.GITHUB_EVENT_NAME === 'issues' && event.action === 'closed' && !event.issue?.pull_request) {
    const issue = issues.find(issue => issue.number === event.issue?.number);
    if (issue && (issueMetadata(issue).visual || issueField(issue.body || '', '协作流程') === 'v2')) {
      await reconcileCloseAcceptance(api, repository, issue, reviewers, event.issue);
      if (!await approvalSurvivesReopening(api, repository, issue, reviewers)) {
        console.warn(`::warning::Issue #${issue.number}: closure did not confirm this delivery. Check authorization, completed reason, pending acceptance and the pre-close preparation; reopen and close again after correcting the delivery.`);
      }
    }
  }
  await syncRepository(api, repository, allIssues, fileURLToPath(new URL('../', import.meta.url)), issues, bootstrap, problems, reviewers);
  if (!env.PROJECT_TOKEN) throw new Error('Repository metadata is prepared; PROJECT_TOKEN is required for personal Projects.');
  const projectApi = apiClient(env.PROJECT_TOKEN, request), owner = repository.split('/')[0];
  const repositoryInfo = await api(`repos/${repository}`);
  const project = await findProject(projectApi, owner, repositoryInfo.node_id, env.PROJECT_NUMBER, env.PROJECT_TITLE || 'Riverlight 开发', bootstrap);
  await syncProject(projectApi, project, issues, bootstrap, problems);
  if (states) await syncCoordinationFields(projectApi, project, issues, states);
  if (bootstrap) await syncProjectViews(projectApi, project);
  const warnings = [...problems].map(([number, messages]) => `- #${number}: ${messages.join('；')}`).join('\n');
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `Project synchronized: ${project.url}\nIssues checked: ${issues.length}\n\n${warnings}\n`);
  console.log(`Project synchronized: ${project.url}; ${issues.length} issues checked.`);
  if (problems.size) console.warn(`::warning::${problems.size} issues require triage; see the workflow summary. Project status reflects those blockers.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagement().catch(error => { console.error(error.message); process.exitCode = 1; });
}
