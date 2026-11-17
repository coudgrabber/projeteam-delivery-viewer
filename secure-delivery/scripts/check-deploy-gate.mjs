// Repository settings are checked before any deployment credential is made available.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
export async function checkDeployGate(context, fetcher = fetch) {
  assert.match(context.APPROVED_SHA || '', /^[a-f0-9]{40}$/);
  assert.equal(context.APPROVED_SHA, context.GITHUB_SHA);
  assert.equal(context.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.ok(['refs/heads/feature/authenticated-delivery-worker', 'refs/heads/main'].includes(context.GITHUB_REF));
  assert.equal(context.GITHUB_REPOSITORY, 'coudgrabber/projeteam-delivery-viewer');
  const res = await fetcher(`https://api.github.com/repos/${context.GITHUB_REPOSITORY}/environments/production-delivery`, {
    headers: { Authorization: `Bearer ${context.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.ok(res.ok);
  const env = await res.json();
  const rule = env.protection_rules?.find(r => r.type === 'required_reviewers');
  assert.ok(rule?.reviewers?.length > 0);
  assert.equal(rule.prevent_self_review, true);
  assert.equal(env.can_admins_bypass, false);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkDeployGate(process.env);
    console.log('Reviewed SHA and mandatory production environment gate verified');
  } catch {
    console.error('Deployment refused: exact reviewed SHA or required non-bypassable environment approval gate could not be verified');
    process.exitCode = 1;
  }
}
