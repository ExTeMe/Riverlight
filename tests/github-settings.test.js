import test from 'node:test';
import assert from 'node:assert/strict';
import { mainRuleset, configureMain } from '../scripts/github-settings.mjs';

const existing = { name: 'main rules', target: 'branch', enforcement: 'disabled', updated_at: 'reviewed',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  bypass_actors: [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }],
  rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['merge', 'squash', 'rebase'] } }] };

test('main requires PR and CI without requiring another reviewer, and dev is never targeted', () => {
  const desired = mainRuleset(existing);
  assert.equal(desired.enforcement, 'active');
  assert.deepEqual(desired.bypass_actors, []);
  assert.equal(desired.rules.find(r => r.type === 'pull_request').parameters.required_approving_review_count, 0);
  assert.deepEqual(desired.rules.find(r => r.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'check', integration_id: 15368 }]);
  assert.throws(() => mainRuleset({ ...existing, conditions: { ref_name: { include: ['refs/heads/dev'], exclude: [] } } }), /exclusively/);
});

test('settings changes reject stale review state before writing and verify actual protection afterward', async () => {
  const calls = [];
  const mock = async (url, options) => {
    calls.push(options.method);
    return { ok: true, status: 200, json: async () => url.endsWith('/branches/main')
      ? { protected: true } : calls.length === 1 ? existing : { ...mainRuleset(existing), _links: { html: { href: 'https://github.com/owner/repo/rules/1' } } } };
  };
  await assert.rejects(configureMain({ repository: 'owner/repo', rulesetId: 1, expectedUpdatedAt: 'old', token: 'test', request: mock }), /changed since review/);
  assert.deepEqual(calls, ['GET']);
  calls.length = 0;
  assert.equal((await configureMain({ repository: 'owner/repo', rulesetId: 1, expectedUpdatedAt: 'reviewed', token: 'test', request: mock })).protected, true);
  assert.deepEqual(calls, ['GET', 'PUT', 'GET', 'GET']);
});
