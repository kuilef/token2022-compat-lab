import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, PublicKey } from '@solana/web3.js';
import * as kit from '@solana/kit';

const url = 'http://127.0.0.1:18899';
const programIds = {
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  hook: 'TokenHookExampLe8smaVNrxTBezWTRbEwxwb1Zykrb',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// A separate, short-lived validator and fresh ledger for every client/scenario.
// No clone flags, remote cluster, installer, service or global CLI config.
export async function startAgave(payerAddress) {
  assert.equal(process.env.TOKEN2022_ISOLATED_NETWORK, '1', 'Use npm run agave: private network namespace is required');
  assert.notEqual(readlinkSync('/proc/self/ns/net'), process.env.TOKEN2022_PARENT_NETWORK_NAMESPACE);
  assert.deepEqual(JSON.parse(execFileSync('ip', ['-j', 'link', 'show'], { encoding: 'utf8' })).map(link => link.ifname), ['lo']);
  assert.deepEqual(JSON.parse(execFileSync('ip', ['-j', 'route', 'show'], { encoding: 'utf8' })), []);
  try {
    await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(1000) });
    throw new Error('Refusing to use an already occupied local RPC port 18899');
  } catch (error) {
    if (error.message.includes('already occupied')) throw error;
  }
  const validator = resolve('.tools/agave/solana-release/bin/solana-test-validator');
  mkdirSync('.cache/agave-runs', { recursive: true });
  const directory = mkdtempSync(resolve('.cache/agave-runs/run-'));
  const config = resolve(directory, 'config.yml');
  writeFileSync(config, `json_rpc_url: ${url}\nwebsocket_url: ws://127.0.0.1:18900\nkeypair_path: ${directory}/unused.json\ncommitment: confirmed\n`);
  const args = ['--config', config, '--ledger', resolve(directory, 'ledger'), '--bind-address', '127.0.0.1',
    '--rpc-port', '18899', '--faucet-port', '18901', '--gossip-port', '18902',
    '--dynamic-port-range', '18903-18930', '--mint', payerAddress, '--quiet',
    ...Object.entries(programIds).flatMap(([name, address]) => ['--upgradeable-program', address, resolve(`.tools/fixtures/${name}.so`), 'none'])];
  const child = spawn(validator, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const connection = new Connection(url, 'confirmed');
  async function close() {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise(done => child.once('exit', done));
      }
    }
    writeFileSync(resolve(directory, 'startup.log'), output);
  }
  try {
    let version;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Validator startup failed: ${spawnError?.message || output}`);
      }
      try {
        version = await connection.getVersion();
        if (await connection.getSlot() >= 2) { ready = true; break; }
      } catch { /* Startup RPC may not be ready yet. */ }
      await delay(500);
    }
    assert.ok(ready, `Validator not ready within 30 seconds. ${output}`);
    assert.equal(version?.['solana-core'], '3.1.8');
    assert.equal(version['feature-set'], 1620780344);
    const loadedProgramHashes = {};
    for (const [name, address] of Object.entries(programIds)) {
      const account = await connection.getAccountInfo(new PublicKey(address));
      assert.ok(account?.executable);
      const elf = readFileSync(resolve(`.tools/fixtures/${name}.so`));
      let loadedElf = account.data;
      if (account.owner.toBase58() === 'BPFLoaderUpgradeab1e11111111111111111111111') {
        assert.equal(account.data.readUInt32LE(0), 2); // UpgradeableLoaderState::Program
        const programData = await connection.getAccountInfo(new PublicKey(account.data.subarray(4, 36)));
        assert.equal(programData.owner.toBase58(), account.owner.toBase58());
        assert.equal(programData.data.readUInt32LE(0), 3); // UpgradeableLoaderState::ProgramData
        loadedElf = programData.data.subarray(45);
      }
      assert.equal(sha256(loadedElf), sha256(elf), `${name}: loaded program differs from pinned ELF`);
      loadedProgramHashes[name] = sha256(loadedElf);
    }
    const rpc = kit.createSolanaRpc(url);
    return {
      connection, rpc, close, directory, version, loadedProgramHashes, transactionVersion: 'legacy',
      addProgram(address, bytes) { assert.equal(loadedProgramHashes[Object.keys(programIds).find(name => programIds[name] === address)], sha256(bytes)); },
      async airdrop() { assert.ok(await connection.getBalance(new PublicKey(payerAddress)) >= 10_000_000_000); return { logs: () => [] }; },
      async minimumBalanceForRentExemption(size) { return BigInt(await connection.getMinimumBalanceForRentExemption(Number(size))); },
      async latestBlockhash() { return (await connection.getLatestBlockhash()).blockhash; },
      async setTransactionMessageLifetimeUsingLatestBlockhash(message) {
        const latest = await connection.getLatestBlockhash();
        return kit.setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash, lastValidBlockHeight: BigInt(latest.lastValidBlockHeight) }, message);
      },
      async getAccount(address) {
        const account = await connection.getAccountInfo(new PublicKey(address));
        return account ? { exists: true, address, programAddress: account.owner.toBase58(), data: account.data,
          executable: account.executable, lamports: BigInt(account.lamports) } : { exists: false };
      },
      async sendTransaction(transaction) {
        const wire = kit.getTransactionEncoder().encode(transaction);
        const signature = await connection.sendRawTransaction(wire, { skipPreflight: true, preflightCommitment: 'confirmed', maxRetries: 3 });
        for (let attempt = 0; attempt < 60; attempt++) {
          const record = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
          if (record) {
            assert.ok(record.meta, 'Missing actual executed transaction metadata');
            const logs = () => record.meta.logMessages || [];
            const failure = record.meta.err;
            return { failed: Boolean(failure), logs, meta: () => ({ logs }), signature, rpcError: failure,
              err: () => failure?.InstructionError
                ? `InstructionError { index: ${failure.InstructionError[0]}, error: Custom { code: ${failure.InstructionError[1].Custom} } }`
                : JSON.stringify(failure) };
          }
          await delay(500);
        }
        const status = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        throw new Error(`Submitted local transaction was not confirmed within 30 seconds: ${signature}; status=${JSON.stringify(status)}; ledger=${directory}`);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
