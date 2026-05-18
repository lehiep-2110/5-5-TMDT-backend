// Agent C entrypoint — runs all UC-07/09/10/17/18 specs sequentially.
// Talks to the live backend at http://localhost:8001/api.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { run } from './helpers-c.mjs';

import reviewsTests from './agentC-reviews.spec.mjs';
import wishlistTests from './agentC-wishlist.spec.mjs';
import notificationsTests from './agentC-notifications.spec.mjs';
import reportsTests from './agentC-reports.spec.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const overallStart = Date.now();
  const summaries = [];
  summaries.push(await run('UC-07 Reviews', reviewsTests));
  summaries.push(await run('UC-09 Wishlist', wishlistTests));
  summaries.push(await run('UC-10/UC-18 Notifications', notificationsTests));
  summaries.push(await run('UC-17 Reports', reportsTests));

  const totalPass = summaries.reduce((a, s) => a + s.passed, 0);
  const totalFail = summaries.reduce((a, s) => a + s.failed, 0);
  const totalAll = summaries.reduce((a, s) => a + s.total, 0);
  const elapsed = Date.now() - overallStart;

  console.log('\n=== Agent C Summary ===');
  for (const s of summaries) {
    console.log(`  ${s.suite}: ${s.passed}/${s.total} passed (${s.failed} failed)`);
  }
  console.log(`  TOTAL: ${totalPass}/${totalAll} passed (${totalFail} failed) in ${elapsed} ms`);

  // Write report
  const lines = [];
  lines.push('# Agent C E2E Report');
  lines.push('');
  lines.push(`Run timestamp: ${new Date().toISOString()}`);
  lines.push(`Total: ${totalPass}/${totalAll} passed (${totalFail} failed) in ${elapsed} ms`);
  lines.push('');
  lines.push('| Suite | Test | Status | Duration (ms) |');
  lines.push('|---|---|---|---|');
  for (const s of summaries) {
    for (const r of s.results) {
      const reason = r.reason ? ` (${r.reason.replace(/\|/g, '/').slice(0, 200)})` : '';
      lines.push(`| ${s.suite} | ${r.name}${reason} | ${r.status.toUpperCase()} | ${r.ms} |`);
    }
  }
  lines.push('');
  await writeFile(join(__dirname, 'agentC-report.md'), lines.join('\n'), 'utf8');

  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Agent C runner crashed:', err);
  process.exit(1);
});
