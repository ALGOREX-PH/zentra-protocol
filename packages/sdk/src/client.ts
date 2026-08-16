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
import { proofToBytes, type Groth16Proof } from "@zentra/serialization";
import { contractInvokeError, RpcTimeoutError } from "./errors";
import type { Policy } from "./policy";

export { proofToBytes } from "@zentra/serialization";

export const TESTNET = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Race `p` against a deadline; the timer is always cleared so finished CLIs exit promptly. */
async function raced<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer = setTimeout(() => rej(new RpcTimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AuthorityState {
  epochId: bigint;
  spentInEpoch: bigint;
  actionCount: bigint;
}

export interface ConfirmedTx {
  hash: string;
}

/**
 * Exactly the fields `authorizeAction` submits on-chain — no fabricated
 * placeholders required. A full `ProveResult` satisfies this structurally.
 */
export interface SubmitParams {
  proof: Groth16Proof;
  recipient: string;
  amount: bigint;
  invoiceHashBytes: Uint8Array;
  nullifierBytes: Uint8Array;
  prevEpochId: bigint;
  prevSpent: bigint;
  prevActionCount: bigint;
}

/** Best-effort human-readable detail from a Soroban XDR-ish value. */
function xdrDetail(value: unknown): string {
  const v = value as { toXDR?: (format: string) => string } | undefined;
  if (v && typeof v.toXDR === "function") {
    try {
      return v.toXDR("base64");
    } catch {
      // fall through
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    const account = await raced(this.server.getAccount(source.publicKey()), 25000, "getAccount");
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();

    const sim = await raced(this.server.simulateTransaction(tx), 25000, "simulate");
    if (rpc.Api.isSimulationError(sim)) throw contractInvokeError("simulate", sim.error);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(source);

    const sent = await raced(this.server.sendTransaction(prepared), 25000, "send");
    if (sent.status === "ERROR") {
      throw contractInvokeError("send", xdrDetail(sent.errorResult));
    }
    let got = await raced(this.server.getTransaction(sent.hash), 15000, "getTransaction");
    for (let tries = 0; got.status === rpc.Api.GetTransactionStatus.NOT_FOUND; tries++) {
      if (tries >= 20) {
        throw contractInvokeError(
          "confirm",
          `tx ${sent.hash} not confirmed (NOT_FOUND after ${tries} polls) — check the transaction on the network explorer`,
        );
      }
      await sleep(1500);
      got = await raced(this.server.getTransaction(sent.hash), 15000, "getTransaction");
    }
    if (got.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw contractInvokeError(
        "confirm",
        `tx ${sent.hash} failed on-chain: ${xdrDetail((got as { resultXdr?: unknown }).resultXdr ?? got.status)}`,
      );
    }
    return { hash: sent.hash };
  }

  /** Read-only simulation; returns the decoded return value. */
  private async simRead(op: xdr.Operation, sourcePub: string): Promise<any> {
    const account = await raced(this.server.getAccount(sourcePub), 25000, "getAccount");
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(60)
      .build();
    const sim = await raced(this.server.simulateTransaction(tx), 25000, "simulate");
    if (rpc.Api.isSimulationError(sim)) throw contractInvokeError("simulate", sim.error);
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
    params: SubmitParams,
    asset: string,
  ): Promise<ConfirmedTx> {
    const op = this.contract().call(
      "authorize_action",
      Address.fromString(agent.publicKey()).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(policy.commitmentBytes)),
      xdr.ScVal.scvBytes(Buffer.from(proofToBytes(params.proof))),
      Address.fromString(params.recipient).toScVal(),
      nativeToScVal(params.amount, { type: "i128" }),
      Address.fromString(asset).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(params.invoiceHashBytes)),
      xdr.ScVal.scvBytes(Buffer.from(params.nullifierBytes)),
      nativeToScVal(params.prevEpochId, { type: "u64" }),
      nativeToScVal(params.prevSpent, { type: "i128" }),
      nativeToScVal(params.prevActionCount, { type: "u64" }),
    );
    return this.invoke(agent, op);
  }
}
