// Block explorer, full-chain verification and the "tamper with history" demonstration.
import { useMemo, useState } from 'react';
import { validateChain, type BlockCheck } from '../../engine/chain';
import { MY_NODE_ID } from '../../engine/actors';
import { setState, useStore } from '../../engine/store';
import type { Block, SignedTx } from '../../engine/types';
import { Hex, Json, Who, preview, timeAgo } from '../components/bits';
import { MerkleTreeView } from '../components/visuals';
import { buildMerkleTree } from '../../engine/merkle';
import { TraceList, ChangesList } from '../StageDetail';

export function Ledger() {
  const blocks = useStore((s) => s.blocks);
  const selected = useStore((s) => s.selectedBlock);
  const nodes = useStore((s) => s.nodes);
  const idx = selected ?? blocks.length - 1;
  const block = blocks[Math.min(Math.max(idx, 0), blocks.length - 1)];
  const [checks, setChecks] = useState<BlockCheck[] | null>(null);
  const [tamper, setTamper] = useState<{ block: number; tx: number; args: any } | null>(null);

  return (
    <div className="ledger">
      <aside className="blist" aria-label="Blocks">
        <div className="row" style={{ padding: '0 0 10px' }}>
          <button className="btn small" onClick={() => setChecks(validateChain(blocks))}>
            Verify the whole chain
          </button>
        </div>
        {checks && (
          <div className={`note ${checks.every((c) => !c.problems.length) ? 'good' : 'bad'}`} style={{ marginBottom: 10 }}>
            {checks.every((c) => !c.problems.length)
              ? `All ${checks.length} blocks pass: transaction hashes, signatures, Merkle roots, block hashes and links.`
              : `${checks.filter((c) => c.problems.length).length} blocks have problems.`}
          </div>
        )}
        <ol>
          {[...blocks].reverse().map((b) => (
            <li key={b.hash}>
              <button className={b === block ? 'on' : ''} onClick={() => setState({ selectedBlock: b.header.number })}>
                <span className="row" style={{ gap: 6 }}>
                  <strong>Block #{b.header.number}</strong>
                  <span className="grow" />
                  <span className="muted small">{timeAgo(b.header.timestamp)}</span>
                </span>
                <Hex value={b.hash} />
                <span className="small muted">
                  {b.txs.length} tx{b.txs.length > 1 ? 's' : ''}, {b.header.consensus === 'genesis' ? 'genesis' : b.header.consensus === 'pbft' ? 'PBFT' : 'PoW'}, by {nodes.find((n) => n.id === b.header.proposer)?.short}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <div className="bdetail stack">
        {block && <BlockDetail block={block} onTamper={(tx) => setTamper({ block: block.header.number, tx, args: block.txs[tx].args })} />}
        {tamper && <TamperLab key={`${tamper.block}-${tamper.tx}`} blocks={blocks} tamper={tamper} onChange={setTamper} />}
      </div>
    </div>
  );
}

function BlockDetail({ block, onTamper }: { block: Block; onTamper: (tx: number) => void }) {
  const nodes = useStore((s) => s.nodes);
  const h = block.header;
  const levels = useMemo(() => buildMerkleTree(block.txs.map((t) => t.hash)).levels, [block]);
  const proposer = nodes.find((n) => n.id === h.proposer);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div className="grow">
            <h2>Block #{h.number}</h2>
            <p>
              <Hex value={block.hash} full />
            </p>
          </div>
          {h.number > 0 && (
            <button className="btn small" onClick={() => setState({ selectedBlock: h.number - 1 })}>
              Previous block
            </button>
          )}
        </div>
        <div className="panel-body">
          <table className="data header-table">
            <tbody>
              <tr>
                <th>Previous hash</th>
                <td>
                  <Hex value={h.prevHash} full />
                </td>
                <td className="muted small">Links this block to the one before. Changing an older block breaks this link.</td>
              </tr>
              <tr>
                <th>Merkle root</th>
                <td>
                  <Hex value={h.merkleRoot} full />
                </td>
                <td className="muted small">One hash that summarises every transaction in the block.</td>
              </tr>
              <tr>
                <th>State root</th>
                <td>
                  <Hex value={h.stateRoot} full />
                </td>
                <td className="muted small">Hash of the whole world state after this block. Nodes compare it to prove they agree.</td>
              </tr>
              <tr>
                <th>Proposer</th>
                <td>{h.consensus === 'genesis' ? 'Network founders' : proposer?.name}</td>
                <td className="muted small">{h.consensus === 'pow' ? 'The node that found the nonce first.' : 'The PBFT primary for this round.'}</td>
              </tr>
              <tr>
                <th>Consensus</th>
                <td>
                  {h.consensus === 'pow' ? `Proof of work, difficulty ${h.difficulty}, nonce ${h.nonce.toLocaleString()}` : h.consensus === 'pbft' ? 'PBFT' : 'Genesis'}
                </td>
                <td className="muted small">
                  {h.consensus === 'pow' ? 'Hash starts with the required zeros.' : `Committed by ${block.commits.map((c) => nodes.find((n) => n.id === c)?.short).join(', ')}.`}
                </td>
              </tr>
              <tr>
                <th>Time</th>
                <td>{new Date(h.timestamp).toLocaleString()}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Transactions ({block.txs.length})</h2>
        </div>
        <div className="panel-body stack">
          <div className="monitor">
            <MerkleTreeView levels={levels} labels={block.txs.map((_, i) => `tx ${i + 1}`)} width={Math.max(360, block.txs.length * 120)} animate={false} />
          </div>
          {block.txs.map((t, i) => (
            <TxRow key={t.hash} tx={t} index={i} block={block} onTamper={() => onTamper(i)} />
          ))}
        </div>
      </section>
    </>
  );
}

function TxRow({ tx, index, block, onTamper }: { tx: SignedTx; index: number; block: Block; onTamper: () => void }) {
  const [open, setOpen] = useState(false);
  const r = block.receipts[index];
  const label = tx.type === 'deploy' ? 'deploy contract' : tx.type === 'upgrade' ? 'upgrade contract' : `${tx.method}()`;
  return (
    <div className={`txrow ${open ? 'open' : ''}`}>
      <button className="txrow-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="muted small">tx {index + 1}</span>
        <span className="mono">{label}</span>
        <span className="small">
          <Who address={tx.from} />
        </span>
        <span className="grow" />
        <span className={`status ${r?.status === 'success' ? 'good' : 'bad'}`}>{r?.status === 'success' ? 'success' : 'reverted'}</span>
        <Hex value={tx.hash} />
      </button>
      {open && (
        <div className="txrow-body stack">
          {r?.error && <div className="note bad">Reverted: {r.error}</div>}
          <div className="two-col">
            <div className="stack">
              <h4>Signed content</h4>
              <Json value={{ ...tx, source: tx.source ? `<${tx.source.length} characters of code>` : undefined, hash: undefined, signature: undefined }} maxHeight={220} />
              <dl className="kv light">
                <dt>Signature r</dt>
                <dd className="hex">{tx.signature.r}</dd>
                <dt>Signature s</dt>
                <dd className="hex">{tx.signature.s}</dd>
                <dt>Recovery v</dt>
                <dd className="hex">{tx.signature.v}</dd>
              </dl>
            </div>
            <div className="stack monitor small-monitor">
              <h4>Execution</h4>
              {r && <TraceList trace={r.trace} />}
              {r && r.status === 'success' && <ChangesList receipt={r} />}
              {r?.events.map((e, i) => (
                <div key={i} className="small">
                  <span style={{ color: 'var(--t-done)' }}>event {e.name}</span> <span style={{ color: 'var(--t-muted)' }}>{preview(e.data, 80)}</span>
                </div>
              ))}
            </div>
          </div>
          {tx.type === 'call' && (
            <div className="row">
              <button className="btn small danger" onClick={onTamper}>
                Tamper with this transaction
              </button>
              <span className="muted small">See what happens if someone edits it in their copy of the ledger.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TamperLab({ blocks, tamper, onChange }: { blocks: Block[]; tamper: { block: number; tx: number; args: any }; onChange: (t: { block: number; tx: number; args: any } | null) => void }) {
  const nodes = useStore((s) => s.nodes);
  const [text, setText] = useState(() => JSON.stringify(tamper.args, null, 2));
  const [applied, setApplied] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const original = blocks[tamper.block].txs[tamper.tx];

  const tampered = useMemo(() => {
    if (applied === null) return null;
    return blocks.map((b) =>
      b.header.number !== tamper.block ? b : { ...b, txs: b.txs.map((t, i) => (i === tamper.tx ? { ...t, args: applied } : t)) },
    );
  }, [applied, blocks, tamper]);
  const results = useMemo(() => (tampered ? validateChain(tampered) : null), [tampered]);
  const firstBad = results?.findIndex((r) => r.problems.length) ?? -1;
  const myHead = results?.[results.length - 1]?.computedHash;
  const honestHead = blocks[blocks.length - 1].hash;

  const apply = () => {
    try {
      setApplied(JSON.parse(text));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <section className="panel tamper">
      <div className="panel-head">
        <div className="grow">
          <h2>
            Tamper lab: block #{tamper.block}, tx {tamper.tx + 1} ({original.method}())
          </h2>
          <p>You edit this transaction in your own node's copy only. Nothing is re-signed, because you do not have the sender's private key.</p>
        </div>
        <button className="btn small" onClick={() => onChange(null)}>
          Close and restore
        </button>
      </div>
      <div className="panel-body stack">
        <div className="two-col">
          <label className="field">
            <span>Arguments, as stored in the block</span>
            <textarea className="textarea code" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
            <small>Try changing a dose, an amount or a patient address.</small>
          </label>
          <div className="stack">
            <button className="btn danger" onClick={apply}>
              Write the change into my copy
            </button>
            {err && <div className="note bad">Not valid JSON: {err}</div>}
            {applied !== null && results && (
              <>
                {firstBad < 0 ? (
                  <div className="note">Nothing changed yet: the arguments are identical to the original.</div>
                ) : (
                  <div className="note bad">
                    Block #{firstBad} no longer verifies: {results[firstBad].problems.join('; ')}.
                    {firstBad < blocks.length - 1 && ` Block #${firstBad + 1} still points to the old hash, so the chain is broken from here on.`}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {results && firstBad >= 0 && (
          <>
            <div className="chaincheck">
              {results.map((r, i) => (
                <div key={r.number} className="cc-item">
                  {i > 0 && <div className={`cc-link ${r.linkOk ? 'ok' : 'bad'}`}>{r.linkOk ? 'linked' : 'broken'}</div>}
                  <div className={`cc-block ${r.problems.length ? 'bad' : 'ok'} ${r.number === tamper.block ? 'edited' : ''}`}>
                    <strong>#{r.number}</strong>
                    <Hex value={r.computedHash} />
                    <span className="small">{r.number === tamper.block ? 'edited' : r.problems.length ? 'link broken' : 'valid'}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="consensus-vote">
              <h3>What the other hospitals say</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Latest block hash</th>
                    <th>Agrees with your copy?</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => {
                    const mine = n.id === MY_NODE_ID;
                    return (
                      <tr key={n.id}>
                        <td>
                          {n.short}
                          {mine ? ' (you)' : ''}
                        </td>
                        <td>
                          <Hex value={mine ? myHead! : honestHead} />
                        </td>
                        <td>{mine ? '—' : <span className="status bad">No</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small" style={{ marginTop: 8 }}>
                Three hospitals hold the original chain and their signed PBFT commits match it. Your edited copy is outvoted 3 to 1, so your node throws it away and downloads the honest chain again. To make the edit stick you would need to rewrite every later block and control at least 3 of the 4 hospitals.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
