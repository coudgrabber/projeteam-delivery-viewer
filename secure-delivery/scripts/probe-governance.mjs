// GET-only live probe; no Environment job, deployment, repository mutation or response-body logging.
import { pathToFileURL } from 'node:url';
import { githubGet, checkEnvironment, checkMainProtection } from './github-governance.mjs';
export async function probeGovernance(env, fetcher = fetch) {
  const results = [];
  async function probe(check, fn) {
    try { results.push({ check, status: 'ok', ...await fn() }); }
    catch (error) { results.push({ check, status: 'failed', reason: error.code || 'probe_failed', ...(error.status ? { http: error.status } : {}) }); }
  }
  const repo = '/repos/coudgrabber/projeteam-delivery-viewer';
  await probe('environment_api_actions_read', async () => {
    await githubGet(repo + '/environments/production-delivery', env.GH_TOKEN, fetcher);
    return { http: 200 };
  });
  await probe('environment_approval_and_main_policy', async () => { await checkEnvironment(env.GH_TOKEN, fetcher); return {}; });
  await probe('main_protection_administration_read', async () => { await checkMainProtection(env.GOVERNANCE_READ_TOKEN, fetcher); return {}; });
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await probeGovernance(process.env);
  for (const result of results) console.log(JSON.stringify(result));
  process.exitCode = results.some(r => r.status !== 'ok') ? 1 : 0;
}
