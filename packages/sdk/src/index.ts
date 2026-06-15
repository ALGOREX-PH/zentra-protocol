import type { Keypair } from "@stellar/stellar-sdk";
import { createPolicy, type Policy, type PolicyConfig } from "./policy";
import { proveAction, type ActionContext, type CircuitArtifacts } from "./prover";
import { StellarClient, TESTNET, type AuthorityState, type ConfirmedTx } from "./client";

export { createPolicy } from "./policy";
export type { Policy, PolicyConfig } from "./policy";
export { proveAction } from "./prover";
export type { ActionContext, ProveResult, CircuitArtifacts } from "./prover";
export { StellarClient, TESTNET } from "./client";
export type { AuthorityState, ConfirmedTx } from "./client";
export * from "./crypto";

/** Lifecycle events the future frontend (or CLI) can render as panel state. */
export type StatusEvent =
  | { phase: "proving"; recipient: string; amount: bigint }
  | { phase: "proof-ready"; nullifier: string }
  | { phase: "submitting" }
  | { phase: "released"; txHash: string }
  | { phase: "blocked"; reason: string };

export interface ZentraConfig {
  contractId: string;
  /** USDC (or other) SAC contract address used for settlement. */
  asset: string;
  circuit: CircuitArtifacts;
  rpcUrl?: string;
  networkPassphrase?: string;
  onStatus?: (e: StatusEvent) => void;
}

export interface PayRequest {
  recipient: string;
  amount: bigint;
  invoicePreimage: bigint;
  /** Replay nonce; defaults to the next action index. */
  nonce?: bigint;
  /** Override the assumed current time (seconds); defaults to local clock. */
  nowSeconds?: number;
}

export interface PayResult {
  txHash: string;
  nullifier: bigint;
}

/** Mirror of the contract's effective_prior (epoch rollover). */
function effectivePrior(state: AuthorityState, epochSeconds: number, nowSeconds: number) {
  const cur = BigInt(Math.floor(nowSeconds / epochSeconds));
  if (cur !== state.epochId) {
    return { epochId: cur, spent: 0n, count: state.actionCount };
  }
  return { epochId: state.epochId, spent: state.spentInEpoch, count: state.actionCount };
}

export class Zentra {
  readonly client: StellarClient;
  private readonly asset: string;
  private readonly circuit: CircuitArtifacts;
  private readonly onStatus: (e: StatusEvent) => void;

  constructor(cfg: ZentraConfig) {
    this.client = new StellarClient(
      cfg.contractId,
      cfg.networkPassphrase ?? TESTNET.networkPassphrase,
      cfg.rpcUrl ?? TESTNET.rpcUrl,
    );
    this.asset = cfg.asset;
    this.circuit = cfg.circuit;
    this.onStatus = cfg.onStatus ?? (() => {});
  }

  createPolicy(config: Omit<PolicyConfig, "asset"> & { asset?: string }): Promise<Policy> {
    return createPolicy({ ...config, asset: config.asset ?? this.asset });
  }

  commitPolicy(agent: Keypair, policy: Policy): Promise<ConfirmedTx> {
    return this.client.registerPolicy(agent, policy);
  }

  readState(agentPub: string, policy: Policy): Promise<AuthorityState> {
    return this.client.readAuthorityState(agentPub, policy.commitmentBytes);
  }

  /**
   * Prove + submit one payment under `policy`. Throws (and emits a `blocked`
   * event) if the recipient is not approved or the contract rejects the action.
   */
  async pay(agent: Keypair, policy: Policy, req: PayRequest): Promise<PayResult> {
    const now = req.nowSeconds ?? Math.floor(Date.now() / 1000);
    const stored = await this.readState(agent.publicKey(), policy);
    const eff = effectivePrior(stored, policy.epochSeconds, now);

    const ctx: ActionContext = {
      agent: agent.publicKey(),
      contractId: this.client.contractId,
      recipient: req.recipient,
      amount: req.amount,
      invoicePreimage: req.invoicePreimage,
      nonce: req.nonce ?? eff.count + 1n,
      prevEpochId: eff.epochId,
      prevSpent: eff.spent,
      prevActionCount: eff.count,
    };

    this.onStatus({ phase: "proving", recipient: req.recipient, amount: req.amount });
    let result;
    try {
      result = await proveAction(policy, ctx, this.circuit);
    } catch (e: any) {
      this.onStatus({ phase: "blocked", reason: e.message });
      throw e;
    }
    this.onStatus({ phase: "proof-ready", nullifier: result.nullifier.toString() });

    this.onStatus({ phase: "submitting" });
    let tx;
    try {
      tx = await this.client.authorizeAction(agent, policy, result, this.asset);
    } catch (e: any) {
      this.onStatus({ phase: "blocked", reason: e.message });
      throw e;
    }
    this.onStatus({ phase: "released", txHash: tx.hash });
    return { txHash: tx.hash, nullifier: result.nullifier };
  }

  /** Wrap an agent so it can only move money through proof-gated `pay`. */
  guard(agent: Keypair, policy: Policy): GuardedAgent {
    return new GuardedAgent(this, agent, policy);
  }
}

export class GuardedAgent {
  constructor(
    private readonly zentra: Zentra,
    private readonly agent: Keypair,
    private readonly policy: Policy,
  ) {}

  pay(req: PayRequest): Promise<PayResult> {
    return this.zentra.pay(this.agent, this.policy, req);
  }
}
