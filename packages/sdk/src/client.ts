// Stellar/Soroban plumbing: register policies, read AuthorityState, and submit
// proof-gated payments to the Zentra verifier contract.

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { ProveResult } from "./prover";
import type { Policy } from "./policy";

export const TESTNET = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** decimal string -> 32-byte big-endian (raw, NO field reduction: these are Fp coordinates). */
function be32(dec: string): Buffer {
  let n = BigInt(dec);
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) throw new Error(`coordinate exceeds 32 bytes: ${dec}`);
  return out;
}
const g1 = (p: string[]) => Buffer.concat([be32(p[0]), be32(p[1])]); // 64
const g2 = (p: string[][]) =>
  Buffer.concat([be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0])]); // 128

/** snarkjs proof -> 256-byte blob: a(64) || b(128) || c(64). */
export function proofToBytes(proof: any): Buffer {
  return Buffer.concat([g1(proof.pi_a), g2(proof.pi_b), g1(proof.pi_c)]);
}

export interface AuthorityState {
  epochId: bigint;
  spentInEpoch: bigint;
  actionCount: bigint;
}

export interface ConfirmedTx {
  hash: string;
}

export class StellarClient {
  readonly server: rpc.Server;
  constructor(
    readonly contractId: string,
    readonly networkPassphrase: string = TESTNET.networkPassphrase,
    rpcUrl: string = TESTNET.rpcUrl,
  ) {
    this.server = new rpc.Server(rpcUrl);
  }

  private contract() {
    return new Contract(this.contractId);
  }

  private async invoke(source: Keypair, op: xdr.Operation): Promise<ConfirmedTx> {
    const account = await this.server.getAccount(source.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(source);

    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") {
      throw new Error(`submit failed: ${JSON.stringify(sent.errorResult)}`);
    }
    let got = await this.server.getTransaction(sent.hash);
    for (let tries = 0; got.status === rpc.Api.GetTransactionStatus.NOT_FOUND; tries++) {
      if (tries >= 30) throw new Error(`tx ${sent.hash} not confirmed after 30s (NOT_FOUND)`);
      await sleep(1000);
      got = await this.server.getTransaction(sent.hash);
    }
    if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`tx ${sent.hash} failed: ${JSON.stringify((got as any).resultXdr ?? got.status)}`);
    }
    return { hash: sent.hash };
  }

  /** Read-only simulation; returns the decoded return value. */
  private async simRead(op: xdr.Operation, sourcePub: string): Promise<any> {
    const account = await this.server.getAccount(sourcePub);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
    return scValToNative(sim.result!.retval);
  }

  async registerPolicy(agent: Keypair, policy: Policy): Promise<ConfirmedTx> {
    const op = this.contract().call(
      "register_policy",
      Address.fromString(agent.publicKey()).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(policy.commitmentBytes)),
      xdr.ScVal.scvBytes(Buffer.from(policy.recipientRootBytes)),
      nativeToScVal(BigInt(policy.epochSeconds), { type: "u64" }),
    );
    return this.invoke(agent, op);
  }

  async readAuthorityState(agentPub: string, commitmentBytes: Uint8Array): Promise<AuthorityState> {
    const op = this.contract().call(
      "authority_state",
      Address.fromString(agentPub).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
    );
    const s = await this.simRead(op, agentPub);
    return {
      epochId: BigInt(s.epoch_id),
      spentInEpoch: BigInt(s.spent_in_epoch),
      actionCount: BigInt(s.action_count),
    };
  }

  async revokePolicy(agent: Keypair, commitmentBytes: Uint8Array): Promise<ConfirmedTx> {
    const op = this.contract().call(
      "revoke_policy",
      Address.fromString(agent.publicKey()).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(commitmentBytes)),
    );
    return this.invoke(agent, op);
  }

  /** Submit a proof-gated payment via authorize_action. */
  async authorizeAction(
    agent: Keypair,
    policy: Policy,
    result: ProveResult,
    asset: string,
  ): Promise<ConfirmedTx> {
    const op = this.contract().call(
      "authorize_action",
      Address.fromString(agent.publicKey()).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(policy.commitmentBytes)),
      xdr.ScVal.scvBytes(proofToBytes(result.proof)),
      Address.fromString(result.recipient).toScVal(),
      nativeToScVal(result.amount, { type: "i128" }),
      Address.fromString(asset).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(result.invoiceHashBytes)),
      xdr.ScVal.scvBytes(Buffer.from(result.nullifierBytes)),
      nativeToScVal(result.prevEpochId, { type: "u64" }),
      nativeToScVal(result.prevSpent, { type: "i128" }),
      nativeToScVal(result.prevActionCount, { type: "u64" }),
    );
    return this.invoke(agent, op);
  }
}
