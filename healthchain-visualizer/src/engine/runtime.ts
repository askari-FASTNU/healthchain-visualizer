// Main-thread side of the contract runtime: talks to the sandbox worker, applies results to world state,
// estimates gas and records exactly what changed in storage.
import SandboxWorker from './sandbox.worker?worker&inline';
import { execute as executeInline, inspect as inspectInline, type ExecRequest, type InspectRequest } from './sandbox';
import { canonical, hashValue, sha256Hex } from './crypto';
import type { ContractEvent, Receipt, SignedTx, StateChange, TraceLine, WorldState } from './types';

const TIME_LIMIT_MS = 1500;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: any) => void>();
/** Set when this browser cannot start the worker; contracts then run on the main thread without a time limit. */
let inlineMode = false;

function getWorker(): Worker {
  if (!worker) {
    worker = new SandboxWorker();
    worker.onerror = () => {
      // The worker could not start (some browsers block workers on file:// pages). Run inline instead.
      inlineMode = true;
      worker = null;
      for (const [, cb] of pending) cb({ retryInline: true });
      pending.clear();
    };
    worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data.result);
      }
    };
  }
  return worker;
}

function runInline(req: ExecRequest | InspectRequest): any {
  // Structured clone keeps the same copy semantics as posting to a worker.
  const copy = structuredClone(req);
  return copy.kind === 'execute' ? executeInline(copy) : inspectInline(copy);
}

async function call<T>(req: ExecRequest | InspectRequest): Promise<T | { timeout: true }> {
  if (inlineMode) return runInline(req);
  const r = await callWorker<T>(req);
  if (r && typeof r === 'object' && 'retryInline' in (r as object)) return runInline(req);
  return r as T | { timeout: true };
}

function callWorker<T>(req: ExecRequest | InspectRequest): Promise<T | { timeout: true } | { retryInline: true }> {
  return new Promise((resolve) => {
    const id = ++seq;
    const w = getWorker();
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        w.terminate();
        worker = null;
        // Anything else waiting on the killed worker fails too.
        for (const [, cb] of pending) cb({ timeout: true });
        pending.clear();
        resolve({ timeout: true });
      }
    }, TIME_LIMIT_MS);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage({ id, req });
  });
}

export interface ContractInfo {
  ok: boolean;
  error?: string;
  name?: string;
  methods: { name: string; params: string[] }[];
  defaultPolicy?: { permissions?: Record<string, string[]>; params?: Record<string, unknown> };
}

export async function inspectContract(source: string): Promise<ContractInfo> {
  const r = await call<any>({ kind: 'inspect', source });
  if ('timeout' in r) return { ok: false, error: 'The code took too long to load (endless loop?)', methods: [] };
  if (!r.ok) return { ok: false, error: r.error, methods: [] };
  return { ok: true, name: r.name, methods: r.methods, defaultPolicy: r.defaultPolicy };
}

export function stateRoot(world: WorldState): string {
  return hashValue({ storage: world.storage, contract: { version: world.contract.version, codeHash: world.contract.codeHash }, nonces: world.nonces });
}

export function codeHash(source: string): string {
  return sha256Hex(source);
}

export function callerOf(world: WorldState, address: string) {
  const m = world.storage.members?.[address];
  return m ? { address, name: m.name, role: m.role, org: m.org } : { address, name: 'Unknown', role: 'none', org: '' };
}

export interface ExecResult {
  receipt: Receipt;
  world: WorldState;
}

/** Execute one transaction against a world state. Returns a new world state; the input is not changed. */
export async function executeTx(world: WorldState, tx: SignedTx, block: { number: number; timestamp: number }): Promise<ExecResult> {
  const caller = callerOf(world, tx.from);
  const before = world.storage;
  const source = tx.type === 'call' ? world.contract.source : tx.source || '';
  const r = await call<any>({
    kind: 'execute',
    txType: tx.type,
    source,
    storage: before,
    method: tx.method,
    args: tx.args,
    caller,
    block,
  });

  let status: 'success' | 'reverted';
  let error: string | undefined;
  let after = before;
  let events: ContractEvent[] = [];
  let trace: TraceLine[] = [];
  if ('timeout' in r) {
    status = 'reverted';
    error = `Out of gas: execution passed the ${TIME_LIMIT_MS} ms limit (endless loop?)`;
    trace = [{ kind: 'error', ok: false, text: error }];
  } else {
    status = r.status;
    error = r.error;
    trace = r.trace;
    if (status === 'success') {
      after = r.storage;
      events = r.events;
    }
  }

  const changes = status === 'success' ? diff(before, after) : [];
  const nextWorld: WorldState = {
    storage: after,
    contract: world.contract,
    nonces: { ...world.nonces, [tx.from]: (world.nonces[tx.from] ?? 0) + 1 },
  };
  if (status === 'success' && (tx.type === 'deploy' || tx.type === 'upgrade')) {
    nextWorld.contract = { version: world.contract.version + 1, codeHash: codeHash(source), source };
  }

  const receipt: Receipt = {
    txHash: tx.hash,
    status,
    error,
    gasUsed: estimateGas(tx, changes, events, trace, status),
    events,
    trace,
    changes,
    contractVersion: nextWorld.contract.version,
  };
  return { receipt, world: nextWorld };
}

/** Ethereum-like gas estimate, to show that writing to storage is what costs the most. */
function estimateGas(tx: SignedTx, changes: StateChange[], events: ContractEvent[], trace: TraceLine[], status: string): number {
  const calldata = canonical(tx.args ?? {}).length + (tx.source?.length ?? 0);
  let gas = 21000 + calldata * 16;
  if (tx.type !== 'call') gas += 32000 + (tx.source?.length ?? 0) * 200;
  gas += trace.filter((t) => t.kind === 'require' || t.kind === 'guard').length * 800;
  if (status === 'success') {
    for (const c of changes) gas += c.op === 'add' ? 20000 : 5000;
    for (const e of events) gas += 375 + canonical(e.data).length * 8;
  }
  return gas;
}

/** List every leaf value that differs between two JSON trees. */
export function diff(a: unknown, b: unknown, path = ''): StateChange[] {
  if (a === b) return [];
  const isObj = (v: unknown) => v !== null && typeof v === 'object';
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const out: StateChange[] = [];
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    const keys = Array.from(new Set([...ka, ...kb]));
    for (const k of keys) {
      const p = Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k;
      const va = (a as any)[k];
      const vb = (b as any)[k];
      if (!(k in (a as object))) out.push({ path: p, op: 'add', after: vb });
      else if (!(k in (b as object))) out.push({ path: p, op: 'remove', before: va });
      else out.push(...diff(va, vb, p));
    }
    return out;
  }
  if (canonical(a) === canonical(b)) return [];
  return [{ path: path || '(root)', op: 'change', before: a, after: b }];
}
