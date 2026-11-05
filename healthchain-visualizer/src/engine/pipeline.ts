// Drives one transaction through every stage a real blockchain uses, pausing between stages
// so the trail on the left can show what is happening. All values shown are really computed here.
import { createAttacker } from './actors';
import { backgroundTraffic } from './background';
import { blockHash, makeUnsigned, recoverSigner, unsignedPart, ZERO_HASH } from './chain';
import { canonical, keccakHex, recoverPublicKey, sha256Hex, sign } from './crypto';
import { buildMerkleTree } from './merkle';
import { powRace, runPbft, type MinerProgress } from './consensus';
import { codeHash, executeTx, stateRoot } from './runtime';
import { getState, patchRun, persist, refreshContractInfo, setState, STAGES, toast, type Run, type StageId } from './store';
import type { Block, BlockHeader, OffChainDoc, Receipt, SignedTx, TxType, WorldState } from './types';

export interface TxDraft {
  actorId: string;
  type: Exclude<TxType, 'deploy'>;
  method?: string;
  args?: any;
  source?: string;
  note?: string;
  title: string;
  doc?: OffChainDoc;
}

// Base duration of each stage at 1x speed, in milliseconds.
const DURATION: Record<StageId, number> = {
  compose: 1800,
  hash: 2600,
  sign: 2800,
  broadcast: 2600,
  verify: 2800,
  mempool: 2000,
  execute: 3400,
  block: 3200,
  consensus: 4600,
  append: 2600,
  receipt: 1600,
};

let nextResolver: (() => void) | null = null;

export function nextStep() {
  const r = nextResolver;
  nextResolver = null;
  r?.();
}

export function skipToEnd() {
  setState({ skip: true });
  nextStep();
}

async function sleep(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (getState().skip) return;
    await new Promise((r) => setTimeout(r, Math.min(60, end - performance.now())));
  }
}

async function pause(stage: StageId) {
  const s = getState();
  if (s.skip) return;
  if (s.settings.stepMode) {
    setState({ awaitingNext: true });
    await new Promise<void>((r) => (nextResolver = r));
    setState({ awaitingNext: false });
    return;
  }
  await sleep(DURATION[stage] / s.settings.speed);
}

const idx = (id: StageId) => STAGES.findIndex((s) => s.id === id);

function activate(run: Run, id: StageId, data: any) {
  const i = idx(id);
  patchRun(run.id, (r) => ({ ...r, stages: r.stages.map((s, k) => (k === i ? { ...s, status: 'active', data } : s)) }));
}

function updateData(run: Run, id: StageId, patch: any) {
  const i = idx(id);
  patchRun(run.id, (r) => ({ ...r, stages: r.stages.map((s, k) => (k === i ? { ...s, data: { ...s.data, ...patch } } : s)) }));
}

function finish(run: Run, id: StageId, summary: string, status: 'done' | 'failed' = 'done') {
  const i = idx(id);
  patchRun(run.id, (r) => ({ ...r, stages: r.stages.map((s, k) => (k === i ? { ...s, status, summary } : s)) }));
}

function stopRun(run: Run, from: StageId, outcome: Run['outcome']) {
  const i = idx(from);
  patchRun(run.id, (r) => ({ ...r, outcome, stages: r.stages.map((s, k) => (k > i ? { ...s, status: 'skipped' } : s)) }));
}

let runCounter = 0;

/** Pick a digit to change for the "one character" demo: a number inside the arguments if there is one. */
function tweakIndex(str: string): number {
  const a = str.indexOf('"args":');
  const c = str.indexOf(',"chainId"');
  if (a >= 0 && c > a) {
    const m = str.slice(a, c).search(/:\d/);
    if (m >= 0) return a + m + 1;
  }
  return str.search(/\d(?=[^\d]*$)/);
}

export async function submitTx(draft: TxDraft): Promise<void> {
  const s0 = getState();
  if (s0.busy || !s0.ready) return;
  const actor = s0.actors.find((a) => a.id === draft.actorId);
  if (!actor) return;
  const forged = s0.forgeNext;

  const run: Run = {
    id: ++runCounter,
    title: draft.title,
    actorName: actor.name,
    actorRole: actor.role,
    txType: draft.type,
    method: draft.method,
    startedAt: Date.now(),
    stages: STAGES.map((st) => ({ id: st.id, status: 'waiting' })),
  };
  setState({ busy: true, skip: false, forgeNext: false, runs: [run, ...s0.runs].slice(0, 20), viewRunId: run.id });

  try {
    const world0 = s0.world;

    // 1. Compose
    if (draft.doc) {
      setState({ offchain: { ...getState().offchain, [draft.doc.ref]: draft.doc } });
    }
    const nonce = world0.nonces[actor.address] ?? 0;
    const unsigned = makeUnsigned({ type: draft.type, from: actor.address, nonce, method: draft.method, args: draft.args, source: draft.source, note: draft.note });
    const entryNode = s0.nodes.find((n) => n.id === actor.nodeId)!;
    activate(run, 'compose', {
      unsigned: { ...unsigned, source: unsigned.source ? `<${unsigned.source.length} characters of contract code>` : undefined },
      actor: { name: actor.name, role: actor.role, org: actor.org, address: actor.address },
      doc: draft.doc ? { ref: draft.doc.ref, hash: draft.doc.hash, title: draft.doc.title, size: draft.doc.content.length } : null,
      entryNode: entryNode.name,
    });
    await pause('compose');
    finish(run, 'compose', draft.type === 'upgrade' ? `Contract upgrade from ${actor.name}` : `${draft.method}() from ${actor.name}, nonce ${nonce}`);

    // 2. Hash
    const canon = canonical(unsignedPart(unsigned));
    const hash = sha256Hex(canon);
    const tweakAt = tweakIndex(canon);
    const tweaked = tweakAt >= 0 ? canon.slice(0, tweakAt) + String((Number(canon[tweakAt]) + 1) % 10) + canon.slice(tweakAt + 1) : canon + ' ';
    const display = draft.source ? canon.replace(JSON.stringify(draft.source), `"<${draft.source.length} characters of code>"`) : canon;
    activate(run, 'hash', {
      canonical: display,
      bytes: new TextEncoder().encode(canon).length,
      hash,
      tweakIndex: draft.source ? tweakIndex(display) : tweakAt,
      tweakedHash: sha256Hex(tweaked),
      tweakFrom: canon[tweakAt],
      tweakTo: tweaked[tweakAt],
    });
    await pause('hash');
    finish(run, 'hash', `Transaction hash ${hash.slice(0, 10)}…`);

    // 3. Sign
    const attacker = createAttacker();
    const signerKey = forged ? attacker.privateKey : actor.privateKey;
    const signerPub = forged ? attacker.publicKey : actor.publicKey;
    const signature = sign(hash, signerKey);
    const signed: SignedTx = { ...unsigned, hash, signature };
    activate(run, 'sign', {
      forged,
      signerName: forged ? attacker.name : actor.name,
      privateKey: signerKey,
      publicKey: signerPub,
      keccak: keccakHex(signerPub),
      address: forged ? attacker.address : actor.address,
      claimedFrom: actor.address,
      signature,
    });
    await pause('sign');
    finish(run, 'sign', forged ? 'Signed with a key that does not belong to the sender' : `Signed by ${actor.name}`);

    // 4. Broadcast
    const nodes = getState().nodes;
    activate(run, 'broadcast', { entry: entryNode.id, nodes: nodes.map((n) => ({ id: n.id, short: n.short, online: n.online, byzantine: n.byzantine })) });
    await pause('broadcast');
    if (!entryNode.online) {
      const why = `${entryNode.name} is offline, so ${actor.name}'s transaction cannot reach the network`;
      finish(run, 'broadcast', why, 'failed');
      stopRun(run, 'broadcast', { kind: 'stalled', text: `${why}. Bring the node back online on the Network tab and try again.` });
      toast('The entry node is offline. Nothing was sent.', 'bad');
      return;
    }
    const reached = nodes.filter((n) => n.online).length;
    finish(run, 'broadcast', `Reached ${reached} of ${nodes.length} hospital nodes`);

    // 5. Verify
    const recovered = recoverSigner(signed);
    const recoveredPub = recoverPublicKey(hash, signature);
    const member = world0.storage.members?.[actor.address];
    const rows = nodes.map((n) => ({
      id: n.id,
      short: n.short,
      online: n.online,
      checks: n.online
        ? [
            { label: 'Hash matches content', ok: sha256Hex(canonical(unsignedPart(signed))) === signed.hash },
            { label: 'Signature recovers the sender', ok: recovered === actor.address },
            { label: `Nonce is ${nonce}, the next expected`, ok: (world0.nonces[actor.address] ?? 0) === nonce },
            { label: 'Sender is a network member', ok: Boolean(member) },
          ]
        : [],
    }));
    const valid = recovered === actor.address && Boolean(member);
    activate(run, 'verify', { rows, recovered, recoveredPub, claimed: actor.address, valid });
    await pause('verify');
    if (!valid) {
      const why =
        recovered !== actor.address
          ? `Rejected by every node: the signature recovers ${recovered?.slice(0, 10)}…, not the claimed sender ${actor.address.slice(0, 10)}…`
          : 'Rejected: the sender is not a member of this permissioned network';
      finish(run, 'verify', why, 'failed');
      stopRun(run, 'verify', { kind: 'rejected', text: why + '. It never reaches the mempool, so no block will contain it.' });
      toast('Transaction rejected at verification. Nothing was written to the chain.', 'bad');
      return;
    }
    finish(run, 'verify', `Accepted by ${rows.filter((r) => r.online).length} online nodes`);

    // 6. Mempool
    const height = getState().blocks.length;
    const onlineIds = new Set(getState().nodes.filter((n) => n.online).map((n) => n.id));
    const bg = getState().settings.traffic
      ? await backgroundTraffic(world0, getState().actors.filter((a) => onlineIds.has(a.nodeId)), actor.address, height)
      : { txs: [], docs: [], fromNodes: [] };
    const myIndex = Math.min(1, bg.txs.length);
    const txs = [...bg.txs];
    txs.splice(myIndex, 0, signed);
    const nodeOf = (t: SignedTx, i: number) => (t === signed ? actor.nodeId : bg.fromNodes[i > myIndex ? i - 1 : i]);
    activate(run, 'mempool', {
      myIndex,
      txs: txs.map((t, i) => ({ hash: t.hash, from: t.from, method: t.type === 'upgrade' ? 'upgrade contract' : t.method, node: nodeOf(t, i), mine: t === signed })),
    });
    await pause('mempool');
    finish(run, 'mempool', bg.txs.length ? `Queued with ${bg.txs.length} transaction${bg.txs.length > 1 ? 's' : ''} from other hospitals` : 'Queued for the next block');

    // 7. Execute
    const s = getState();
    const consensus = s.settings.consensus;
    const pbft = consensus === 'pbft' ? runPbft(s.nodes, height) : null;
    const executor = pbft ? s.nodes.find((n) => n.id === pbft.primary)! : null;
    const timestamp = Date.now();
    let world: WorldState = world0;
    const receipts: Receipt[] = [];
    let myReceipt: Receipt | null = null;
    let worldBeforeMine: WorldState = world0;
    for (const t of txs) {
      if (t === signed) worldBeforeMine = world;
      const r = await executeTx(world, t, { number: height, timestamp });
      receipts.push(r.receipt);
      world = r.world;
      if (t === signed) myReceipt = r.receipt;
    }
    const mine = myReceipt!;
    activate(run, 'execute', {
      receipt: mine,
      txType: draft.type,
      method: draft.method,
      executor: executor ? executor.name : 'every mining node',
      consensus,
      versionBefore: worldBeforeMine.contract.version,
      codeHashBefore: worldBeforeMine.contract.codeHash,
      codeHashAfter: draft.type === 'upgrade' && mine.status === 'success' ? codeHash(draft.source || '') : undefined,
      sourceBefore: draft.type === 'upgrade' ? worldBeforeMine.contract.source : undefined,
      sourceAfter: draft.type === 'upgrade' ? draft.source : undefined,
      stateRootBefore: stateRoot(world0),
      stateRootAfter: stateRoot(world),
      others: receipts.filter((r) => r !== mine).map((r) => ({ hash: r.txHash, status: r.status })),
    });
    await pause('execute');
    finish(
      run,
      'execute',
      mine.status === 'success'
        ? `Allowed. ${mine.changes.length} storage change${mine.changes.length === 1 ? '' : 's'}, ${mine.events.length} event${mine.events.length === 1 ? '' : 's'}`
        : `Reverted: ${mine.error}`,
      mine.status === 'success' ? 'done' : 'failed',
    );

    // 8. Block
    const merkle = buildMerkleTree(txs.map((t) => t.hash));
    const prev = s.blocks[s.blocks.length - 1];
    let header: BlockHeader = {
      number: height,
      prevHash: prev?.hash ?? ZERO_HASH,
      merkleRoot: merkle.root,
      stateRoot: stateRoot(world),
      timestamp,
      proposer: pbft ? pbft.primary : actor.nodeId,
      consensus,
      difficulty: consensus === 'pow' ? s.settings.difficulty : 0,
      nonce: 0,
    };
    activate(run, 'block', { levels: merkle.levels, myIndex, header, reverted: mine.status !== 'success' });
    await pause('block');
    finish(run, 'block', `Block #${height} with ${txs.length} transaction${txs.length > 1 ? 's' : ''}, Merkle root ${merkle.root.slice(0, 8)}…`);

    // 9. Consensus
    let commits: number[] = [];
    let hash9 = '';
    if (pbft) {
      activate(run, 'consensus', { kind: 'pbft', pbft, nodes: s.nodes.map((n) => ({ id: n.id, short: n.short, online: n.online, byzantine: n.byzantine })) });
      await pause('consensus');
      if (!pbft.committed) {
        finish(run, 'consensus', 'No quorum: block not committed', 'failed');
        stopRun(run, 'consensus', { kind: 'stalled', text: `${pbft.reason} The transaction stays in the mempool; bring nodes back online and submit again.` });
        toast('Consensus failed. The block was not added.', 'bad');
        return;
      }
      commits = pbft.commitNodes;
      hash9 = blockHash(header);
      finish(run, 'consensus', `Committed by ${commits.length} of 4 hospitals in view ${pbft.views[pbft.views.length - 1].view}`);
    } else {
      const difficulty = s.settings.difficulty;
      activate(run, 'consensus', {
        kind: 'pow',
        difficulty,
        target: '0'.repeat(difficulty),
        expected: Math.pow(16, difficulty),
        miners: s.nodes.map((n) => ({ nodeId: n.id, short: n.short, online: n.online, nonce: 0, lastHash: '', found: false })),
      });
      const start = performance.now();
      const result = await powRace(header, s.nodes, difficulty, {
        sliceSize: () => Math.max(20, Math.round(60 * getState().settings.speed * Math.pow(2, difficulty - 3))),
        shouldFinishFast: () => getState().skip,
        onProgress: (p: MinerProgress[]) =>
          updateData(run, 'consensus', {
            miners: s.nodes.map((n) => {
              const m = p.find((x) => x.nodeId === n.id);
              return { nodeId: n.id, short: n.short, online: n.online, nonce: m?.nonce ?? 0, lastHash: m?.lastHash ?? '', found: m?.found ?? false };
            }),
          }),
      });
      if (!result) {
        finish(run, 'consensus', 'No miners online', 'failed');
        stopRun(run, 'consensus', { kind: 'stalled', text: 'Every node is offline, so nobody can mine the block.' });
        return;
      }
      header = result.header;
      hash9 = result.hash;
      commits = s.nodes.filter((n) => n.online).map((n) => n.id);
      updateData(run, 'consensus', { winner: result.winner, hash: result.hash, attempts: result.attempts, nonce: result.header.nonce, ms: Math.round(performance.now() - start) });
      await pause('consensus');
      const w = s.nodes.find((n) => n.id === result.winner)!;
      finish(run, 'consensus', `${w.short} found nonce ${result.header.nonce} after ${result.attempts.toLocaleString()} hashes`);
    }

    // 10. Append
    const block: Block = { header, hash: hash9, txs, receipts, commits };
    const nodesNow = getState().nodes;
    activate(run, 'append', {
      prev: prev ? { number: prev.header.number, hash: prev.hash } : null,
      block: { number: header.number, hash: hash9, prevHash: header.prevHash, stateRoot: header.stateRoot },
      nodes: nodesNow.map((n) => ({ id: n.id, short: n.short, online: n.online, byzantine: n.byzantine, before: n.height, after: n.online ? n.height + 1 : n.height })),
    });
    // Commit to the shared ledger.
    const versions = [...getState().versions];
    if (draft.type === 'upgrade' && mine.status === 'success') {
      versions.push({ version: world.contract.version, codeHash: world.contract.codeHash, source: world.contract.source, block: height, deployedBy: actor.address, note: draft.note });
    }
    const offchain = { ...getState().offchain };
    for (const d of bg.docs) offchain[d.ref] = d;
    setState({
      blocks: [...getState().blocks, block],
      world,
      versions,
      offchain,
      newestBlock: height,
      nodes: nodesNow.map((n) => (n.online ? { ...n, height: n.height + 1 } : n)),
      draftSource: draft.type === 'upgrade' && mine.status === 'success' ? null : getState().draftSource,
    });
    persist();
    if (draft.type === 'upgrade' || draft.method === 'updatePolicy') void refreshContractInfo();
    await pause('append');
    finish(run, 'append', `Block #${height} hash ${hash9.slice(0, 10)}… linked to #${height - 1}`);

    // 11. Receipt
    activate(run, 'receipt', { receipt: mine, blockNumber: height, blockHash: hash9, position: myIndex, txCount: txs.length });
    finish(run, 'receipt', mine.status === 'success' ? 'Final. Status: success' : 'Final. Status: reverted (attempt recorded)', mine.status === 'success' ? 'done' : 'failed');
    patchRun(run.id, (r) => ({
      ...r,
      txHash: hash,
      blockNumber: height,
      outcome:
        mine.status === 'success'
          ? { kind: 'committed', text: `Committed in block #${height}. Every hospital now has the same record.` }
          : { kind: 'reverted', text: `The contract refused it: ${mine.error}. The failed attempt is still in block #${height}, so there is an audit trail.` },
    }));
    toast(mine.status === 'success' ? `${draft.title}: committed in block #${height}` : `${draft.title}: reverted by the contract`, mine.status === 'success' ? 'good' : 'bad');
  } catch (err) {
    console.error(err);
    toast(`Something went wrong: ${(err as Error).message}`, 'bad');
    patchRun(run.id, (r) => ({ ...r, outcome: { kind: 'stalled', text: (err as Error).message } }));
  } finally {
    setState({ busy: false, skip: false, awaitingNext: false });
    nextResolver = null;
  }
}
