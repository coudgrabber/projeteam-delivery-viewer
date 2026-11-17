import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeployGate } from '../scripts/check-deploy-gate.mjs';
import { githubGet, githubList } from '../scripts/github-governance.mjs';
const sha = 'a'.repeat(40), head = 'b'.repeat(40), repo = 'coudgrabber/projeteam-delivery-viewer';
const context = { RELEASE_SHA: sha, GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: repo, GH_TOKEN: 'runtime-read-token', GOVERNANCE_READ_TOKEN: 'administration-read-token' };
function fixture() {
  return {
    branch: { protected: true, commit: { sha } },
    protection: { enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_last_push_approval: true, require_code_owner_reviews: true, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } }, required_status_checks: { strict: true, checks: [{ context: 'secure-delivery-verify', app_id: 15368 }] } },
    environment: { can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{}] }], deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } },
    policies: { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] },
    prs: [{ number: 1, merged_at: '2026-11-17T00:00:00Z', draft: false, merge_commit_sha: sha, base: { ref: 'main', repo: { full_name: repo } }, head: { sha: head }, user: { id: 1 } }],
    reviews: [{ id: 10, submitted_at: '2026-11-16T23:00:00Z', state: 'APPROVED', commit_id: head, user: { id: 2, login: 'reviewer', type: 'User' } }],
    permission: { permission: 'write' }
  };
}
function mock(data, override) {
  let branchCalls = 0;
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname;
    const token = path.endsWith('/protection') ? context.GOVERNANCE_READ_TOKEN : context.GH_TOKEN;
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    const custom = override?.(url, ++branchCalls);
    if (custom) return custom;
    if (path.endsWith('/protection')) return Response.json(data.protection);
    if (path.endsWith('/branches/main')) return Response.json(data.branch);
    if (path.endsWith('/production-delivery')) return Response.json(data.environment);
    if (path.endsWith('/deployment-branch-policies')) return Response.json(data.policies);
    if (path.endsWith('/pulls')) return Response.json(data.prs);
    if (path.endsWith('/reviews')) return Response.json(data.reviews);
    if (path.endsWith('/permission')) return Response.json(data.permission);
    throw Error('Unexpected API path');
  };
}
test('production accepts protected main plus merged current-head human approvals and independent Environment', async () => {
  await checkDeployGate(context, mock(fixture()));
});
for (const [name, patch] of Object.entries({ feature: { GITHUB_REF: 'refs/heads/feature/authenticated-delivery-worker' }, tag: { GITHUB_REF: 'refs/tags/main' }, unprotected: { GITHUB_REF_PROTECTED: 'false' }, push: { GITHUB_EVENT_NAME: 'push' }, wrongRepo: { GITHUB_REPOSITORY: 'other/repo' }, pinOnly: { RELEASE_SHA: head }, noAudit: { GOVERNANCE_READ_TOKEN: '' } })) {
  test(`production rejects ${name} before network`, async () => {
    let calls = 0;
    await assert.rejects(() => checkDeployGate({ ...context, ...patch }, async () => { calls++; }));
    assert.equal(calls, 0);
  });
}
const mutations = {
  movedMain: d => { d.branch.commit.sha = head; },
  unprotectedMain: d => { d.branch.protected = false; },
  adminBypass: d => { d.protection.enforce_admins.enabled = false; },
  forcePush: d => { d.protection.allow_force_pushes.enabled = true; },
  deletion: d => { d.protection.allow_deletions.enabled = true; },
  staleReviewAllowed: d => { d.protection.required_pull_request_reviews.dismiss_stale_reviews = false; },
  lastPushUnreviewed: d => { d.protection.required_pull_request_reviews.require_last_push_approval = false; },
  codeOwnerMissing: d => { d.protection.required_pull_request_reviews.require_code_owner_reviews = false; },
  reviewBypass: d => { d.protection.required_pull_request_reviews.bypass_pull_request_allowances.apps = [{}]; },
  missingCI: d => { d.protection.required_status_checks.checks = []; },
  spoofedCI: d => { d.protection.required_status_checks.checks[0].app_id = 1; },
  selfDeploymentApproval: d => { d.environment.protection_rules[0].prevent_self_review = false; },
  environmentBypass: d => { d.environment.can_admins_bypass = true; },
  featureEnvironment: d => { d.policies.branch_policies.push({ name: '*', type: 'branch' }); d.policies.total_count++; },
  tagEnvironment: d => { d.policies.branch_policies[0].type = 'tag'; },
  missingPR: d => { d.prs = []; },
  unmergedPR: d => { d.prs[0].merged_at = null; },
  wrongMergedCommit: d => { d.prs[0].merge_commit_sha = head; },
  wrongBase: d => { d.prs[0].base.ref = 'feature'; },
  draft: d => { d.prs[0].draft = true; },
  missingReviews: d => { d.reviews = []; },
  staleApproval: d => { d.reviews[0].commit_id = 'c'.repeat(40); },
  postMergeApproval: d => { d.reviews[0].submitted_at = '2026-11-18T00:00:00Z'; },
  invalidReviewTime: d => { d.reviews[0].submitted_at = 'invalid'; },
  authorApproval: d => { d.reviews[0].user.id = 1; },
  botApproval: d => { d.reviews[0].user.type = 'Bot'; },
  readOnlyReviewer: d => { d.permission.permission = 'read'; },
  latestRejection: d => { d.reviews.push({ ...d.reviews[0], id: 11, state: 'CHANGES_REQUESTED' }); },
  dismissedApproval: d => { d.reviews.push({ ...d.reviews[0], id: 11, state: 'DISMISSED' }); },
  insufficientCount: d => { d.protection.required_pull_request_reviews.required_approving_review_count = 2; }
};
for (const [name, mutate] of Object.entries(mutations)) test(`fail closed: ${name}`, async () => {
  const data = fixture(); mutate(data);
  await assert.rejects(() => checkDeployGate(context, mock(data)));
});
for (const http of [401, 403, 404, 429, 500]) test(`API ${http} refuses without disclosing upstream body`, async () => {
  await assert.rejects(() => checkDeployGate(context, async () => new Response('sensitive upstream', { status: http })), e => e.status === http && !e.message.includes('sensitive'));
});
test('Environment actions permission failure is not bypassed', async () => {
  await assert.rejects(() => checkDeployGate(context, mock(fixture(), url => url.endsWith('/production-delivery') ? new Response('denied', { status: 403 }) : null)), e => e.status === 403);
});
test('Administration read failure is not bypassed', async () => {
  await assert.rejects(() => checkDeployGate(context, mock(fixture(), url => url.endsWith('/protection') ? new Response('denied', { status: 403 }) : null)), e => e.status === 403);
});
test('main advance during gate check invalidates release', async () => {
  let count = 0;
  await assert.rejects(() => checkDeployGate(context, mock(fixture(), url => url.endsWith('/branches/main') && ++count === 2 ? Response.json({ protected: true, commit: { sha: head } }) : null)));
});
test('paginated review history includes later rejection', async () => {
  const data = fixture();
  await assert.rejects(() => checkDeployGate(context, mock(data, url => url.includes('/reviews?') ? Response.json(url.includes('page=1') ? Array.from({ length: 100 }, (_, i) => ({ ...data.reviews[0], id: i + 1 })) : [{ ...data.reviews[0], id: 101, state: 'CHANGES_REQUESTED' }]) : null)));
});
test('pagination exhaustion and transport errors fail closed', async () => {
  await assert.rejects(() => githubList('/list', 'test', async () => Response.json(Array(100).fill({}))), e => e.code === 'github_pagination_limit');
  await assert.rejects(() => githubGet('/anything', 'test', async () => { throw Error('sensitive transport'); }), e => e.code === 'github_transport_failed');
});

test('live probe uses GET only, fails on missing scopes, and never returns response bodies', async () => {
  const { probeGovernance } = await import('../scripts/probe-governance.mjs');
  const results = await probeGovernance(context, async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.ok(!options.body);
    return new Response('sensitive response body', { status: url.includes('/protection') ? 403 : 401 });
  });
  assert.equal(results.length, 3);
  assert.ok(results.every(r => r.status === 'failed'));
  assert.equal(JSON.stringify(results).includes('sensitive'), false);
  const ok = await probeGovernance(context, mock(fixture()));
  assert.ok(ok.every(r => r.status === 'ok'));
});
