// Coordination lives in bot-authored Issue receipts, never a local task database.
export const RECEIPT = '<!-- riverlight:coordination:v1 -->';
const commands = new Set(['claim', 'release', 'touch']);
const loginKey = value => String(value || '').toLowerCase();

export function commentField(body, name) {
  const lines = (body || '').split(/\r?\n/).map(line => line.replace(/^\s*-\s*/, '').trim());
  const values = lines.map(line => line.match(new RegExp(`^(?:\\*\\*)?${name}(?:\\*\\*)?[：:]\\s*(.*)$`))?.[1]).filter(v => v !== undefined);
  if (values.length > 1) throw new Error('Repeated coordination field.');
  return values[0]?.replace(/^`(.*)`$/, '$1').trim();
}

export function readableApproval(body, visual) {
  const heading = visual ? '视觉验收' : '客观验收';
  if (!new RegExp(`^#{2,3} ${heading}\\s*\\n`).test((body || '').trim())) return null;
  try {
    return commentField(body, '验收结论') === '通过'
      ? { sha: commentField(body, '验收版本'), fingerprint: commentField(body, '验收范围摘要') } : null;
  } catch { return null; }
}

export function parseCommand(comment) {
  if (comment.user?.type === 'Bot') return null;
  const human = (comment.body || '').trim().match(/^#{2,3} (任务认领|认领更新|任务交接)\s*\n/);
  if (human) {
    const action = ({ '任务认领': 'claim', '认领更新': 'touch', '任务交接': 'release' })[human[1]];
    try {
      const field = name => commentField(comment.body, name);
      const split = value => value && value !== '无' ? value.split('、').map(s => s.trim()).filter(Boolean) : [];
      const hasResources = field('独占文件') !== undefined || field('独占会话') !== undefined;
      return { action, id: comment.id, actor: comment.user?.login, at: comment.created_at,
        executor: field('执行者代号'), display: field('执行者'), branch: field('任务分支'), scope: field('交付范围'),
        ...(hasResources ? { resources: [...split(field('独占文件')).map(s => `file:${s}`), ...split(field('独占会话')).map(s => `blender:${s}`)] } : {}),
        claim: Number(field('认领编号')), reason: field('交接说明') || field('代办原因'), override: field('提前启动原因') };
    } catch { return { action, id: comment.id, actor: comment.user?.login, at: comment.created_at, invalid: true }; }
  }
  const match = (comment.body || '').trim().match(/^\/riverlight (claim|release|touch)\s+(\{[^]*\})$/);
  if (!match) return null;
  try { return { ...JSON.parse(match[2]), action: match[1], id: comment.id, actor: comment.user?.login, at: comment.created_at }; }
  catch { return { action: match[1], id: comment.id, actor: comment.user?.login, at: comment.created_at, invalid: true }; }
}

export function readReceipts(comments) {
  return comments.filter(c => c.user?.login === 'github-actions[bot]' && c.user?.type === 'Bot' && c.body?.startsWith(RECEIPT))
    .map(c => {
      const payload = c.body.match(/<!-- riverlight-state:([^]*?) -->/) || c.body.match(/```json\n([^]*?)\n```/);
      try { const value = JSON.parse(payload?.[1]); return { ...value, receiptId: c.id }; }
      catch { throw new Error('A coordination receipt is damaged; restore it before accepting new claims.'); }
    }).sort((a, b) => a.receiptId - b.receiptId);
}

export function resourceValid(resource) {
  if (typeof resource !== 'string' || resource.length > 180) return false;
  if (/^blender:[a-z0-9-]+$/.test(resource)) return true;
  if (!resource.startsWith('file:')) return false;
  const file = resource.slice(5);
  return !!file && !file.startsWith('/') && !/[\\:*\s]/.test(file)
    && file.split('/').every(part => part && part !== '.' && part !== '..');
}

export function resourcesOverlap(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  return a === b || (a.startsWith('file:') && b.startsWith('file:')
    && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

export function decideCommand({ command, issue, states, permission, ready, metadataValid = true }) {
  const current = states.get(issue.number)?.claim || null;
  const reject = reason => ({ accepted: false, reason, claim: current });
  if (!commands.has(command.action) || command.invalid || !command.actor) return reject('认领命令格式无效');
  if (!['admin', 'maintain', 'write'].includes(permission)) return reject('需要仓库写入权限');
  const maintainer = ['admin', 'maintain'].includes(permission);
  if (command.action === 'claim') {
    if (!metadataValid) return reject('任务元数据待分诊，不能提前认领');
    if (issue.state !== 'open') return reject('任务已关闭');
    if (current) return reject(`任务已由 ${current.owner} / ${current.executor} 认领`);
    if ((issue.assignees || []).some(a => loginKey(a.login) !== loginKey(command.actor))) return reject('任务已有其他负责人；先由负责人交接');
    if (!ready && !(maintainer && typeof command.override === 'string' && command.override.trim())) return reject('前置未验收或任务待分诊；维护者提前启动须给出 override 原因');
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(command.executor || '')) return reject('executor 应为 3～64 位可区分的英文执行者代号');
    if (!new RegExp(`^codex/${issue.number}-[a-z0-9][a-z0-9-]*$`).test(command.branch || '')) return reject('branch 必须使用 codex/Issue编号-描述');
    if (typeof command.scope !== 'string' || !command.scope.trim() || command.scope.length > 500 || /[\r\n]/.test(command.scope)) return reject('scope 需要一行明确交付范围');
    const resources = command.resources || [];
    if (!Array.isArray(resources) || resources.length > 30 || !resources.every(resourceValid)) return reject('独占资源须为仓库相对 file:路径 或 blender:会话代号');
    for (const [number, state] of states) {
      if (!state.claim) continue;
      if (state.claim.branch === command.branch) return reject(`分支已属于 #${number}`);
      if (resources.some(a => state.claim.resources.some(b => resourcesOverlap(a, b)))) return reject(`独占资源被 #${number} 认领`);
    }
    return { accepted: true, reason: '认领成功', claim: {
      id: command.id, owner: command.actor, executor: command.executor, display: command.display || command.executor, branch: command.branch,
      scope: command.scope.trim(), resources: [...new Set(resources)], updated: command.at,
      ...(command.override ? { override: command.override } : {}),
    } };
  }
  if (!current || command.claim !== current.id) return reject('claim 必须等于当前成功认领的命令评论 ID，旧交接不能影响新认领');
  const owns = loginKey(current.owner) === loginKey(command.actor) && current.executor === command.executor;
  if (!owns && !(maintainer && typeof command.reason === 'string' && command.reason.trim())) return reject('仅当前执行者可更新/释放；维护者代办须写 reason');
  if (command.action === 'release') {
    if (typeof command.reason !== 'string' || !command.reason.trim()) return reject('释放前写明任务级下一步或完成范围');
    return { accepted: true, reason: command.reason, claim: null, releasedOwner: current.owner };
  }
  if (command.resources) {
    if (!Array.isArray(command.resources) || command.resources.length > 30 || !command.resources.every(resourceValid)) return reject('独占文件或会话格式无效');
    for (const [number, state] of states) if (number !== issue.number && state.claim
      && command.resources.some(a => state.claim.resources.some(b => resourcesOverlap(a, b)))) return reject(`独占资源被 #${number} 认领`);
  }
  return { accepted: true, reason: '认领已更新', claim: { ...current,
    ...(command.resources ? { resources: [...new Set(command.resources)] } : {}),
    ...(command.display ? { display: command.display } : {}), updated: command.at } };
}

export function receiptBody(command, decision) {
  const claim = decision.claim;
  const payload = JSON.stringify({ commandId: command.id, ...decision }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `${RECEIPT}\n## ${decision.accepted ? '认领记录已确认' : '认领需要协调'}\n\n${decision.reason}`
    + (claim ? `\n\n- **负责人**：@${claim.owner}\n- **执行者**：${claim.display || claim.executor}\n- **认领编号**：${claim.id}\n- **任务分支**：${claim.branch}\n- **交付范围**：${claim.scope}\n- **独占文件或会话**：${claim.resources.map(r => r.replace(/^file:/, '').replace(/^blender:/, 'Blender 会话 ')).join('、') || '无'}` : '\n\n当前没有有效认领。')
    + `\n\n[查看请求](#issuecomment-${command.id})\n\n<!-- riverlight-state:${payload} -->`;
}

// The caller shares a repository-wide concurrency group with full management sync.
// A durable receipt is written BEFORE the Issue projection. Response loss stops
// this run; the next audit re-reads receipts instead of blindly retrying writes.
export async function reconcileClaims(api, repository, issues, isReady) {
  const states = new Map(), pending = [], permissions = new Map();
  for (const issue of issues) {
    const comments = await api.all(`repos/${repository}/issues/${issue.number}/comments`);
    const receipts = readReceipts(comments);
    for (const receipt of receipts) {
      const previous = comments.find(c => c.id === receipt.receiptId);
      if (previous.body.includes('```json')) await api(`repos/${repository}/issues/comments/${receipt.receiptId}`, 'PATCH', {
        body: receiptBody({ id: receipt.commandId }, { accepted: receipt.accepted, reason: receipt.reason, claim: receipt.claim, ...(receipt.releasedOwner ? { releasedOwner: receipt.releasedOwner } : {}) }),
      });
    }
    const processed = new Set(receipts.map(r => r.commandId));
    const last = receipts.filter(r => r.accepted).at(-1);
    states.set(issue.number, { claim: last?.claim || null, releasedOwner: last?.releasedOwner });
    for (const comment of comments) {
      const command = parseCommand(comment);
      if (command && !processed.has(command.id)) pending.push({ issue, command });
    }
  }
  pending.sort((a, b) => a.command.id - b.command.id);
  for (const { issue, command } of pending) {
    if (!permissions.has(command.actor)) {
      const user = await api(`repos/${repository}/collaborators/${encodeURIComponent(command.actor)}/permission`);
      permissions.set(command.actor, user.permission);
    }
    const decision = decideCommand({ command, issue, states, permission: permissions.get(command.actor), ready: isReady(issue), metadataValid: isReady.valid ? isReady.valid(issue) : true });
    await api(`repos/${repository}/issues/${issue.number}/comments`, 'POST', { body: receiptBody(command, decision) });
    if (decision.accepted) states.set(issue.number, { claim: decision.claim, releasedOwner: decision.releasedOwner });
  }
  return states;
}

export function codeReviewState(pr, reviews) {
  if (pr.merged_at) return '已集成';
  if (pr.state === 'closed') return '已关闭未合并';
  if (pr.draft) return '草稿';
  const latest = new Map();
  for (const review of reviews) {
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    latest.set(loginKey(review.user?.login), review);
  }
  if ([...latest.values()].some(r => r.state === 'CHANGES_REQUESTED')) return '需修改';
  if ([...latest.values()].some(r => r.state === 'APPROVED' && r.commit_id === pr.head.sha
    && r.user?.type !== 'Bot' && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(r.author_association)
    && loginKey(r.user?.login) !== loginKey(pr.user?.login))) return '已审查';
  return '待代码审查';
}

export function maintainerReview(pr, comments, reviewers) {
  return comments.some(comment => {
    if (comment.user?.type === 'Bot' || !reviewers.some(user => loginKey(user) === loginKey(comment.user?.login))) return false;
    if (/^#{2,3} 代码审查\s*\n/.test((comment.body || '').trim())) {
      try {
        return commentField(comment.body, '审查版本') === pr.head.sha && commentField(comment.body, '审查结论') === '通过'
          && commentField(comment.body, '审查类型') === '自动审查（共用账号）'
          && (commentField(comment.body, '审查范围') || '').length >= 12;
      } catch { return false; }
    }
    const match = comment.body?.trim().match(/^\/riverlight review\s+(\{[^]*\})$/);
    try {
      const record = JSON.parse(match?.[1]);
      return record.sha === pr.head.sha && record.mode === 'automated' && typeof record.summary === 'string' && record.summary.trim().length >= 12;
    } catch { return false; }
  });
}
