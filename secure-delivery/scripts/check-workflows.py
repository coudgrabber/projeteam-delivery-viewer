"""Static YAML, shell and deployment policy checks. No credentials or network used."""
from pathlib import Path
import subprocess
import json
import yaml

root = Path(__file__).resolve().parents[2]
workflows = root / '.github/workflows'
docs = {}
for path in workflows.glob('*.yml'):
    data = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
    assert isinstance(data, dict) and 'on' in data and 'jobs' in data, path.name
    for job in data['jobs'].values():
        for step in job.get('steps', []):
            if 'run' in step:
                subprocess.run(['bash', '-n'], input=step['run'], text=True, check=True, capture_output=True)
    docs[path.name] = data

assert set(docs) == {'secure-delivery-deploy.yml', 'secure-delivery-test.yml', 'secure-delivery-governance-probe.yml'}
package = json.loads((root / 'secure-delivery/package.json').read_text())
assert package['scripts']['build'] == 'wrangler deploy --dry-run --outdir artifacts/worker'
deploy = docs['secure-delivery-deploy.yml']
assert set(deploy['on']) == {'workflow_dispatch'}
assert set(deploy['on']['workflow_dispatch']['inputs']) == {'release_sha'}
assert deploy['permissions'] == {'contents': 'read', 'actions': 'read', 'pull-requests': 'read'}
for job in deploy['jobs'].values():
    assert job['if'] == "github.ref == 'refs/heads/main' && github.ref_protected"
    steps = job['steps']
    gate = next(i for i, step in enumerate(steps) if step.get('run') == 'node scripts/check-deploy-gate.mjs')
    assert steps[gate]['env']['GH_TOKEN'] == '${{ github.token }}'
    assert steps[gate]['env']['GOVERNANCE_READ_TOKEN'] == '${{ secrets.GOVERNANCE_READ_TOKEN }}'
    for i, step in enumerate(steps):
        if 'CLOUDFLARE_API_TOKEN' in step.get('env', {}):
            assert job.get('environment') == 'production-delivery' and gate < i
assert deploy['jobs']['deploy']['needs'] == 'validate'

test = docs['secure-delivery-test.yml']
assert 'pull_request_target' not in test['on']
assert not test['on']['pull_request'] or 'paths' not in test['on']['pull_request']
assert test['jobs']['verify']['name'] == 'secure-delivery-verify'
for name in ['secure-delivery-test.yml', 'secure-delivery-governance-probe.yml']:
    for job in docs[name]['jobs'].values():
        assert 'environment' not in job
        for step in job['steps']:
            assert not any(k.startswith('CLOUDFLARE_') for k in step.get('env', {}))
            assert 'wrangler deploy' not in step.get('run', '')
probe = docs['secure-delivery-governance-probe.yml']
assert set(probe['on']) == {'workflow_dispatch', 'push'}
assert probe['on']['push']['branches'] == ['feature/authenticated-delivery-worker']
assert set(probe['on']['push']['paths']) == {'.github/workflows/secure-delivery-governance-probe.yml', 'secure-delivery/scripts/probe-governance.mjs', 'secure-delivery/scripts/github-governance.mjs'}
assert probe['permissions']['actions'] == 'read'
print(f'{len(docs)} Actions workflows: YAML, shell syntax and deployment policy checks passed')
