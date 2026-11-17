// Read-only GitHub API client. Errors contain fixed labels/statuses, never response bodies.
export class GovernanceError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export function requirePolicy(condition, code) {
  if (!condition) throw new GovernanceError(code);
}
export async function githubGet(path, token, fetcher = fetch) {
  requirePolicy(typeof token === 'string' && token.length > 0, 'read_credentials_missing');
  let res;
  try {
    res = await fetcher('https://api.github.com' + path, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
  } catch { throw new GovernanceError('github_transport_failed'); }
  if (!res.ok) { await res.body?.cancel(); throw new GovernanceError('github_read_denied', res.status); }
  try { return await res.json(); } catch { throw new GovernanceError('github_response_invalid'); }
}
export async function githubList(path, token, fetcher = fetch) {
  const all = [];
  // Bounded pagination; exhaustion fails closed rather than trusting a partial review history.
  for (let page = 1; page <= 10; page++) {
    const batch = await githubGet(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token, fetcher);
    requirePolicy(Array.isArray(batch), 'github_list_invalid');
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new GovernanceError('github_pagination_limit');
}
export async function checkEnvironment(token, fetcher = fetch) {
  const base = '/repos/coudgrabber/projeteam-delivery-viewer/environments/production-delivery';
  const env = await githubGet(base, token, fetcher);
  const rule = env.protection_rules?.find(r => r.type === 'required_reviewers');
  requirePolicy(rule?.reviewers?.length > 0 && rule.prevent_self_review === true && env.can_admins_bypass === false, 'environment_approval_unsafe');
  requirePolicy(env.deployment_branch_policy?.custom_branch_policies === true && env.deployment_branch_policy.protected_branches === false, 'environment_branch_policy_unsafe');
  const policies = await githubGet(base + '/deployment-branch-policies?per_page=100', token, fetcher);
  requirePolicy(policies.total_count === 1 && policies.branch_policies?.length === 1 &&
    policies.branch_policies[0].name === 'main' && policies.branch_policies[0].type === 'branch', 'environment_not_main_only');
}
export async function checkMainProtection(token, fetcher = fetch) {
  const p = await githubGet('/repos/coudgrabber/projeteam-delivery-viewer/branches/main/protection', token, fetcher);
  const r = p.required_pull_request_reviews;
  requirePolicy(p.enforce_admins?.enabled === true && p.allow_force_pushes?.enabled === false && p.allow_deletions?.enabled === false, 'main_protection_unsafe');
  requirePolicy(r?.required_approving_review_count >= 1 && r.dismiss_stale_reviews === true &&
    r.require_last_push_approval === true && r.require_code_owner_reviews === true, 'main_review_policy_unsafe');
  for (const key of ['users', 'teams', 'apps'])
    requirePolicy(!r.bypass_pull_request_allowances?.[key]?.length, 'main_review_bypass');
  requirePolicy(p.required_status_checks?.strict === true &&
    p.required_status_checks.checks?.some(c => c.context === 'secure-delivery-verify' && c.app_id === 15368), 'main_ci_policy_unsafe');
  return r.required_approving_review_count;
}
