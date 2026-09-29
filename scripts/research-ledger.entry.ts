import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeResearchLedger, validateResearchLedger } from '../src/research/researchLedger';

async function main() {
  const input = process.argv[2] ?? 'research/ledger.json';
  const raw = await readFile(resolve(input), 'utf8');
  const value = JSON.parse(raw);
  validateResearchLedger(value);
  process.stdout.write(JSON.stringify(summarizeResearchLedger(value), null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    status: 'refused',
    reason: error instanceof Error ? error.message : String(error),
  }) + '\n');
  process.exitCode = 1;
});
