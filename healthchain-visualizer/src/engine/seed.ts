// Builds the starting chain: a genesis block that deploys contract v1, then a few blocks of history.
// Everything is produced with the same signing, execution and hashing code as live transactions.
import { blockHash, makeUnsigned, signTx, ZERO_HASH } from './chain';
import { sha256Hex } from './crypto';
import { buildMerkleTree } from './merkle';
import { codeHash, executeTx, stateRoot } from './runtime';
import { DEFAULT_CONTRACT } from './contractSource';
import { runPbft } from './consensus';
import type { Actor, Block, ContractVersion, HospitalNode, OffChainDoc, Receipt, SignedTx, WorldState } from './types';

export interface ChainSnapshot {
  blocks: Block[];
  world: WorldState;
  versions: ContractVersion[];
  offchain: Record<string, OffChainDoc>;
}

type Step = { actor: string; method: string; args: (a: Record<string, Actor>) => any; doc?: (a: Record<string, Actor>) => Omit<OffChainDoc, 'hash' | 'ref'> };

export async function buildInitialChain(actors: Actor[], nodes: HospitalNode[]): Promise<ChainSnapshot> {
  const A = Object.fromEntries(actors.map((a) => [a.id, a]));
  let world: WorldState = { storage: {}, contract: { version: 0, codeHash: '', source: '' }, nonces: {} };
  const blocks: Block[] = [];
  const offchain: Record<string, OffChainDoc> = {};
  const start = Date.now() - 45 * 60 * 1000;

  const members = Object.fromEntries(actors.map((a) => [a.address, { name: a.name, role: a.role, org: a.org }]));

  async function seal(txs: SignedTx[], number: number, minutes: number, consensus: 'genesis' | 'pbft') {
    const timestamp = start + minutes * 60 * 1000;
    const receipts: Receipt[] = [];
    for (const tx of txs) {
      const r = await executeTx(world, tx, { number, timestamp });
      if (r.receipt.status !== 'success') throw new Error(`Seed transaction failed: ${tx.method} ${r.receipt.error}`);
      receipts.push(r.receipt);
      world = r.world;
    }
    const pbft = runPbft(nodes, number);
    const header = {
      number,
      prevHash: blocks.length ? blocks[blocks.length - 1].hash : ZERO_HASH,
      merkleRoot: buildMerkleTree(txs.map((t) => t.hash)).root,
      stateRoot: stateRoot(world),
      timestamp,
      proposer: consensus === 'genesis' ? 1 : pbft.primary,
      consensus,
      difficulty: 0,
      nonce: 0,
    } as const;
    blocks.push({ header: { ...header }, hash: blockHash({ ...header }), txs, receipts, commits: consensus === 'genesis' ? [1, 2, 3, 4] : pbft.commitNodes });
  }

  // Genesis: the admin deploys version 1 of the contract with the founding members.
  const deploy = signTx(
    makeUnsigned({ type: 'deploy', from: A.admin.address, nonce: 0, args: { members }, source: DEFAULT_CONTRACT, note: 'Genesis: deploy MedicalRecords v1', timestamp: start }),
    A.admin.privateKey,
  );
  await seal([deploy], 0, 0, 'genesis');

  const history: Step[][] = [
    [
      { actor: 'admin', method: 'registerPatient', args: (a) => ({ patient: a.ali.address, name: 'Ali Raza', age: 34, bloodGroup: 'B+' }) },
      { actor: 'admin', method: 'registerPatient', args: (a) => ({ patient: a.bilal.address, name: 'Bilal Ahmed', age: 16, bloodGroup: 'O+' }) },
    ],
    [
      { actor: 'ali', method: 'grantConsent', args: (a) => ({ provider: a.ayesha.address }) },
      { actor: 'ali', method: 'grantConsent', args: (a) => ({ provider: a.sana.address }) },
      { actor: 'ali', method: 'grantConsent', args: (a) => ({ provider: a.meridian.address }) },
      { actor: 'bilal', method: 'grantConsent', args: (a) => ({ provider: a.ayesha.address }) },
    ],
    [
      {
        actor: 'ayesha',
        method: 'addRecord',
        args: () => ({}),
        doc: (a) => ({
          patient: a.ali.address,
          title: 'Consultation note',
          content: 'Presents with fatigue and increased thirst for 3 weeks. BP 132/84. Suspected type 2 diabetes. Ordered HbA1c and fasting glucose.',
          author: a.ayesha.address,
        }),
      },
      {
        actor: 'meridian',
        method: 'addRecord',
        args: () => ({}),
        doc: (a) => ({ patient: a.ali.address, title: 'HbA1c', content: 'HbA1c 7.4% (target below 7%). Fasting glucose 142 mg/dL.', author: a.meridian.address }),
      },
    ],
    [
      { actor: 'ayesha', method: 'prescribe', args: (a) => ({ patient: a.ali.address, drug: 'Metformin', doseMg: 500, timesPerDay: 2, days: 30 }) },
      { actor: 'admin', method: 'submitClaim', args: (a) => ({ patient: a.ali.address, amount: 18500, description: 'Outpatient consultation and HbA1c test' }) },
    ],
  ];

  let minute = 8;
  for (const stepList of history) {
    const txs: SignedTx[] = [];
    const nonces = { ...world.nonces };
    for (const step of stepList) {
      const actor = A[step.actor];
      let args = step.args(A);
      if (step.doc) {
        const d = step.doc(A);
        const ref = `offchain://${actor.id}/seed-${Object.keys(offchain).length + 1}`;
        const doc: OffChainDoc = { ...d, ref, hash: sha256Hex(d.content) };
        offchain[ref] = doc;
        args = { patient: d.patient, kind: actor.role === 'lab' ? 'lab' : 'clinical note', title: d.title, dataHash: doc.hash, storageRef: ref };
      }
      const nonce = nonces[actor.address] ?? 0;
      nonces[actor.address] = nonce + 1;
      txs.push(signTx(makeUnsigned({ type: 'call', from: actor.address, nonce, method: step.method, args, timestamp: start + (minute - 1) * 60000 }), actor.privateKey));
    }
    await seal(txs, blocks.length, minute, 'pbft');
    minute += 9;
  }

  const versions: ContractVersion[] = [
    { version: 1, codeHash: codeHash(DEFAULT_CONTRACT), source: DEFAULT_CONTRACT, block: 0, deployedBy: A.admin.address, note: 'Initial deployment' },
  ];
  return { blocks, world, versions, offchain };
}
