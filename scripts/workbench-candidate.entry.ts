/** Fixed stdin/stdout bridge compiled for a source-pinned CIW binding. */
import { executeWorkbenchCandidate } from '../src/data-os/workbench-candidate';

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 16 * 1024 * 1024) throw new Error('REQUEST_SIZE_LIMIT');
    chunks.push(bytes);
  }
  const result = executeWorkbenchCandidate(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(() => {
  // A storage failure can follow a put. Never assert that no bytes were written.
  process.stderr.write('Candidate action failed; no successful retention receipt is available.\n');
  process.exitCode = 1;
});
