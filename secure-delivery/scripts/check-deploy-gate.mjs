import { pathToFileURL } from 'node:url';
import { requirePolicy, githubGet, githubList, checkEnvironment, checkMainProtection } from './github-governance.mjs';
const REPO = 'coudgrabber/projeteam-delivery-viewer';
export async function checkDeployGate(context, fetcher = fetch) {
  requirePolicy(context.GITHUB_EVENT_NAME === 'workflow_dispatch' && context.GITHUB_REF === 'refs/heads/main' &&
    context.GITHUB_REF_PROTECTED === 'true' && context.GITHUB_REPOSITORY === REPO, 'production_main_only');
  // Revision pinning only; this equality is deliberately NOT treated as review evidence.
  requirePolicy(/^[a-f0-9]{40}$/.test(context.RELEASE_SHA || '') && context.RELEASE_SHA === context.GITHUB_SHA, 'release_revision_mismatch');
  requirePolicy(Boolean(context.GOVERNANCE_READ_TOKEN), 'administration_read_credentials_missing');
  const root = '/repos/' + REPO;
  const branch = await githubGet(root + '/branches/main', context.GH_TOKEN, fetcher);
  requirePolicy(branch.protected === true && branch.commit?.sha === context.GITHUB_SHA, 'main_moved_or_unprotected');
  const required = await checkMainProtection(context.GOVERNANCE_READ_TOKEN, fetcher);
  await checkEnvironment(context.GH_TOKEN, fetcher);
  const prs = await githubList(root + '/commits/' + context.GITHUB_SHA + '/pulls', context.GH_TOKEN, fetcher);
  const candidates = prs.filter(p => p.merged_at && !p.draft && p.base?.ref === 'main' &&
    p.base.repo?.full_name === REPO && p.merge_commit_sha === context.GITHUB_SHA);
  requirePolicy(candidates.length === 1, 'merged_reviewed_pr_required');
  const pr = candidates[0];
  requirePolicy(Number.isInteger(pr.number) && /^[a-f0-9]{40}$/.test(pr.head?.sha || '') && Number.isInteger(pr.user?.id), 'pr_evidence_invalid');
  requirePolicy(Number.isFinite(Date.parse(pr.merged_at)), 'pr_merge_time_invalid');
  const reviews = await githubList(`${root}/pulls/${pr.number}/reviews`, context.GH_TOKEN, fetcher);
  const latest = new Map();
  for (const review of reviews) {
    if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) continue;
    requirePolicy(Number.isInteger(review.id) && Number.isInteger(review.user?.id), 'review_evidence_invalid');
    if (!latest.has(review.user.id) || latest.get(review.user.id).id < review.id) latest.set(review.user.id, review);
  }
  requirePolicy(![...latest.values()].some(r => r.state === 'CHANGES_REQUESTED'), 'changes_requested');
  let approvals = 0;
  for (const review of latest.values()) {
    if (review.state !== 'APPROVED' || review.commit_id !== pr.head.sha || review.user.id === pr.user.id || review.user.type !== 'User' ||
        !Number.isFinite(Date.parse(review.submitted_at)) || Date.parse(review.submitted_at) > Date.parse(pr.merged_at)) continue;
    requirePolicy(/^[a-zA-Z0-9-]+$/.test(review.user.login || ''), 'review_identity_invalid');
    const permission = await githubGet(`${root}/collaborators/${review.user.login}/permission`, context.GH_TOKEN, fetcher);
    if (['write', 'maintain', 'admin'].includes(permission.permission)) approvals++;
  }
  requirePolicy(approvals >= required, 'current_head_approvals_missing');
  // Refuse an old run after Environment approval if main has advanced.
  const finalBranch = await githubGet(root + '/branches/main', context.GH_TOKEN, fetcher);
  requirePolicy(finalBranch.protected === true && finalBranch.commit?.sha === context.GITHUB_SHA, 'main_moved_or_unprotected');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkDeployGate(process.env);
    console.log('Protected main, merged PR approvals and independent Environment gate verified');
  } catch (error) {
    console.error(JSON.stringify({ status: 'refused', reason: error.code || 'governance_verification_failed', ...(error.status ? { http: error.status } : {}) }));
    process.exitCode = 1;
  }
}
