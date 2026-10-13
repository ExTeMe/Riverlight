import { apiClient } from './github-management.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function mainRuleset(existing) {
  const refs = existing.conditions?.ref_name;
  if (existing.target !== 'branch' || refs?.include?.length !== 1 || refs.include[0] !== 'refs/heads/main' || refs.exclude?.length) {
    throw new Error('Refusing to alter a ruleset that does not exclusively target main.');
  }
  const rules = new Map(existing.rules.map(rule => [rule.type, rule]));
  rules.set('deletion', { type: 'deletion' });
  rules.set('non_fast_forward', { type: 'non_fast_forward' });
  rules.set('pull_request', { type: 'pull_request', parameters: {
    ...rules.get('pull_request')?.parameters,
    required_approving_review_count: 0,
    required_review_thread_resolution: true,
    dismiss_stale_reviews_on_push: true,
    require_last_push_approval: false,
  } });
  rules.set('required_status_checks', { type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true,
    do_not_enforce_on_create: false,
    required_status_checks: [{ context: 'check', integration_id: 15368 }],
  } });
  return { name: existing.name, target: 'branch', enforcement: 'active', conditions: existing.conditions,
    bypass_actors: [], rules: [...rules.values()] };
}

export function devRuleset(existing) {
  if (existing && (existing.target !== 'branch' || existing.conditions?.ref_name?.include?.length !== 1
    || existing.conditions.ref_name.include[0] !== 'refs/heads/dev' || existing.conditions.ref_name.exclude?.length)) {
    throw new Error('Refusing to alter a ruleset that does not exclusively target dev.');
  }
  const main = mainRuleset({ ...(existing || { name: 'dev integration', rules: [] }), target: 'branch', conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } });
  const checks = main.rules.find(r => r.type === 'required_status_checks');
  checks.parameters.required_status_checks.push({ context: 'collaboration', integration_id: 15368 });
  return { ...main, conditions: { ref_name: { include: ['refs/heads/dev'], exclude: [] } } };
}

export async function configureDev({ repository, rulesetId, expectedUpdatedAt, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !expectedUpdatedAt) throw new Error('Repository and reviewed timestamp are required.');
  const api = apiClient(token, request), base = `repos/${repository}`;
  let existing;
  if (rulesetId) {
    existing = await api(`${base}/rulesets/${rulesetId}`);
    if (existing.updated_at !== expectedUpdatedAt) throw new Error('Ruleset changed since review.');
  } else {
    if (expectedUpdatedAt !== 'absent') throw new Error('Creating dev protection requires an explicit absent expectation.');
    const rulesets = await api.all(`${base}/rulesets`);
    for (const ruleset of rulesets) {
      const current = await api(`${base}/rulesets/${ruleset.id}`);
      if (current.conditions?.ref_name?.include?.some(ref => ['refs/heads/dev', '~ALL', '~DEFAULT_BRANCH'].includes(ref))) {
        throw new Error('A potentially overlapping ruleset exists; review its exact ID first.');
      }
    }
  }
  const desired = devRuleset(existing);
  const written = await api(`${base}/rulesets${rulesetId ? `/${rulesetId}` : ''}`, rulesetId ? 'PUT' : 'POST', desired);
  const confirmed = await api(`${base}/rulesets/${written.id}`), branch = await api(`${base}/branches/dev`);
  if (!branch.protected || confirmed.enforcement !== 'active' || confirmed.bypass_actors?.length
    || confirmed.conditions.ref_name.include.join() !== 'refs/heads/dev'
    || !['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'].every(type => confirmed.rules.some(r => r.type === type))
    || !confirmed.rules.find(r => r.type === 'required_status_checks').parameters.strict_required_status_checks_policy
    || !['check', 'collaboration'].every(context => confirmed.rules.find(r => r.type === 'required_status_checks').parameters.required_status_checks.some(c => c.context === context && c.integration_id === 15368))) throw new Error('Dev protection could not be verified.');
  return { protected: branch.protected, url: confirmed._links?.html?.href };
}

// This operation is deliberately separate from ordinary Issue synchronization.
// Call only for an explicitly authorized repository settings change.
export async function configureMain({ repository, rulesetId, expectedUpdatedAt, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !Number.isSafeInteger(rulesetId) || !expectedUpdatedAt) {
    throw new Error('Repository, exact ruleset ID and expected update time are required.');
  }
  const api = apiClient(token, request), endpoint = `repos/${repository}/rulesets/${rulesetId}`;
  const existing = await api(endpoint);
  if (existing.updated_at !== expectedUpdatedAt) throw new Error('Ruleset changed since review; read and review the current settings first.');
  const desired = mainRuleset(existing);
  await api(endpoint, 'PUT', desired);
  const confirmed = await api(endpoint);
  const branch = await api(`repos/${repository}/branches/main`);
  if (confirmed.enforcement !== 'active' || !branch.protected
    || confirmed.bypass_actors?.length
    || !confirmed.rules.some(rule => rule.type === 'required_status_checks' && rule.parameters.required_status_checks.some(check => check.context === 'check'))) {
    throw new Error('Main protection could not be verified as active.');
  }
  return { enforcement: confirmed.enforcement, protected: branch.protected, url: confirmed._links?.html?.href };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Use the explicitly authorized repository settings workflow.');
  (process.env.PROTECTED_BRANCH === 'dev' ? configureDev : configureMain)({ repository: process.env.GITHUB_REPOSITORY, rulesetId: Number(process.env.RULESET_ID),
    expectedUpdatedAt: process.env.RULESET_EXPECTED_UPDATED_AT, token: process.env.PROJECT_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
