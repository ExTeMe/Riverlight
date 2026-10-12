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
  configureMain({ repository: process.env.GITHUB_REPOSITORY, rulesetId: Number(process.env.RULESET_ID),
    expectedUpdatedAt: process.env.RULESET_EXPECTED_UPDATED_AT, token: process.env.PROJECT_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
