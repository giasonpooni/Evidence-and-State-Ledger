import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePoExceptions } from '../src/domain/caravanDesk';

async function main() {
  const input = process.argv[2] ?? 'examples/caravan-po-exceptions.json';
  const raw = await readFile(resolve(input), 'utf8');
  const request = JSON.parse(raw);
  const result = evaluatePoExceptions(request);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    status: 'refused',
    reason: error instanceof Error ? error.message : String(error),
  }) + '\n');
  process.exitCode = 1;
});
