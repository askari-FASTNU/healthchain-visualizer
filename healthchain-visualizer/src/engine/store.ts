// Application state (zustand). The pipeline writes to it; the UI reads from it.
import { create } from 'zustand';
import { createDemoActors, INITIAL_NODES } from './actors';
import { buildInitialChain, type ChainSnapshot } from './seed';
import { inspectContract, type ContractInfo } from './runtime';
import type { Actor, Block, ContractVersion, HospitalNode, OffChainDoc, Role, TxType, WorldState } from './types';

export type StageId =
  | 'compose' | 'hash' | 'sign' | 'broadcast' | 'verify' | 'mempool'
  | 'execute' | 'block' | 'consensus' | 'append' | 'receipt';

export const STAGES: { id: StageId; title: string; blurb: string }[] = [
  { id: 'compose', title: 'Build the transaction', blurb: 'The app packages the action, its inputs, the sender and a nonce.' },
  { id: 'hash', title: 'Fingerprint it with SHA-256', blurb: 'Any change to the content gives a completely different hash.' },
  { id: 'sign', title: 'Sign with the private key', blurb: 'ECDSA on secp256k1 proves who sent it and that nobody altered it.' },
  { id: 'broadcast', title: 'Broadcast to hospital nodes', blurb: 'The entry node gossips the signed transaction to its peers.' },
  { id: 'verify', title: 'Every node verifies it', blurb: 'Signature, nonce and network membership are checked independently.' },
  { id: 'mempool', title: 'Wait in the mempool', blurb: 'Valid transactions queue up until the next block is built.' },
  { id: 'execute', title: 'Run the smart contract', blurb: 'The contract code decides whether the action is allowed and what changes.' },
  { id: 'block', title: 'Build the block', blurb: 'Transactions are hashed into a Merkle tree and sealed in a block header.' },
  { id: 'consensus', title: 'Reach consensus', blurb: 'The hospitals agree on the block before anyone accepts it.' },
  { id: 'append', title: 'Link it to the chain', blurb: 'The block points to the previous block hash and every node stores it.' },
  { id: 'receipt', title: 'Receipt and final state', blurb: 'The result is final and the hospital app updates.' },
];

export type StageStatus = 'waiting' | 'active' | 'done' | 'failed' | 'skipped';

export interface Stage {
  id: StageId;
  status: StageStatus;
  summary?: string;
  data?: any;
}

export interface Run {
  id: number;
  title: string;
  actorName: string;
  actorRole: Role;
  txType: TxType;
  method?: string;
  startedAt: number;
  stages: Stage[];
  outcome?: { kind: 'committed' | 'reverted' | 'rejected' | 'stalled'; text: string };
  txHash?: string;
  blockNumber?: number;
}

export interface Settings {
  consensus: 'pbft' | 'pow';
  difficulty: number;
  speed: number;
  stepMode: boolean;
  traffic: boolean;
}

export type Tab = 'portal' | 'contract' | 'ledger' | 'network' | 'state';

export interface AppState extends ChainSnapshot {
  ready: boolean;
  actors: Actor[];
  nodes: HospitalNode[];
  settings: Settings;
  forgeNext: boolean;
  currentActorId: string;
  tab: Tab;
  selectedBlock: number | null;
  contractInfo: ContractInfo;
  runs: Run[];
  viewRunId: number | null;
  busy: boolean;
  skip: boolean;
  awaitingNext: boolean;
  newestBlock: number | null;
  toast: { text: string; tone: 'info' | 'good' | 'bad' } | null;
  /** Source currently in the editor (not deployed yet). */
  draftSource: string | null;
}

const STORAGE_KEY = 'healthchain-visualizer:v1';

const DEFAULT_SETTINGS: Settings = { consensus: 'pbft', difficulty: 4, speed: 1, stepMode: false, traffic: true };

export const useStore = create<AppState>(() => ({
  ready: false,
  actors: [],
  nodes: INITIAL_NODES.map((n) => ({ ...n })),
  blocks: [],
  world: { storage: {}, contract: { version: 0, codeHash: '', source: '' }, nonces: {} },
  versions: [],
  offchain: {},
  settings: DEFAULT_SETTINGS,
  forgeNext: false,
  currentActorId: 'ayesha',
  tab: 'portal',
  selectedBlock: null,
  contractInfo: { ok: false, methods: [] },
  runs: [],
  viewRunId: null,
  busy: false,
  skip: false,
  awaitingNext: false,
  newestBlock: null,
  toast: null,
  draftSource: null,
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

interface Saved extends ChainSnapshot {
  actors: Actor[];
  nodes: HospitalNode[];
  settings: Settings;
}

export function persist() {
  const s = getState();
  const saved: Saved = { blocks: s.blocks, world: s.world, versions: s.versions, offchain: s.offchain, actors: s.actors, nodes: s.nodes, settings: s.settings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage can be unavailable (private window, file:// restrictions). The app still works in memory.
  }
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!Array.isArray(s.blocks) || !s.blocks.length || !s.world?.storage) return null;
    return s;
  } catch {
    return null;
  }
}

export async function refreshContractInfo() {
  const info = await inspectContract(getState().world.contract.source);
  setState({ contractInfo: info });
}

let initialising: Promise<void> | null = null;

export function initialise(fresh = false): Promise<void> {
  if (initialising && !fresh) return initialising;
  initialising = doInitialise(fresh).finally(() => {
    initialising = null;
  });
  return initialising;
}

async function doInitialise(fresh: boolean) {
  setState({ ready: false });
  const saved = fresh ? null : loadSaved();
  if (saved) {
    setState({ ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings } });
  } else {
    const actors = createDemoActors();
    const nodes = INITIAL_NODES.map((n) => ({ ...n }));
    const snap = await buildInitialChain(actors, nodes);
    for (const n of nodes) n.height = snap.blocks.length;
    setState({ ...snap, actors, nodes, runs: [], viewRunId: null, newestBlock: null, selectedBlock: null, draftSource: null, forgeNext: false });
    persist();
  }
  await refreshContractInfo();
  setState({ ready: true });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info') {
  setState({ toast: { text, tone } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 4200);
}

export function setNodeOnline(id: number, online: boolean) {
  const s = getState();
  const height = s.blocks.length;
  const nodes = s.nodes.map((n) => (n.id === id ? { ...n, online } : n));
  const target = nodes.find((n) => n.id === id)!;
  if (online && target.height < height) {
    const missed = height - target.height;
    target.height = height;
    toast(`${target.short} is back online and downloaded ${missed} missed block${missed === 1 ? '' : 's'} from its peers`, 'good');
  }
  setState({ nodes });
  persist();
}

export function setNodeByzantine(id: number, byzantine: boolean) {
  setState({ nodes: getState().nodes.map((n) => (n.id === id ? { ...n, byzantine } : n)) });
  persist();
}

export function updateSettings(patch: Partial<Settings>) {
  setState({ settings: { ...getState().settings, ...patch } });
  persist();
}

export function actorByAddress(address: string): Actor | undefined {
  return getState().actors.find((a) => a.address === address);
}

export function nameOf(address: string): string {
  const s = getState();
  return s.world.storage.members?.[address]?.name || actorByAddress(address)?.name || address.slice(0, 10) + '…';
}

export function currentRun(): Run | undefined {
  const s = getState();
  return s.runs.find((r) => r.id === s.viewRunId);
}

export function patchRun(id: number, fn: (r: Run) => Run) {
  setState({ runs: getState().runs.map((r) => (r.id === id ? fn(r) : r)) });
}

export function latestBlock(): Block {
  const b = getState().blocks;
  return b[b.length - 1];
}

export type { ContractVersion, OffChainDoc, WorldState };
