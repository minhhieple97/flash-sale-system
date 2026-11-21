import { assertHealthy, closeClient } from './http-client.mjs';
import { responseChecks, storeChecks } from './invariants.mjs';
import { drain, fire, resetSale } from './load-driver.mjs';
import { latencySummary, printReport } from './report.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { snapshotStores } from './store-snapshot.mjs';

async function runScenario(scenario) {
  const saleId = await resetSale(scenario);
  const result = await fire(scenario);
  const stillPending = await drain(result.reserved);
  const snap = await snapshotStores(saleId);
  const latency = latencySummary(result.latenciesMs);
  const checks = [
    ...responseChecks(scenario, result),
    ...storeChecks({ scenario, result, stillPending, snap }),
  ];
  printReport({ scenario, result, latency, checks });
  return checks.filter((c) => !c.ok).map((c) => `${scenario.name}: ${c.label}`);
}

async function main() {
  await assertHealthy();
  const failed = [];
  for (const scenario of Object.values(SCENARIOS)) {
    failed.push(...(await runScenario(scenario)));
  }
  if (failed.length === 0) {
    console.log('\nSTRESS OK');
    return;
  }
  console.log(`\nSTRESS FAILED: ${failed.join(', ')}`);
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`STRESS FAILED: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeClient);
