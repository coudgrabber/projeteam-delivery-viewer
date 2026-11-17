import { readFileSync } from 'node:fs';
import { parseLedger } from '../worker.mjs';
try {
  if (!process.argv[2]) throw Error();
  const entries = parseLedger(readFileSync(process.argv[2]));
  console.log(JSON.stringify({ status: 'valid', approvals: Object.keys(entries).length }));
} catch {
  console.error('Ledger validation failed');
  process.exitCode = 1;
}
