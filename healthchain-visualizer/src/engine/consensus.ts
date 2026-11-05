// PBFT (Castro and Liskov, 1999) between the four hospital nodes, and a proof-of-work race.
import { sha256Hex } from './crypto';
import { meetsTarget, miningTemplate } from './chain';
import type { BlockHeader, HospitalNode } from './types';

export const N = 4;
export const F = 1; // n = 3f + 1
export const QUORUM = 2 * F + 1;

export type MsgState = 'ok' | 'bad' | 'missing';

export interface PbftView {
  view: number;
  primary: number;
  /** Why this view failed, if it did. */
  failure?: string;
  prePrepare: Record<number, MsgState>; // receivers of the primary's PRE-PREPARE
  prepare: Record<number, MsgState>; // sender -> state
  commit: Record<number, MsgState>;
  reply: Record<number, MsgState>;
  prepared: boolean;
  committed: boolean;
}

export interface PbftResult {
  views: PbftView[];
  committed: boolean;
  primary: number;
  commitNodes: number[];
  reason: string;
}

/** Work out what each replica sends for a block at this height. Deterministic, so the UI can replay it. */
export function runPbft(nodes: HospitalNode[], height: number): PbftResult {
  const views: PbftView[] = [];
  const honest = (n: HospitalNode) => n.online && !n.byzantine;
  const honestOnline = nodes.filter(honest).length;

  for (let v = 0; v < N; v++) {
    const primary = nodes[(height + v) % N];
    const view: PbftView = { view: v, primary: primary.id, prePrepare: {}, prepare: {}, commit: {}, reply: {}, prepared: false, committed: false };
    views.push(view);

    if (!primary.online) {
      view.failure = `${primary.short} (primary) is offline. Replicas time out and vote for a view change.`;
      if (honestOnline < QUORUM) break;
      continue;
    }
    if (primary.byzantine) {
      for (const n of nodes) if (n.id !== primary.id) view.prePrepare[n.id] = n.online ? 'bad' : 'missing';
      view.failure = `${primary.short} (primary) sent different PRE-PREPAREs to different replicas. They notice and vote for a view change.`;
      if (honestOnline < QUORUM) break;
      continue;
    }

    for (const n of nodes) if (n.id !== primary.id) view.prePrepare[n.id] = n.online ? 'ok' : 'missing';
    // PREPARE: every backup that accepted the PRE-PREPARE tells everyone else.
    for (const n of nodes) {
      if (n.id === primary.id) continue;
      view.prepare[n.id] = !n.online ? 'missing' : n.byzantine ? 'bad' : 'ok';
    }
    const goodPrepares = Object.values(view.prepare).filter((s) => s === 'ok').length;
    view.prepared = goodPrepares >= 2 * F; // plus the primary's own PRE-PREPARE
    if (!view.prepared) {
      view.failure = `Only ${goodPrepares} matching PREPARE messages arrived; ${2 * F} are needed. The block cannot be agreed.`;
      break;
    }
    for (const n of nodes) view.commit[n.id] = !n.online ? 'missing' : n.byzantine ? 'bad' : 'ok';
    const goodCommits = Object.values(view.commit).filter((s) => s === 'ok').length;
    view.committed = goodCommits >= QUORUM;
    if (!view.committed) {
      view.failure = `Only ${goodCommits} matching COMMIT messages; ${QUORUM} (2f+1) are needed.`;
      break;
    }
    for (const n of nodes) view.reply[n.id] = !n.online ? 'missing' : n.byzantine ? 'bad' : 'ok';
    return {
      views,
      committed: true,
      primary: primary.id,
      commitNodes: nodes.filter(honest).map((n) => n.id),
      reason: `${goodCommits} of ${N} hospitals committed (needs ${QUORUM})`,
    };
  }
  const last = views[views.length - 1];
  return {
    views,
    committed: false,
    primary: last?.primary ?? nodes[height % N].id,
    commitNodes: [],
    reason:
      honestOnline < QUORUM
        ? `Only ${honestOnline} honest hospitals are reachable. PBFT needs ${QUORUM} of ${N} (2f+1), so nothing is committed. This is PBFT choosing safety over progress.`
        : last?.failure || 'No agreement',
  };
}

export interface MinerProgress {
  nodeId: number;
  nonce: number;
  lastHash: string;
  found: boolean;
}

/**
 * Proof-of-work race: each online hospital hashes its own candidate header (they differ in the proposer field)
 * with increasing nonces. The first hash below the target wins. Runs in small slices so the UI can animate.
 */
export async function powRace(
  baseHeader: BlockHeader,
  nodes: HospitalNode[],
  difficulty: number,
  opts: { sliceSize: () => number; onProgress: (p: MinerProgress[]) => void; shouldFinishFast: () => boolean },
): Promise<{ winner: number; header: BlockHeader; hash: string; attempts: number } | null> {
  const miners = nodes.filter((n) => n.online);
  if (miners.length === 0) return null;
  const templates = miners.map((m) => miningTemplate({ ...baseHeader, proposer: m.id, difficulty, consensus: 'pow' }));
  const progress: MinerProgress[] = miners.map((m) => ({ nodeId: m.id, nonce: 0, lastHash: '', found: false }));
  let attempts = 0;
  for (;;) {
    const slice = opts.shouldFinishFast() ? 20000 : opts.sliceSize();
    for (let i = 0; i < miners.length; i++) {
      const p = progress[i];
      const t = templates[i];
      for (let k = 0; k < slice; k++) {
        const h = sha256Hex(t.prefix + p.nonce + t.suffix);
        attempts++;
        if (meetsTarget(h, difficulty)) {
          p.lastHash = h;
          p.found = true;
          opts.onProgress(progress.map((x) => ({ ...x })));
          const header = { ...baseHeader, proposer: miners[i].id, difficulty, consensus: 'pow' as const, nonce: p.nonce };
          return { winner: miners[i].id, header, hash: h, attempts };
        }
        p.lastHash = h;
        p.nonce++;
      }
    }
    opts.onProgress(progress.map((x) => ({ ...x })));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
