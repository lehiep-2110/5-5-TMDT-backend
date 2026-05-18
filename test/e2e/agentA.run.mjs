// Entry point: runs all 4 spec files serially against the live BE on :8001.
// Writes agentA-report.md with per-test status & duration.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { run } from './helpers.mjs';
import authTests from './agentA-auth.spec.mjs';
import usersTests from './agentA-users.spec.mjs';
import catalogTests from './agentA-catalog.spec.mjs';
import inventoryTests from './agentA-inventory.spec.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['agentA-auth (UC-01, UC-02)', authTests],
  ['agentA-users (UC-08, UC-11, UC-15)', usersTests],
  ['agentA-catalog (UC-03, UC-12, UC-13)', catalogTests],
  ['agentA-inventory (UC-19)', inventoryTests],
];

async function main() {
  const startedAt = new Date();
  const allResults = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [suiteName, tests] of SUITES) {
    const summary = await run(suiteName, tests);
    totalPassed += summary.passed;
    totalFailed += summary.failed;
    allResults.push(summary);
  }

  const finishedAt = new Date();
  const elapsedMs = finishedAt - startedAt;

  // Print the overall summary.
  console.log('\n=========================================');
  console.log(
    `TOTAL  ${totalPassed} passed, ${totalFailed} failed (in ${elapsedMs} ms)`,
  );
  console.log('=========================================\n');

  // Write the markdown report.
  const reportPath = join(__dirname, 'agentA-report.md');
  const lines = [];
  lines.push(`# Agent A E2E Report`);
  lines.push('');
  lines.push(`Run started: ${startedAt.toISOString()}`);
  lines.push(`Run finished: ${finishedAt.toISOString()}`);
  lines.push(`Duration: ${elapsedMs} ms`);
  lines.push(`Result: ${totalPassed} passed / ${totalFailed} failed`);
  lines.push('');
  lines.push(`| Test | Status | Duration (ms) |`);
  lines.push(`| --- | --- | --- |`);
  for (const summary of allResults) {
    for (const r of summary.results) {
      const name = `${summary.suite} :: ${r.name}`.replace(/\|/g, '\\|');
      lines.push(`| ${name} | ${r.status} | ${r.ms} |`);
    }
  }
  // Append failure reasons.
  const failures = allResults.flatMap((s) =>
    s.results.filter((r) => r.status === 'fail'),
  );
  if (failures.length > 0) {
    lines.push('');
    lines.push('## Failures');
    for (const f of failures) {
      lines.push('');
      lines.push(`### ${f.suite} :: ${f.name}`);
      lines.push('```');
      lines.push(String(f.reason || ''));
      lines.push('```');
    }
  }
  await writeFile(reportPath, lines.join('\n'), 'utf8');
  console.log(`Report: ${reportPath}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('agentA.run.mjs fatal:', err);
  process.exit(2);
});
