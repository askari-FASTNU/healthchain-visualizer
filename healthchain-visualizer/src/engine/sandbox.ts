// The contract sandbox. Normally runs inside a Web Worker (sandbox.worker.ts) so an endless loop in edited
// code cannot freeze the app: the main thread kills the worker if it does not answer in time ("out of gas").
import { hashValue } from './crypto';
import type { ContractEvent, TraceLine } from './types';

interface Definition {
  name?: string;
  defaultPolicy?: { permissions?: Record<string, string[]>; params?: Record<string, unknown> };
  init?: (args: unknown) => void;
  guard?: (method: string) => void;
  migrate?: () => void;
  methods?: Record<string, (args: any) => void>;
}

class Revert extends Error {}

const ROLES = ['admin', 'doctor', 'nurse', 'patient', 'lab', 'pharmacist', 'insurer'];

function forbidden(name: string, hint: string) {
  return () => {
    throw new Error(`${name} is not allowed in a smart contract: ${hint}`);
  };
}

const SafeMath = Object.freeze(
  Object.assign(Object.create(null), Object.fromEntries(Object.getOwnPropertyNames(Math).map((k) => [k, (Math as any)[k]])), {
    random: forbidden('Math.random()', 'every node would get a different number'),
  }),
);
const SafeDate = forbidden('Date', 'use block.timestamp so every node sees the same time');

/** Evaluate the contract source with a fresh context and return its definition. */
function load(source: string, ctx: { state: any; caller: any; block: any; trace: TraceLine[]; events: ContractEvent[] }) {
  let def: Definition | null = null;
  const contract = (d: Definition) => {
    def = d;
  };
  const lines = source.split('\n');
  const require = (ok: unknown, why: string) => {
    // Find the contract line that called require(), so the trace can show the actual code that ran.
    const line = callerLine(new Error().stack);
    const code = line ? lines[line - 1]?.trim() : undefined;
    ctx.trace.push({ kind: 'require', ok: Boolean(ok), text: String(why), line, code });
    if (!ok) throw new Revert(String(why));
  };
  const emit = (name: string, data: Record<string, unknown> = {}) => {
    const clean = JSON.parse(JSON.stringify(data ?? {}));
    ctx.events.push({ name: String(name), data: clean });
    ctx.trace.push({ kind: 'emit', ok: true, text: `${name} ${JSON.stringify(clean)}` });
  };
  const hash = (v: unknown) => hashValue(v);
  if (!ctx.state.policy) ctx.state.policy = { permissions: {}, params: {} };
  const policy = ctx.state.policy;
  const fn = new Function(
    'state', 'policy', 'caller', 'block', 'require', 'emit', 'hash', 'contract',
    'Date', 'Math', 'fetch', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'importScripts', 'self', 'postMessage',
    '"use strict";\n' + source,
  );
  fn(ctx.state, policy, ctx.caller, ctx.block, require, emit, hash, contract,
    SafeDate, SafeMath, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
  if (!def) throw new Error('The code never calls contract({ ... }), so there is nothing to deploy');
  const d = def as Definition;
  if (!d.methods || typeof d.methods !== 'object') throw new Error('contract({ ... }) needs a methods object');
  return d;
}

function paramNames(fn: Function): string[] {
  const src = fn.toString();
  const m = src.match(/^[^(]*\(\s*\{([^}]*)\}/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().split(/[=:\s]/)[0])
    .filter(Boolean);
}

function mergePolicy(state: any, def: Definition, trace: TraceLine[]) {
  const dp = def.defaultPolicy || {};
  state.policy = state.policy || { permissions: {}, params: {} };
  state.policy.permissions = state.policy.permissions || {};
  state.policy.params = state.policy.params || {};
  const addedPerm: string[] = [];
  const addedParam: string[] = [];
  for (const [k, v] of Object.entries(dp.permissions || {})) {
    if (!(k in state.policy.permissions)) {
      state.policy.permissions[k] = Array.isArray(v) ? v.filter((r) => ROLES.includes(r)) : [];
      addedPerm.push(k);
    }
  }
  for (const [k, v] of Object.entries(dp.params || {})) {
    if (!(k in state.policy.params)) {
      state.policy.params[k] = v;
      addedParam.push(k);
    }
  }
  // Every method needs a permission entry, even if the author forgot one (empty = nobody).
  for (const m of Object.keys(def.methods || {})) {
    if (!(m in state.policy.permissions)) {
      state.policy.permissions[m] = [];
      addedPerm.push(m + ' (nobody yet)');
    }
  }
  if (addedPerm.length) trace.push({ kind: 'migrate', ok: true, text: `New permissions written to storage: ${addedPerm.join(', ')}` });
  if (addedParam.length) trace.push({ kind: 'migrate', ok: true, text: `New policy parameters written to storage: ${addedParam.join(', ')}` });
}

const WRAPPER_LINES = 3; // new Function adds two wrapper lines, plus our "use strict" line

/** Line number (in the contract source) of the first stack frame that belongs to contract code. */
function callerLine(stack: string | undefined): number | undefined {
  if (!stack) return undefined;
  for (const frame of stack.split('\n').slice(1)) {
    const m = frame.match(/<anonymous>:(\d+):\d+/) || frame.match(/Function:(\d+):\d+/);
    if (m) {
      const n = Number(m[1]) - WRAPPER_LINES;
      return n > 0 ? n : undefined;
    }
  }
  return undefined;
}

function lineOf(err: unknown): number | undefined {
  const stack = (err as Error)?.stack || '';
  const m = stack.match(/<anonymous>:(\d+):\d+/);
  if (!m) return undefined;
  const n = Number(m[1]) - 3; // new Function adds two wrapper lines, plus our "use strict" line
  return n > 0 ? n : undefined;
}

export interface ExecRequest {
  kind: 'execute';
  txType: 'deploy' | 'call' | 'upgrade';
  source: string; // code to run (new code for deploy and upgrade)
  storage: any;
  method?: string;
  args?: any;
  caller: { address: string; name: string; role: string; org: string };
  block: { number: number; timestamp: number };
}

export interface InspectRequest {
  kind: 'inspect';
  source: string;
}

export function execute(req: ExecRequest) {
  const trace: TraceLine[] = [];
  const events: ContractEvent[] = [];
  const state = req.storage || {};
  const ctx = { state, caller: Object.freeze({ ...req.caller }), block: Object.freeze({ ...req.block }), trace, events };
  try {
    if (req.txType === 'call') {
      const def = load(req.source, ctx);
      const method = req.method || '';
      if (def.guard) {
        trace.push({ kind: 'guard', ok: true, text: `guard("${method}") checks the caller's role against policy.permissions` });
        def.guard(method);
      }
      const fn = def.methods![method];
      if (typeof fn !== 'function') throw new Revert(`The contract has no method called ${method}()`);
      trace.push({ kind: 'info', ok: true, text: `Running ${method}()` });
      fn(req.args ?? {});
    } else {
      // deploy or upgrade
      trace.push({ kind: 'compile', ok: true, text: 'Parsing the new code' });
      if (req.txType === 'upgrade') {
        const ok = req.caller.role === 'admin';
        trace.push({ kind: 'require', ok, text: 'Only a node admin can upgrade contract code' });
        if (!ok) throw new Revert(`Role "${req.caller.role}" cannot upgrade the contract`);
      }
      const def = load(req.source, ctx);
      trace.push({ kind: 'compile', ok: true, text: `Compiled contract "${def.name || 'unnamed'}" with ${Object.keys(def.methods!).length} methods` });
      mergePolicy(state, def, trace);
      if (req.txType === 'deploy' && def.init) {
        def.init(req.args ?? {});
        trace.push({ kind: 'info', ok: true, text: 'init() set up empty storage' });
      }
      if (req.txType === 'upgrade') {
        if (def.migrate) {
          def.migrate();
          trace.push({ kind: 'migrate', ok: true, text: 'migrate() ran on existing storage' });
        }
        trace.push({ kind: 'info', ok: true, text: 'Existing storage kept: patients, consents and records carry over' });
      }
    }
    return { status: 'success' as const, storage: state, events, trace };
  } catch (err) {
    const isRevert = err instanceof Revert;
    const line = isRevert ? undefined : lineOf(err);
    const message = (err as Error)?.message || String(err);
    const text = isRevert ? message : `${(err as Error)?.name || 'Error'}: ${message}${line ? ` (line ${line})` : ''}`;
    if (!isRevert) trace.push({ kind: 'error', ok: false, text });
    return { status: 'reverted' as const, error: text, events: [], trace };
  }
}

export function inspect(req: InspectRequest) {
  try {
    const def = load(req.source, {
      state: { policy: { permissions: {}, params: {} } },
      caller: { address: '0x0', name: 'inspector', role: 'admin', org: '' },
      block: { number: 0, timestamp: 0 },
      trace: [],
      events: [],
    });
    const methods = Object.entries(def.methods || {}).map(([name, fn]) => ({ name, params: paramNames(fn) }));
    return {
      ok: true as const,
      name: def.name || 'unnamed',
      methods,
      defaultPolicy: JSON.parse(JSON.stringify(def.defaultPolicy || {})),
      hasInit: typeof def.init === 'function',
      hasGuard: typeof def.guard === 'function',
    };
  } catch (err) {
    const line = lineOf(err);
    return { ok: false as const, error: `${(err as Error)?.name || 'Error'}: ${(err as Error)?.message}${line ? ` (line ${line})` : ''}` };
  }
}
