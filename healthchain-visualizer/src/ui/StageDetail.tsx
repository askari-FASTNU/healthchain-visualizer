// What the trail shows inside each stage. Every value comes from the pipeline's real computation.
import { diffLines } from 'diff';
import { ROLE_LABEL } from '../engine/actors';
import { getState, nameOf, setState, type Stage } from '../engine/store';
import type { Receipt, TraceLine } from '../engine/types';
import { Hex, preview } from './components/bits';
import { MerkleTreeView, NetworkGraph, PbftDiagram } from './components/visuals';

export function StageDetail({ stage, live }: { stage: Stage; live: boolean }) {
  const d = stage.data;
  if (!d) return null;
  switch (stage.id) {
    case 'compose':
      return <Compose d={d} />;
    case 'hash':
      return <HashStage d={d} />;
    case 'sign':
      return <Sign d={d} />;
    case 'broadcast':
      return <Broadcast d={d} live={live} />;
    case 'verify':
      return <Verify d={d} />;
    case 'mempool':
      return <Mempool d={d} />;
    case 'execute':
      return <Execute d={d} />;
    case 'block':
      return <BlockStage d={d} live={live} />;
    case 'consensus':
      return d.kind === 'pbft' ? <Pbft d={d} live={live} /> : <Pow d={d} />;
    case 'append':
      return <Append d={d} />;
    case 'receipt':
      return <ReceiptStage d={d} />;
  }
}

function Compose({ d }: { d: any }) {
  const { unsigned, actor, doc, entryNode } = d;
  return (
    <>
      <p className="explain">
        {actor.name} ({ROLE_LABEL[actor.role as keyof typeof ROLE_LABEL] ?? actor.role}, {actor.org}) creates a transaction. It will enter the network through {entryNode}.
      </p>
      {doc && (
        <div className="tnote info">
          The document "{doc.title}" ({doc.size} characters) was saved in the hospital's own off-chain storage as <code>{doc.ref}</code>. Only its SHA-256 fingerprint goes into the transaction, so no patient data is ever written to the chain.
        </div>
      )}
      <pre className="json">{JSON.stringify(unsigned, null, 2)}</pre>
      <p className="why">The nonce is this sender's transaction counter. Each nonce can be used once, so nobody can replay an old transaction (for example, dispensing the same prescription twice).</p>
    </>
  );
}

function HashStage({ d }: { d: any }) {
  const canon: string = d.canonical;
  const i: number = d.tweakIndex;
  // The display copy may hide contract source, so only mark the character when it is still at the same position.
  const showMark = i >= 0 && i < canon.length && canon[i] === d.tweakFrom;
  const differing = [...d.hash].filter((c: string, k: number) => c !== d.tweakedHash[k]).length;
  return (
    <>
      <p className="explain">The transaction is written out as JSON with its keys in a fixed order ({d.bytes} bytes), so every node produces exactly the same bytes, then hashed with SHA-256.</p>
      <div className="codebox">
        {showMark ? (
          <>
            {canon.slice(0, i)}
            <mark>{canon[i]}</mark>
            {canon.slice(i + 1)}
          </>
        ) : (
          canon
        )}
      </div>
      <div className="flow-arrow">SHA-256</div>
      <div className="hashout">
        <Hex value={d.hash} full className="big" />
      </div>
      <div className="tcard">
        <h4>
          Change one character (the highlighted "{d.tweakFrom}" to "{d.tweakTo}")
        </h4>
        <div className="hex diffhex">
          {[...d.tweakedHash].map((c: string, k: number) => (
            <span key={k} className={c === d.hash[k] ? 'hx-same' : 'hx-diff'}>
              {c}
            </span>
          ))}
        </div>
        <p className="why" style={{ marginTop: 6 }}>
          {differing} of 64 hex digits change. This is why a stored hash proves the content was not edited.
        </p>
      </div>
    </>
  );
}

function Sign({ d }: { d: any }) {
  const keccak: string = d.keccak;
  return (
    <>
      {d.forged && (
        <div className="tnote">
          Attack scenario: this transaction claims to be from <Hex value={d.claimedFrom} />, but it is signed with a key the attacker controls.
        </div>
      )}
      <p className="explain">
        {d.signerName}'s private key signs the hash with ECDSA on the secp256k1 curve (the same curve Bitcoin and Ethereum use). Only the key holder can produce this signature; anyone can check it.
      </p>
      <dl className="kv">
        <dt>Private key</dt>
        <dd>
          <span className="hex">{d.privateKey.slice(0, 6)}••••••••••••••••••••••••</span> <span style={{ color: 'var(--t-muted)' }}>never leaves the device</span>
        </dd>
        <dt>Public key</dt>
        <dd>
          <Hex value={d.publicKey} />
        </dd>
        <dt>Keccak-256</dt>
        <dd className="hex">
          {keccak.slice(0, 24)}
          <span style={{ color: 'var(--t-active)' }}>{keccak.slice(24)}</span>
        </dd>
        <dt>Address</dt>
        <dd>
          <span className="hex" style={{ color: 'var(--t-active)' }}>
            {d.address}
          </span>
          <div style={{ color: 'var(--t-muted)', fontSize: 11.5 }}>last 20 bytes of the Keccak-256 hash</div>
        </dd>
      </dl>
      <div className="flow-arrow">signature</div>
      <dl className="kv">
        <dt>r</dt>
        <dd className="hex">{d.signature.r}</dd>
        <dt>s</dt>
        <dd className="hex">{d.signature.s}</dd>
        <dt>v</dt>
        <dd className="hex">{d.signature.v}</dd>
      </dl>
      <p className="why">For a hospital this is non-repudiation: a doctor cannot later deny having written a prescription, and nobody can alter the dose without breaking the signature.</p>
    </>
  );
}

function Broadcast({ d, live }: { d: any; live: boolean }) {
  const entry = d.nodes.find((n: any) => n.id === d.entry);
  return (
    <>
      <p className="explain">
        {entry?.short} sends the signed transaction to every peer it can reach. In a real network each peer forwards it again (gossip) until all nodes have it.
      </p>
      <NetworkGraph nodes={d.nodes} entry={d.entry} animate={live} />
      {d.nodes.some((n: any) => !n.online) && <div className="tnote">Offline nodes do not receive it now. They will download the finished block when they reconnect.</div>}
    </>
  );
}

function Verify({ d }: { d: any }) {
  const labels: string[] = d.rows.find((r: any) => r.online)?.checks.map((c: any) => c.label) ?? [];
  return (
    <>
      <p className="explain">Each hospital checks the transaction itself instead of trusting the node that sent it.</p>
      <table className="ttable reveal-rows">
        <thead>
          <tr>
            <th>Node</th>
            {labels.map((l, i) => (
              <th key={i} title={l}>
                {['Hash', 'Signature', 'Nonce', 'Member'][i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r: any) => (
            <tr key={r.id} className={r.online ? '' : 'off'}>
              <td>{r.short}</td>
              {r.online ? (
                r.checks.map((c: any, i: number) => (
                  <td key={i} className={c.ok ? 'ok' : 'no'} title={c.label}>
                    {c.ok ? '✓' : '✗'}
                  </td>
                ))
              ) : (
                <td colSpan={4}>offline</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="kv">
        <dt>Recovered signer</dt>
        <dd>
          <Hex value={d.recovered ?? 'none'} full />
        </dd>
        <dt>Claimed sender</dt>
        <dd>
          <Hex value={d.claimed} full />
        </dd>
      </dl>
      {d.valid ? (
        <div className="tnote good">The address recovered from the signature matches the sender, so the transaction is authentic and unchanged.</div>
      ) : (
        <div className="tnote">The recovered address does not match the sender. Every honest node drops this transaction.</div>
      )}
    </>
  );
}

function Mempool({ d }: { d: any }) {
  const nodes = getState().nodes;
  return (
    <>
      <p className="explain">
        Verified transactions wait in each node's memory pool.{' '}
        {d.txs.length > 1 ? `${d.txs.length - 1} from other hospitals were already waiting, so they will share the next block.` : 'No other transactions are waiting.'}
      </p>
      <table className="ttable reveal-rows">
        <thead>
          <tr>
            <th>Tx hash</th>
            <th>Action</th>
            <th>From</th>
          </tr>
        </thead>
        <tbody>
          {d.txs.map((t: any) => (
            <tr key={t.hash} className={t.mine ? 'mine' : ''}>
              <td>
                <Hex value={t.hash} />
              </td>
              <td>{t.method}</td>
              <td>
                {nameOf(t.from)}
                <div style={{ color: 'var(--t-muted)' }}>via {nodes.find((n) => n.id === t.node)?.short}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function TraceList({ trace }: { trace: TraceLine[] }) {
  return (
    <ul className="trace">
      {trace.map((t, i) => (
        <li key={i} className={t.ok ? 'ok' : 'no'} style={{ animationDelay: `calc(${i * 220}ms / var(--speed))` }}>
          <span className="ic">{t.ok ? '✓' : '✗'}</span>
          {t.code ? (
            <span>
              <span className="kind">line {t.line}</span>
              <code className="tcode" title={t.code}>
                {t.code.length > 78 ? t.code.slice(0, 77) + '…' : t.code}
              </code>
              {!t.ok && <span className="why-fail">{t.text}</span>}
            </span>
          ) : (
            <span>
              <span className="kind">{t.kind}</span>
              {t.text}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ChangesList({ receipt }: { receipt: Receipt }) {
  if (!receipt.changes.length) return <p style={{ color: 'var(--t-muted)', fontSize: 12.5 }}>No storage changes.</p>;
  return (
    <ul className="changes">
      {receipt.changes.slice(0, 14).map((c, i) => (
        <li key={i}>
          <span className={`op-${c.op}`}>{c.op === 'add' ? '+ ' : c.op === 'remove' ? '− ' : '~ '}</span>
          <span className="path">{shortPath(c.path)}</span>{' '}
          <span className="val">
            {c.op === 'change' ? `${preview(c.before, 24)} → ${preview(c.after, 40)}` : c.op === 'add' ? preview(c.after, 70) : preview(c.before, 40)}
          </span>
        </li>
      ))}
      {receipt.changes.length > 14 && <li className="val">…and {receipt.changes.length - 14} more</li>}
    </ul>
  );
}

function shortPath(p: string) {
  return p.replace(/0x[0-9a-f]{40}/g, (a) => nameOf(a).split(' ').slice(-1)[0] + '(' + a.slice(2, 6) + ')');
}

function Execute({ d }: { d: any }) {
  const r: Receipt = d.receipt;
  const upgrade = d.txType === 'upgrade';
  let added = 0;
  let removed = 0;
  if (upgrade && d.sourceBefore != null && d.sourceAfter != null) {
    for (const part of diffLines(d.sourceBefore, d.sourceAfter)) {
      if (part.added) added += part.count ?? 0;
      if (part.removed) removed += part.count ?? 0;
    }
  }
  return (
    <>
      <p className="explain">
        {d.consensus === 'pbft' ? `${d.executor}, this round's primary, runs` : 'Each mining node runs'} contract v{d.versionBefore} (code hash <Hex value={d.codeHashBefore} />){' '}
        {upgrade ? 'to process a code upgrade' : <>for {d.method}()</>}. Every other node will run the same code and must get the same result.
      </p>
      {upgrade && (
        <div className="tcard">
          <h4>Code upgrade</h4>
          <dl className="kv">
            <dt>Lines</dt>
            <dd>
              <span style={{ color: 'var(--t-done)' }}>+{added}</span> <span style={{ color: 'var(--t-fail)' }}>−{removed}</span>
            </dd>
            <dt>Old code hash</dt>
            <dd>
              <Hex value={d.codeHashBefore} />
            </dd>
            {d.codeHashAfter && (
              <>
                <dt>New code hash</dt>
                <dd>
                  <Hex value={d.codeHashAfter} />
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
      <div className="tcard">
        <h4>Execution trace</h4>
        <TraceList trace={r.trace} />
      </div>
      {r.status === 'success' ? (
        <>
          <div className="tcard">
            <h4>Storage changes</h4>
            <ChangesList receipt={r} />
          </div>
          {r.events.length > 0 && (
            <div className="chips">
              {r.events.map((e, i) => (
                <span key={i} className="tchip event">
                  event {e.name}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="tnote">
          Reverted: {r.error}. All of its storage changes are thrown away, but the transaction itself will still go into the block as a failed attempt.
        </div>
      )}
      <dl className="kv">
        <dt>Gas used</dt>
        <dd>{r.gasUsed.toLocaleString()} (estimated, Ethereum pricing)</dd>
        <dt>State root</dt>
        <dd>
          <Hex value={d.stateRootBefore} /> → <Hex value={d.stateRootAfter} />
        </dd>
      </dl>
    </>
  );
}

function BlockStage({ d, live }: { d: any; live: boolean }) {
  const h = d.header;
  const labels = d.levels[0].map((_: string, i: number) => (i === d.myIndex ? 'yours' : `tx ${i + 1}`));
  return (
    <>
      <p className="explain">
        Transaction hashes are paired and hashed up to a single Merkle root. Changing any transaction changes the root. The highlighted path plus the dashed siblings is all a light client needs to prove your transaction is in the block.
      </p>
      <MerkleTreeView levels={d.levels} highlight={d.myIndex} labels={labels} animate={live} />
      <div className="tcard">
        <h4>Block header #{h.number}</h4>
        <dl className="kv">
          <dt>Previous hash</dt>
          <dd>
            <Hex value={h.prevHash} />
          </dd>
          <dt>Merkle root</dt>
          <dd>
            <Hex value={h.merkleRoot} />
          </dd>
          <dt>State root</dt>
          <dd>
            <Hex value={h.stateRoot} />
          </dd>
          <dt>Timestamp</dt>
          <dd>{new Date(h.timestamp).toLocaleTimeString()}</dd>
          <dt>Consensus</dt>
          <dd>{h.consensus === 'pbft' ? 'PBFT' : `Proof of work, difficulty ${h.difficulty}`}</dd>
        </dl>
      </div>
    </>
  );
}

function Pbft({ d, live }: { d: any; live: boolean }) {
  const res = d.pbft;
  const view = res.views[res.views.length - 1];
  const failedViews = res.views.slice(0, -1);
  const primary = d.nodes.find((n: any) => n.id === view.primary);
  return (
    <>
      <p className="explain">
        PBFT with n = 4 hospitals tolerates f = 1 faulty one. The primary ({primary?.short}) proposes the block, replicas PREPARE once they see the same block, then COMMIT. A block is final after 2f + 1 = 3 matching commits.
      </p>
      {failedViews.map((v: any) => (
        <div key={v.view} className="tnote">
          View {v.view}: {v.failure}
        </div>
      ))}
      <PbftDiagram view={view} nodes={d.nodes} animate={live} />
      {res.committed ? (
        <div className="tnote good">{res.reason}. Red dashed messages carried the wrong block digest and were ignored.</div>
      ) : (
        <div className="tnote">{res.reason}</div>
      )}
      <p className="why">Hospitals know each other, so there is no mining and no wasted energy. Finality is immediate: once committed, the block is never rolled back.</p>
    </>
  );
}

function Pow({ d }: { d: any }) {
  return (
    <>
      <p className="explain">
        Every online node searches for a nonce that makes the block hash start with {d.difficulty} zeros ({d.target}). On average that takes {d.expected.toLocaleString()} attempts. The first node to find one wins and broadcasts the block.
      </p>
      <div className="miners">
        {d.miners.map((m: any) => (
          <div key={m.nodeId} className={`miner ${m.found ? 'won' : ''} ${m.online ? '' : 'off'}`}>
            <span>{m.short}</span>
            <span className="nonce">{m.online ? `nonce ${m.nonce.toLocaleString()}` : 'offline'}</span>
            <span className="hex">
              {m.lastHash ? (
                <>
                  <b>{m.lastHash.slice(0, leadingZeros(m.lastHash))}</b>
                  {m.lastHash.slice(leadingZeros(m.lastHash), 30)}
                </>
              ) : (
                '…'
              )}
            </span>
          </div>
        ))}
      </div>
      {d.winner && (
        <div className="tnote good">
          {d.miners.find((m: any) => m.nodeId === d.winner)?.short} found nonce {d.nonce.toLocaleString()} after {d.attempts.toLocaleString()} hashes across all miners ({d.ms} ms). The others check one hash and accept it.
        </div>
      )}
      <p className="why">Proof of work suits open networks with unknown participants. A hospital consortium knows its members, which is why PBFT is the default here.</p>
    </>
  );
}

function leadingZeros(h: string) {
  let i = 0;
  while (h[i] === '0') i++;
  return i;
}

function Append({ d }: { d: any }) {
  return (
    <>
      <p className="explain">The new block stores the previous block's hash. Editing any old block would change its hash and break every link after it.</p>
      <div className="links">
        {d.prev ? (
          <div className="blk">
            <strong>Block #{d.prev.number}</strong>
            <span className="lbl">hash</span>
            <span className="hex match">{d.prev.hash.slice(0, 12)}</span>
            <span className="hex">…</span>
          </div>
        ) : (
          <div />
        )}
        <div className="arrow">←</div>
        <div className="blk new">
          <strong>Block #{d.block.number}</strong>
          <span className="lbl">previous hash</span>
          <span className="hex match">{d.block.prevHash.slice(0, 12)}</span>
          <span className="hex">…</span>
          <span className="lbl">own hash</span>
          <Hex value={d.block.hash} />
        </div>
      </div>
      <table className="ttable">
        <thead>
          <tr>
            <th>Node</th>
            <th>Chain height</th>
            <th>State root</th>
          </tr>
        </thead>
        <tbody className="reveal-rows">
          {d.nodes.map((n: any) => (
            <tr key={n.id} className={n.online ? '' : 'off'}>
              <td>{n.short}</td>
              <td>{n.online ? `${n.before} → ${n.after}` : `${n.before} (offline, will sync)`}</td>
              <td>{n.online ? <Hex value={d.block.stateRoot} /> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="why">Every online node re-executed the block and reached the same state root, so all hospitals hold identical records.</p>
    </>
  );
}

function ReceiptStage({ d }: { d: any }) {
  const r: Receipt = d.receipt;
  return (
    <>
      <dl className="kv">
        <dt>Status</dt>
        <dd style={{ color: r.status === 'success' ? 'var(--t-done)' : 'var(--t-fail)', fontWeight: 700 }}>{r.status === 'success' ? 'Success' : 'Reverted'}</dd>
        <dt>Block</dt>
        <dd>
          #{d.blockNumber}, position {d.position + 1} of {d.txCount}
        </dd>
        <dt>Block hash</dt>
        <dd>
          <Hex value={d.blockHash} />
        </dd>
        <dt>Gas used</dt>
        <dd>{r.gasUsed.toLocaleString()}</dd>
        <dt>Contract</dt>
        <dd>v{r.contractVersion}</dd>
      </dl>
      {r.events.length > 0 && (
        <div className="tcard">
          <h4>Events (audit log)</h4>
          <ul className="changes">
            {r.events.map((e, i) => (
              <li key={i}>
                <span className="op-add">{e.name}</span> <span className="val">{preview(e.data, 90)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button className="btn small" onClick={() => setState({ tab: 'ledger', selectedBlock: d.blockNumber })}>
        Open block #{d.blockNumber} in the ledger
      </button>
    </>
  );
}
