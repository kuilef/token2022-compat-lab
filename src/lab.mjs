import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as legacy from '@solana/spl-token';
import * as tokenKit from '@solana-program/token-2022';
import * as kit from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

export const clients = ['legacy', 'kit'];
export const scenarios = ['existing-ata', 'missing-ata-baseline', 'atomic-workaround', 'wrong-extra-rollback'];
const TOKEN = legacy.TOKEN_2022_PROGRAM_ID;
const HOOK = new PublicKey('TokenHookExampLe8smaVNrxTBezWTRbEwxwb1Zykrb');
const key = label => Keypair.fromSeed(createHash('sha256').update(`LOCAL TEST ONLY: ${label}`).digest());
const payer = key('payer');
const mint = key('mint');
const sender = key('sender');
const recipient = key('recipient');
const wrongRecipient = key('wrong-recipient');
const source = legacy.getAssociatedTokenAddressSync(mint.publicKey, sender.publicKey, false, TOKEN);
const destination = legacy.getAssociatedTokenAddressSync(mint.publicKey, recipient.publicKey, false, TOKEN);
const validation = legacy.getExtraAccountMetaAddress(mint.publicKey, HOOK);
const extra = PublicKey.findProgramAddressSync([recipient.publicKey.toBuffer()], HOOK)[0];
const wrongExtra = PublicKey.findProgramAddressSync([wrongRecipient.publicKey.toBuffer()], HOOK)[0];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = name => readFileSync(fileURLToPath(new URL(`../.tools/fixtures/${name}.so`, import.meta.url)));

async function sendLegacy(svm, instructions, signers = [payer]) {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: await svm.latestBlockhash() });
  tx.add(...instructions);
  tx.sign(...signers);
  return svm.sendTransaction(kit.getTransactionDecoder().decode(tx.serialize()));
}

function mustSucceed(result) {
  if (failed(result)) {
    throw new Error(`Fixture setup failed: ${result.err()}\n${result.meta().logs().join('\n')}`);
  }
}
const failed = result => result instanceof FailedTransactionMetadata || result.failed === true;

function createAta(owner) {
  const ata = legacy.getAssociatedTokenAddressSync(mint.publicKey, owner, false, TOKEN);
  return legacy.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint.publicKey, TOKEN);
}

async function setup(svm, existingAta) {
  const tokenBytes = binary('token2022');
  const hookBytes = binary('hook');
  assert.equal(sha256(tokenBytes), '9bbf90b30e06778ca0feca100b29f0eeb9be576ae024f6323cc207308f51a5d1');
  assert.equal(sha256(hookBytes), 'b82d95a35b0460721c253c39874d3d4932bcb5c75bbb975966025586bab4ced2');
  svm.addProgram(TOKEN.toBase58(), tokenBytes);
  svm.addProgram(HOOK.toBase58(), hookBytes);
  mustSucceed(await svm.airdrop(payer.publicKey.toBase58(), kit.lamports(10_000_000_000n)));
  const size = legacy.getMintLen([legacy.ExtensionType.TransferHook]);
  mustSucceed(await sendLegacy(svm, [
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      space: size, lamports: Number(await svm.minimumBalanceForRentExemption(BigInt(size))), programId: TOKEN }),
    legacy.createInitializeTransferHookInstruction(mint.publicKey, payer.publicKey, HOOK, TOKEN),
    legacy.createInitializeMint2Instruction(mint.publicKey, 2, payer.publicKey, null, TOKEN),
  ], [payer, mint]));

  // Initialize the real hook validation PDA. Packed AccountData seed: destination (2), owner offset (32), length (32).
  const data = Buffer.alloc(12 + 35);
  data.set([43, 34, 13, 49, 167, 88, 235, 235]);
  data.writeUInt32LE(1, 8);
  data[12] = 1;
  data.set([4, 2, 32, 32], 13);
  const initHook = new TransactionInstruction({ programId: HOOK, data, keys: [
    { pubkey: validation, isSigner: false, isWritable: true },
    { pubkey: mint.publicKey, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ] });
  mustSucceed(await sendLegacy(svm, [
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: validation, lamports: 10_000_000 }), initHook,
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: extra, lamports: 1_000_000 }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wrongExtra, lamports: 1_000_000 }),
  ]));
  mustSucceed(await sendLegacy(svm, [createAta(sender.publicKey),
    legacy.createMintToInstruction(mint.publicKey, source, payer.publicKey, 100n, [], TOKEN)]));
  if (existingAta) mustSucceed(await sendLegacy(svm, [createAta(recipient.publicKey)]));
  return svm;
}

async function snapshot(svm) {
  async function account(pubkey, tokenAccount = false) {
    const raw = await svm.getAccount(pubkey.toBase58());
    if (!raw.exists) return null;
    const view = { address: raw.address, owner: raw.programAddress, lamports: raw.lamports.toString(),
      dataHash: sha256(raw.data), dataLength: raw.data.length };
    if (tokenAccount) {
      const decoded = legacy.unpackAccount(pubkey, {
        owner: new PublicKey(raw.programAddress), data: Buffer.from(raw.data),
        lamports: Number(raw.lamports), executable: raw.executable,
      }, TOKEN);
      view.amount = decoded.amount.toString();
      view.tokenOwner = decoded.owner.toBase58();
      view.transferring = legacy.getTransferHookAccount(decoded).transferring;
    }
    return view;
  }
  return { source: await account(source, true), destination: await account(destination, true),
    mint: await account(mint.publicKey), validation: await account(validation), extra: await account(extra), wrongExtra: await account(wrongExtra) };
}

function readAdapters(svm, reads) {
  const connection = new Connection(svm.connection?.rpcEndpoint ?? 'http://127.0.0.1:8899', 'confirmed');
  connection.getAccountInfo = async pubkey => {
    const raw = await svm.getAccount(pubkey.toBase58());
    reads.push({ client: 'legacy', address: pubkey.toBase58(), exists: raw.exists });
    return raw.exists ? { owner: new PublicKey(raw.programAddress), data: Buffer.from(raw.data),
      executable: raw.executable, lamports: Number(raw.lamports), rentEpoch: 0 } : null;
  };
  // Read the live ledger, including real absence. Agave uses its actual Kit RPC below; LiteSVM exposes its native ledger.
  const rpc = { getAccountInfo: (address, config) => ({ send: async () => {
    if (svm.rpc) {
      const response = await svm.rpc.getAccountInfo(address, config).send();
      reads.push({ client: 'kit', address, exists: response.value !== null });
      return response;
    }
    const raw = await svm.getAccount(address);
    reads.push({ client: 'kit', address, exists: raw.exists });
    return { context: { slot: 0n }, value: raw.exists ? {
      data: [Buffer.from(raw.data).toString('base64'), 'base64'], executable: raw.executable,
      owner: raw.programAddress, lamports: raw.lamports, space: BigInt(raw.data.length),
    } : null };
  } }) };
  return { connection, rpc };
}

async function sendKit(svm, instructions, payerSigner) {
  let message = kit.createTransactionMessage({ version: svm.transactionVersion ?? 0 });
  message = kit.setTransactionMessageFeePayerSigner(payerSigner, message);
  message = await svm.setTransactionMessageLifetimeUsingLatestBlockhash(message);
  message = kit.appendTransactionMessageInstructions(instructions, message);
  return svm.sendTransaction(await kit.signTransactionMessageWithSigners(message));
}

export async function runScenario(client, scenario, { runtime = 'litesvm' } = {}) {
  assert.ok(clients.includes(client));
  assert.ok(scenarios.includes(scenario));
  assert.ok(['litesvm', 'agave'].includes(runtime));
  const svm = runtime === 'agave' ? await (await import('./agave-runtime.mjs')).startAgave(payer.publicKey.toBase58()) : new LiteSVM();
  try { return await runInRuntime(client, scenario, svm); }
  finally { if (svm.close) await svm.close(); }
}

async function runInRuntime(client, scenario, svm) {
  await setup(svm, scenario === 'existing-ata');
  const before = await snapshot(svm);
  const reads = [];
  const { connection, rpc } = readAdapters(svm, reads);
  const payerSigner = await kit.createKeyPairSignerFromBytes(payer.secretKey);
  const senderSigner = await kit.createKeyPairSignerFromBytes(sender.secretKey);
  // Assemble the idempotent ATA creation before the asynchronous standard transfer builder.
  // Baseline fails on transfer resolution while this first instruction is already ready.
  const ata = scenario === 'existing-ata' ? null : client === 'legacy' ? createAta(recipient.publicKey)
    : tokenKit.getCreateAssociatedTokenIdempotentInstruction({ payer: payerSigner, ata: destination.toBase58(),
      owner: recipient.publicKey.toBase58(), mint: mint.publicKey.toBase58(), tokenProgram: TOKEN.toBase58() });
  const input = { source: source.toBase58(), mint: mint.publicKey.toBase58(), destination: destination.toBase58(),
    authority: senderSigner, amount: 40n, decimals: 2 };
  const preResolved = scenario === 'atomic-workaround' || scenario === 'wrong-extra-rollback';
  const chosenExtra = scenario === 'wrong-extra-rollback' ? wrongExtra : extra;
  let transfer;
  let error = null;
  let runtimeResult = null;
  let transactionSubmitted = false;
  let outcome;
  try {
    if (client === 'legacy') {
      transfer = preResolved ? legacy.createTransferCheckedInstruction(source, mint.publicKey, destination, sender.publicKey, 40n, 2, [], TOKEN)
        : await legacy.createTransferCheckedWithTransferHookInstruction(connection, source, mint.publicKey, destination, sender.publicKey, 40n, 2, [], 'confirmed', TOKEN);
      if (preResolved) transfer.keys.push(...[chosenExtra, HOOK, validation].map(pubkey => ({ pubkey, isSigner: false, isWritable: false })));
    } else {
      transfer = preResolved ? tokenKit.getTransferCheckedInstruction(input)
        : await tokenKit.getTransferCheckedWithTransferHookInstructionAsync({ rpc }, input);
      if (preResolved) transfer = { ...transfer, accounts: [...transfer.accounts,
        ...[chosenExtra, HOOK, validation].map(pubkey => ({ address: pubkey.toBase58(), role: kit.AccountRole.READONLY }))] };
    }
    const instructions = [];
    if (ata) instructions.push(ata);
    instructions.push(transfer);
    transactionSubmitted = true;
    runtimeResult = client === 'legacy' ? await sendLegacy(svm, instructions, [payer, sender])
      : await sendKit(svm, instructions, payerSigner);
    outcome = failed(runtimeResult) ? 'runtime_rejection' : 'success';
    if (outcome === 'runtime_rejection') error = { name: 'TransactionError', message: String(runtimeResult.err()) };
  } catch (caught) {
    outcome = transactionSubmitted ? 'harness_error' : 'resolver_failure';
    error = { name: caught.name, message: caught.message || caught.name };
  }
  const logs = runtimeResult ? (failed(runtimeResult) ? runtimeResult.meta() : runtimeResult).logs() : [];
  const after = await snapshot(svm);
  return { ...(svm.version ? { validator: svm.version, loadedProgramHashes: svm.loadedProgramHashes,
    executedTransactionSignature: runtimeResult?.signature || null, rpcTransactionError: runtimeResult?.rpcError || null } : {}),
    client, scenario, outcome, expected: scenario === 'missing-ata-baseline' ? 'resolver_failure'
    : scenario === 'wrong-extra-rollback' ? 'runtime_rejection' : 'success',
    before, after, error, reads, logs, transactionSubmitted, ataInstructionPrepared: Boolean(ata),
    resolvedExtraAccount: transfer ? (client === 'legacy' ? transfer.keys[4].pubkey.toBase58() : transfer.accounts[4].address) : null,
    hookCpiObserved: logs.some(line => line === `Program ${HOOK.toBase58()} invoke [2]`),
    ataCreationObserved: logs.some(line => line.includes('Instruction: InitializeAccount3')),
    rollbackVerified: outcome === 'runtime_rejection' && JSON.stringify(before) === JSON.stringify(after) };
}
