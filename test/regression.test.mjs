import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScenario } from '../src/lab.mjs';

for (const client of ['legacy', 'kit']) {
  for (const scenario of ['existing-ata', 'missing-ata-baseline', 'atomic-workaround', 'wrong-extra-rollback']) {
    test(`${client}: ${scenario}`, async () => {
      const result = await runScenario(client, scenario);
      const expected = scenario === 'missing-ata-baseline' ? 'resolver_failure'
        : scenario === 'wrong-extra-rollback' ? 'runtime_rejection' : 'success';
      assert.equal(result.outcome, expected);
      assert.equal(result.before.source.amount, '100');
      if (expected === 'success') {
        assert.equal(result.after.source.amount, '60');
        assert.equal(result.after.destination.amount, '40');
        assert.equal(result.hookCpiObserved, true);
        assert.equal(result.after.source.transferring, false);
        assert.equal(result.after.destination.transferring, false);
      } else {
        assert.deepEqual(result.after, result.before);
        assert.equal(result.after.destination, null);
      }
      if (expected === 'resolver_failure') {
        assert.equal(result.transactionSubmitted, false);
        assert.equal(result.ataInstructionPrepared, true);
        assert.equal(result.reads.some(read => read.address === '2fQ66wnAWvCLpZQy7j715T4jghUVuYA2vfHHUV9jQUTr' && !read.exists), true);
        assert.match(result.error.message, /account.*(not found|was not found)|TokenTransferHookAccountDataNotFound/i);
      }
      if (scenario === 'atomic-workaround') assert.equal(result.ataCreationObserved, true);
      if (expected === 'runtime_rejection') {
        assert.equal(result.transactionSubmitted, true);
        assert.equal(result.ataCreationObserved, true);
        assert.match(result.error.message, /index: 1.*code: 2724315840/);
        const ataSuccess = result.logs.indexOf('Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL success');
        const transfer = result.logs.indexOf('Program log: Instruction: TransferChecked');
        assert.ok(ataSuccess >= 0 && transfer > ataSuccess);
        assert.equal(result.rollbackVerified, true);
      }
    });
  }
}
