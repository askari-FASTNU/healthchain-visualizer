// Core data structures shared by the engine and the UI.

export type Role = 'admin' | 'doctor' | 'nurse' | 'patient' | 'lab' | 'pharmacist' | 'insurer';

export const ROLES: Role[] = ['admin', 'doctor', 'nurse', 'patient', 'lab', 'pharmacist', 'insurer'];

/** A participant with a key pair (a wallet). */
export interface Actor {
  id: string;
  name: string;
  role: Role;
  org: string;
  /** Hospital node this participant connects through. */
  nodeId: number;
  privateKey: string; // hex, demo only
  publicKey: string; // hex, uncompressed
  address: string; // 0x + 40 hex
}

/** A validator node run by one hospital. */
export interface HospitalNode {
  id: number;
  name: string;
  short: string;
  online: boolean;
  byzantine: boolean;
  /** Height of this node's copy of the chain. */
  height: number;
}

export type TxType = 'deploy' | 'call' | 'upgrade';

/** Fields covered by the signature. */
export interface UnsignedTx {
  chainId: string;
  type: TxType;
  from: string;
  nonce: number;
  method?: string;
  args?: unknown;
  /** Contract source code for deploy and upgrade transactions. */
  source?: string;
  note?: string;
  timestamp: number;
}

export interface Signature {
  r: string;
  s: string;
  v: number;
}

export interface SignedTx extends UnsignedTx {
  hash: string;
  signature: Signature;
}

export interface ContractEvent {
  name: string;
  data: Record<string, unknown>;
}

export interface TraceLine {
  kind: 'guard' | 'require' | 'emit' | 'info' | 'error' | 'compile' | 'migrate';
  ok: boolean;
  text: string;
  /** Contract source line and code, for require() checks. */
  line?: number;
  code?: string;
}

export interface StateChange {
  path: string;
  op: 'add' | 'remove' | 'change';
  before?: unknown;
  after?: unknown;
}

export interface Receipt {
  txHash: string;
  status: 'success' | 'reverted';
  error?: string;
  gasUsed: number;
  events: ContractEvent[];
  trace: TraceLine[];
  changes: StateChange[];
  contractVersion: number;
}

export interface BlockHeader {
  number: number;
  prevHash: string;
  merkleRoot: string;
  stateRoot: string;
  timestamp: number;
  proposer: number; // node id
  consensus: 'genesis' | 'pbft' | 'pow';
  difficulty: number; // leading hex zeros for PoW, 0 otherwise
  nonce: number;
}

export interface Block {
  header: BlockHeader;
  hash: string;
  txs: SignedTx[];
  receipts: Receipt[];
  /** Signatures of the nodes that committed the block (PBFT). */
  commits: number[];
}

export interface ContractVersion {
  version: number;
  codeHash: string;
  source: string;
  block: number;
  deployedBy: string;
  note?: string;
}

/** Everything every node agrees on after executing all blocks. */
export interface WorldState {
  /** Contract storage (patients, consents, records, policy, members...). */
  storage: Record<string, any>;
  contract: { version: number; codeHash: string; source: string };
  nonces: Record<string, number>;
}

/** Data kept outside the chain. Only its SHA-256 fingerprint is on-chain. */
export interface OffChainDoc {
  ref: string;
  patient: string;
  title: string;
  content: string;
  hash: string;
  author: string;
  /** Kept only while the tamper demo has edited the file. */
  original?: string;
}
