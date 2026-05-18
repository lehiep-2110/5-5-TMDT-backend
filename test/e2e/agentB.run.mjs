// Agent B entrypoint — runs all UC suites serially against a live BE on :8001.
//
//   node test/e2e/agentB.run.mjs
//
// Exits 0 on full pass, 1 otherwise. Writes report to agentB-report.md.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { cartSuite } from './agentB-cart.spec.mjs';
import { ordersCodSuite } from './agentB-orders-cod.spec.mjs';
import { ordersVnpaySuite } from './agentB-orders-vnpay.spec.mjs';
import { vouchersSuite } from './agentB-vouchers.spec.mjs';
import { staffSuite } from './agentB-staff.spec.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const t0 = Date.now();
  const summaries = [];

  // Run each suite, but never throw — collect results and continue.
  const safe = async (label, fn) => {
    try {
      const s = await fn();
      summaries.push(s);
    } catch (err) {
      console.error(`Suite ${label} crashed: ${err && err.message}`);
      summaries.push({
        suite: label,
        passed: 0,
        failed: 1,
        total: 1,
        results: [
          {
            suite: label,
            name: '<suite-load>',
            status: 'fail',
            ms: 0,
            reason: err?.message ?? String(err),
          },
        ],
      });
    }
  };

  await safe('UC-04 Cart', cartSuite);
  await safe('UC-05 COD + UC-06 + UC-14', ordersCodSuite);
  await safe('UC-05 VNPAY', ordersVnpaySuite);
  await safe('UC-16 Vouchers', vouchersSuite);
  await safe('UC-20 + UC-21 Staff', staffSuite);

  const totalPassed = summaries.reduce((a, s) => a + s.passed, 0);
  const totalFailed = summaries.reduce((a, s) => a + s.failed, 0);
  const totalTests = summaries.reduce((a, s) => a + s.total, 0);
  const ms = Date.now() - t0;

  console.log('\n=========================================');
  console.log(
    `SUMMARY: ${totalPassed}/${totalTests} passed, ${totalFailed} failed in ${ms} ms`,
  );
  for (const s of summaries) {
    console.log(`  ${s.suite}: ${s.passed}/${s.total} pass`);
  }
  console.log('=========================================');

  // Write Markdown report.
  const lines = [];
  lines.push(`# Agent B E2E Report`);
  lines.push('');
  lines.push(
    `Total: **${totalPassed}/${totalTests} passed**, **${totalFailed} failed** in ${ms} ms.`,
  );
  lines.push('');
  lines.push(`| Suite | Test | Status | Duration (ms) | Reason |`);
  lines.push(`|-------|------|--------|---------------|--------|`);
  for (const s of summaries) {
    for (const r of s.results) {
      const reason = (r.reason ?? '').replace(/\|/g, '\\|').slice(0, 200);
      lines.push(
        `| ${s.suite} | ${r.name} | ${r.status.toUpperCase()} | ${r.ms} | ${reason} |`,
      );
    }
  }
  const reportPath = resolve(__dirname, 'agentB-report.md');
  await writeFile(reportPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Report written: ${reportPath}`);

  process.exit(totalFailed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
