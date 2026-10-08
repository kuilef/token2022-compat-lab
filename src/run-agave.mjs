import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { assertResult } from './assert-result.mjs';
import { clients, runScenario, scenarios } from './lab.mjs';

const results = [];
for (const client of clients) {
  for (const scenario of scenarios) {
    const result = await runScenario(client, scenario, { runtime: 'agave' });
    results.push(result);
    console.log(`Agave ${client} ${scenario}: ${result.outcome} (expected ${result.expected})`);
    if (result.outcome !== result.expected) console.error(JSON.stringify(result.error));
    assertResult(result);
    if (result.transactionSubmitted) assert.ok(result.executedTransactionSignature);
    if (scenario === 'wrong-extra-rollback') assert.deepEqual(result.rpcTransactionError, { InstructionError: [1, { Custom: 2724315840 }] });
  }
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparisons = scenarios.map(scenario => {
  const [legacy, kit] = results.filter(result => result.scenario === scenario);
  return { scenario, initialStatesEqual: equal(legacy.before, kit.before), finalStatesEqual: equal(legacy.after, kit.after),
    outcomesEqual: legacy.outcome === kit.outcome,
    errorSemanticsEqual: scenario === 'missing-ata-baseline' ? legacy.outcome === 'resolver_failure' && kit.outcome === 'resolver_failure'
      : equal(legacy.rpcTransactionError, kit.rpcTransactionError) };
});
const litesvm = JSON.parse(readFileSync('report.json'));
function sameErrorSemantics(result, baseline) {
  if (result.outcome !== baseline.outcome) return false;
  if (result.outcome === 'success') return result.error === null && baseline.error === null;
  if (result.outcome === 'resolver_failure') {
    return result.error.name === baseline.error.name && [result, baseline].every(item =>
      item.reads.some(read => read.address === '2fQ66wnAWvCLpZQy7j715T4jghUVuYA2vfHHUV9jQUTr' && !read.exists));
  }
  const reference = baseline.error.message.match(/index: (\d+).*code: (\d+)/);
  const observed = result.rpcTransactionError?.InstructionError;
  return Boolean(reference && observed && Number(reference[1]) === observed[0] && Number(reference[2]) === observed[1].Custom);
}
const runtimeComparisons = results.map(result => {
  const baseline = litesvm.results.find(item => item.client === result.client && item.scenario === result.scenario);
  return { client: result.client, scenario: result.scenario, initialStatesEqual: equal(result.before, baseline.before),
    finalStatesEqual: equal(result.after, baseline.after), outcomesEqual: result.outcome === baseline.outcome,
    errorSemanticsEqual: sameErrorSemantics(result, baseline) };
});
const report = { schemaVersion: 1, synthetic: true, cluster: 'loopback-only local Agave, one fresh ledger per run',
  runtime: { node: process.version, agave: '3.1.8', sourceCommit: '2717084afeeb7baad4342468c27f528ef617a3cf',
    isolation: { privateNetworkNamespaceVerified: true, interfaces: ['lo'], externalRoutes: [], hostNetworkChanged: false },
    releaseArchiveSha256: 'e951bb8127c57460bc3ebca1671952e9b164e249d713fcebe2c125f70b8791e8',
    validatorBinarySha256: createHash('sha256').update(readFileSync('.tools/agave/solana-release/bin/solana-test-validator')).digest('hex'),
    featureSet: 1620780344, token2022: '11.0.0',
    transactionFormat: 'legacy messages for both SDKs; Kit builds and signs its own message',
    legacyClient: '@solana/spl-token@0.4.15', kitClient: '@solana-program/token-2022@0.19.0',
    lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex') },
  results, comparisons, runtimeComparisons,
  caveats: ['Only synthetic accounts and loopback RPC; no external cluster or remote account cloning.',
    'Stock Agave RPC/pubsub/faucet bind wildcard addresses; a verified private network namespace containing only lo confines every listener. No host networking settings are modified.',
    'Submitted transactions use skipPreflight=true; outcomes and logs come from confirmed getTransaction metadata.',
    'Failed ATA-create-plus-transfer transaction is actually submitted and its tracked state is compared before/after; payer fees excluded.',
    'Transaction signatures, ledger slots and consumed compute units can vary; semantic assertions determine success.',
    'Initial Kit v0 transport probe timed out without a signature status despite successful diagnostic simulation; cause unresolved. Final Agave scenarios use legacy-format messages; this is not v0 format parity coverage.',
    'Loaded ELF hashes are checked by reading actual validator program/program-data accounts.',
    'Exact hook source-build correspondence remains unverified; see source-verification.json.'] };
writeFileSync('agave-report.json', JSON.stringify(report, null, 2) + '\n');
for (const comparison of [...comparisons, ...runtimeComparisons]) {
  for (const [name, value] of Object.entries(comparison)) {
    if (name.endsWith('Equal')) assert.equal(value, true, JSON.stringify(comparison));
  }
}
