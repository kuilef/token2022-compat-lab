import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { clients, runScenario, scenarios } from './lab.mjs';

const results = [];
for (const client of clients) {
  for (const scenario of scenarios) {
    const result = await runScenario(client, scenario);
    results.push(result);
    console.log(`${client} ${scenario}: ${result.outcome} (expected ${result.expected})`);
  }
}
const comparisons = scenarios.map(scenario => {
  const [legacy, kit] = results.filter(result => result.scenario === scenario);
  return { scenario, initialStatesEqual: JSON.stringify(legacy.before) === JSON.stringify(kit.before),
    finalStatesEqual: JSON.stringify(legacy.after) === JSON.stringify(kit.after), outcomesEqual: legacy.outcome === kit.outcome,
    errorSemanticsEqual: legacy.outcome === 'resolver_failure'
      ? legacy.reads.some(read => !read.exists) && kit.reads.some(read => !read.exists)
      : JSON.stringify(legacy.error) === JSON.stringify(kit.error) };
});
const report = { schemaVersion: 1, synthetic: true, cluster: 'local LiteSVM only',
  runtime: { node: process.version, litesvm: '1.5.0', token2022: '11.0.0',
    legacyClient: '@solana/spl-token@0.4.15', kitClient: '@solana-program/token-2022@0.19.0',
    lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex') },
  results, comparisons,
  caveats: ['Baseline failure occurs while building; no transaction reaches the runtime.',
    'Workaround derives the recipient-specific PDA from known owner bytes and appends explicit accounts to released base builders.',
    'Wrong extra account is deliberately synthetic, rejected by runtime; this is not a live vulnerability.',
    'Rollback compares token/mint/validation/extra accounts, including data and rent; payer transaction fees are excluded.',
    'LiteSVM supplies its built-in pinned associated-token program; no external RPC is used.'] };
writeFileSync('report.json', JSON.stringify(report, null, 2) + '\n');
for (const result of results) assert.equal(result.outcome, result.expected);
for (const comparison of comparisons) {
  assert.equal(comparison.initialStatesEqual, true);
  assert.equal(comparison.finalStatesEqual, true);
  assert.equal(comparison.outcomesEqual, true);
  assert.equal(comparison.errorSemanticsEqual, true);
}
