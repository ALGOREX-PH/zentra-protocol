#!/usr/bin/env tsx
// zentra — terminal tooling for ZK-guarded agent payments on Stellar.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createPolicy,
  proveAction,
  StellarClient,
  TESTNET,
  type Policy,
} from "@zentra/sdk";

const CONFIG = "zentra.config.json";
const ok = (m: string) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const head = () => console.log("\n\x1b[1mZentra Protocol\x1b[0m\n");
const die = (m: string) => {
  console.error(`\x1b[31m✗\x1b[0m ${m}`);
  process.exit(1);
};

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p: string, v: unknown) =>
  writeFileSync(p, JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));

function loadConfig() {
  if (!existsSync(CONFIG)) die(`no ${CONFIG} — run "zentra init" first`);
  return readJson(CONFIG);
}
function agentKeypair(): Keypair {
  const s = process.env.ZENTRA_AGENT_SECRET;
  if (!s) die("set ZENTRA_AGENT_SECRET to the agent's S... secret seed");
  return Keypair.fromSecret(s!);
}
// Rebuild the full Policy deterministically from its saved config (salt included).
async function policyFromFile(file: string): Promise<Policy> {
  const p = readJson(file);
  return createPolicy({
    name: p.name,
    asset: p.asset,
    maxAmount: BigInt(p.maxAmount),
    dailyLimit: BigInt(p.dailyLimit),
    approvedRecipients: p.approvedRecipients,
    epochSeconds: p.epochSeconds,
    salt: BigInt(p.salt),
  });
}

const program = new Command();
program.name("zentra").description("ZK policy layer for autonomous AI agents on Stellar");

program
  .command("init")
  .description("scaffold a Zentra project")
  .option("--contract <id>", "deployed verifier contract id (C...)")
  .option("--asset <id>", "settlement asset SAC (C...)")
  .action((opts) => {
    head();
    for (const d of ["policies", "actions", "proofs"]) mkdirSync(resolve(d), { recursive: true });
    if (!existsSync(CONFIG)) {
      writeJson(CONFIG, {
        network: "testnet",
        rpcUrl: TESTNET.rpcUrl,
        networkPassphrase: TESTNET.networkPassphrase,
        contractId: opts.contract ?? "C...",
        asset: opts.asset ?? "C...",
        circuit: {
          wasmPath: "circuits/payment-policy/payment_policy_js/payment_policy.wasm",
          zkeyPath: "circuits/payment-policy/payment_policy.zkey",
        },
      });
      ok(`wrote ${CONFIG}`);
    } else ok(`${CONFIG} already exists`);
    ok("created policies/ actions/ proofs/");
  });

const policy = program.command("policy").description("manage private policies");

policy
  .command("create <name>")
  .requiredOption("--max-amount <n>", "per-invoice cap (base units)")
  .requiredOption("--daily-limit <n>", "per-epoch cap (base units)")
  .requiredOption("--allowlist <file>", "JSON array of approved G... vendors")
  .option("--asset <id>", "override settlement asset SAC")
  .option("--epoch-seconds <n>", "epoch window", "86400")
  .action(async (name, opts) => {
    head();
    const cfg = loadConfig();
    const recipients: string[] = readJson(opts.allowlist);
    const p = await createPolicy({
      name,
      asset: opts.asset ?? cfg.asset,
      maxAmount: BigInt(opts.maxAmount),
      dailyLimit: BigInt(opts.dailyLimit),
      approvedRecipients: recipients,
      epochSeconds: Number(opts.epochSeconds),
    });
    ok("Loaded private policy");
    ok(`Built recipient Merkle root (${recipients.length} vendors)`);
    ok("Created policy commitment");
    const file = resolve("policies", `${name}.json`);
    writeJson(file, {
      name: p.name,
      asset: p.asset,
      maxAmount: p.maxAmount,
      dailyLimit: p.dailyLimit,
      approvedRecipients: p.approvedRecipients,
      epochSeconds: p.epochSeconds,
      salt: p.salt, // SECRET — keep private
      commitment: p.commitment,
    });
    console.log(`\n  policyCommitment: 0x${toHex(p.commitmentBytes)}`);
    console.log(`  recipientRoot:    0x${toHex(p.recipientRootBytes)}`);
    console.log(`  saved → ${file}\n`);
  });

policy
  .command("commit <file>")
  .description("register the policy commitment on-chain")
  .action(async (file) => {
    head();
    const cfg = loadConfig();
    const agent = agentKeypair();
    const p = await policyFromFile(file);
    const client = new StellarClient(cfg.contractId, cfg.networkPassphrase, cfg.rpcUrl);
    const tx = await client.registerPolicy(agent, p);
    ok("Registered policy commitment on Stellar testnet");
    console.log(`  tx: ${tx.hash}\n`);
  });

program
  .command("prove <actionFile>")
  .requiredOption("--policy <file>", "policy file")
  .description("generate a Proof-of-Compliance for an action")
  .action(async (actionFile, opts) => {
    head();
    const cfg = loadConfig();
    const agent = agentKeypair();
    const p = await policyFromFile(opts.policy);
    const a = readJson(actionFile);
    const client = new StellarClient(cfg.contractId, cfg.networkPassphrase, cfg.rpcUrl);

    const stored = await client.readAuthorityState(agent.publicKey(), p.commitmentBytes);
    const now = Math.floor(Date.now() / 1000);
    const cur = BigInt(Math.floor(now / p.epochSeconds));
    const roll = cur !== stored.epochId;
    const prevEpochId = cur;
    const prevSpent = roll ? 0n : stored.spentInEpoch;
    const prevActionCount = stored.actionCount;
    ok("Read authoritative on-chain state");

    const result = await proveAction(
      p,
      {
        agent: agent.publicKey(),
        contractId: cfg.contractId,
        recipient: a.recipient,
        amount: BigInt(a.amount),
        invoicePreimage: BigInt(a.invoicePreimage),
        nonce: BigInt(a.nonce ?? prevActionCount + 1n),
        prevEpochId,
        prevSpent,
        prevActionCount,
      },
      cfg.circuit,
    ).catch((e: any) => die(e.message));
    ok("Built recipient Merkle proof");
    ok("Generated action nullifier");
    ok("Created ZK proof");

    const out = resolve("proofs", "payment-proof.json");
    writeJson(out, {
      policy: opts.policy,
      proof: result!.proof,
      recipient: result!.recipient,
      amount: result!.amount,
      invoiceHash: toHex(result!.invoiceHashBytes),
      nullifier: toHex(result!.nullifierBytes),
      prevEpochId: result!.prevEpochId,
      prevSpent: result!.prevSpent,
      prevActionCount: result!.prevActionCount,
    });
    console.log(`  saved → ${out}\n`);
  });

program
  .command("submit <proofFile>")
  .description("submit a proof to the Soroban verifier and settle if valid")
  .action(async (proofFile) => {
    head();
    const cfg = loadConfig();
    const agent = agentKeypair();
    const pf = readJson(proofFile);
    const p = await policyFromFile(pf.policy);
    const client = new StellarClient(cfg.contractId, cfg.networkPassphrase, cfg.rpcUrl);
    const result = {
      proof: pf.proof,
      publicSignals: [],
      recipient: pf.recipient,
      amount: BigInt(pf.amount),
      nullifier: 0n,
      nullifierBytes: fromHex(pf.nullifier),
      invoiceHashBytes: fromHex(pf.invoiceHash),
      prevEpochId: BigInt(pf.prevEpochId),
      prevSpent: BigInt(pf.prevSpent),
      prevActionCount: BigInt(pf.prevActionCount),
    };
    const tx = await client.authorizeAction(agent, p, result, cfg.asset).catch((e: any) => die(e.message));
    ok("Submitted proof to Stellar testnet");
    ok("Soroban verifier accepted proof");
    ok("Payment released");
    console.log(`  tx: ${(tx as { hash: string }).hash}\n`);
  });

program.parseAsync().catch((e: any) => die(e.message));
