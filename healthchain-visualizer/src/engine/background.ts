// Transactions from the other hospitals, so blocks hold more than one transaction and the
// Merkle tree has something to show. They are real signed transactions run through the same contract.
import { makeUnsigned, signTx } from './chain';
import { sha256Hex } from './crypto';
import { executeTx } from './runtime';
import type { Actor, OffChainDoc, SignedTx, WorldState } from './types';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LAB_RESULTS = [
  { title: 'Complete blood count', content: 'Haemoglobin 13.8 g/dL, WBC 7.2 x10^9/L, platelets 250 x10^9/L. Within normal range.' },
  { title: 'HbA1c', content: 'HbA1c 7.4% (target below 7%). Fasting glucose 142 mg/dL.' },
  { title: 'Lipid profile', content: 'Total cholesterol 212 mg/dL, LDL 138 mg/dL, HDL 41 mg/dL, triglycerides 165 mg/dL.' },
  { title: 'Renal function', content: 'Creatinine 0.9 mg/dL, urea 28 mg/dL, eGFR 96 mL/min.' },
  { title: 'Chest X-ray report', content: 'Lungs clear, no consolidation. Heart size normal.' },
];

const ACCESS_REASONS = ['Ward round review', 'Follow-up consultation', 'Medication reconciliation', 'Discharge summary check'];

export async function backgroundTraffic(
  world: WorldState,
  actors: Actor[],
  excludeAddress: string,
  height: number,
): Promise<{ txs: SignedTx[]; docs: OffChainDoc[]; fromNodes: number[] }> {
  const rand = rng(height * 7919 + Object.keys(world.nonces).length);
  const st = world.storage;
  const byAddr = new Map(actors.map((a) => [a.address, a]));
  const candidates: { actor: Actor; method: string; args: any; doc?: OffChainDoc }[] = [];

  for (const [patient, providers] of Object.entries<any>(st.consents || {})) {
    for (const provider of Object.keys(providers || {})) {
      const actor = byAddr.get(provider);
      if (!actor || actor.address === excludeAddress) continue;
      if (actor.role === 'lab') {
        const r = LAB_RESULTS[Math.floor(rand() * LAB_RESULTS.length)];
        const ref = `offchain://${actor.id}/${height}-${Math.floor(rand() * 1e6)}`;
        const doc: OffChainDoc = { ref, patient, title: r.title, content: r.content, hash: sha256Hex(r.content), author: actor.address };
        candidates.push({ actor, method: 'addRecord', args: { patient, kind: 'lab', title: r.title, dataHash: doc.hash, storageRef: ref }, doc });
      } else if (actor.role === 'doctor' || actor.role === 'nurse') {
        const recs = Object.entries<any>(st.records || {}).filter(([, r]) => r.patient === patient);
        if (recs.length) {
          const [id] = recs[Math.floor(rand() * recs.length)];
          candidates.push({ actor, method: 'accessRecord', args: { recordId: id, reason: ACCESS_REASONS[Math.floor(rand() * ACCESS_REASONS.length)] } });
        }
      }
    }
  }

  // Shuffle, keep one per sender, and try up to three.
  candidates.sort(() => rand() - 0.5);
  const want = 1 + Math.floor(rand() * 3);
  const used = new Set<string>();
  const txs: SignedTx[] = [];
  const docs: OffChainDoc[] = [];
  const fromNodes: number[] = [];
  let w = world;
  const ts = Date.now() - 4000;
  for (const c of candidates) {
    if (txs.length >= want) break;
    if (used.has(c.actor.address)) continue;
    const tx = signTx(
      makeUnsigned({ type: 'call', from: c.actor.address, nonce: w.nonces[c.actor.address] ?? 0, method: c.method, args: c.args, timestamp: ts + txs.length * 900 }),
      c.actor.privateKey,
    );
    // Only keep transactions the current contract accepts, so background noise never fails.
    const r = await executeTx(w, tx, { number: height, timestamp: Date.now() });
    if (r.receipt.status !== 'success') continue;
    w = r.world;
    used.add(c.actor.address);
    txs.push(tx);
    fromNodes.push(c.actor.nodeId);
    if (c.doc) docs.push(c.doc);
  }
  return { txs, docs, fromNodes };
}
