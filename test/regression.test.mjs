import { test } from 'node:test';
import { assertResult } from '../src/assert-result.mjs';
import { clients, runScenario, scenarios } from '../src/lab.mjs';

for (const client of clients) {
  for (const scenario of scenarios) {
    test(`${client}: ${scenario}`, async () => assertResult(await runScenario(client, scenario)));
  }
}
