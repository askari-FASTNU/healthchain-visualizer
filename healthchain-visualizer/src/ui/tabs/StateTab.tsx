// World state: what every node holds after replaying all blocks, plus off-chain files and the audit log.
import { useMemo, useState } from 'react';
import { sha256Hex } from '../../engine/crypto';
import { stateRoot } from '../../engine/runtime';
import { nameOf, setState, useStore } from '../../engine/store';
import { Hex, Who, preview } from '../components/bits';

export function StateTab() {
  const world = useStore((s) => s.world);
  const blocks = useStore((s) => s.blocks);
  const offchain = useStore((s) => s.offchain);
  const root = useMemo(() => stateRoot(world), [world]);
  const records = world.storage.records ?? {};
  const events = useMemo(
    () =>
      blocks
        .flatMap((b) => b.receipts.flatMap((r, i) => r.events.map((e) => ({ block: b.header.number, from: b.txs[i].from, tx: r.txHash, ...e }))))
        .reverse(),
    [blocks],
  );
  const failures = useMemo(
    () =>
      blocks
        .flatMap((b) => b.receipts.map((r, i) => ({ r, tx: b.txs[i], block: b.header.number })))
        .filter((x) => x.r.status !== 'success')
        .reverse(),
    [blocks],
  );

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div className="grow">
            <h2>World state</h2>
            <p>The result of running every transaction in every block, in order. All honest nodes hold exactly this.</p>
          </div>
        </div>
        <div className="panel-body">
          <table className="data header-table">
            <tbody>
              <tr>
                <th>State root</th>
                <td>
                  <Hex value={root} full />
                </td>
                <td className="muted small">Matches the state root in block #{blocks.length - 1}.</td>
              </tr>
              <tr>
                <th>Contract</th>
                <td>
                  v{world.contract.version}, code hash <Hex value={world.contract.codeHash} />
                </td>
                <td />
              </tr>
              <tr>
                <th>Nonces</th>
                <td colSpan={2}>
                  <div className="chips-light">
                    {Object.entries(world.nonces).map(([a, n]) => (
                      <span key={a} className="tag" title={a}>
                        {nameOf(a)}: {n}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="state-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="grow">
              <h2>Contract storage</h2>
              <p>Expand any branch. Addresses are shown with names.</p>
            </div>
          </div>
          <div className="panel-body">
            <JsonTree value={world.storage} name="state" depth={0} />
          </div>
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <div className="grow">
                <h2>Off-chain storage</h2>
                <p>Documents kept by the hospitals. Each one is checked against its on-chain fingerprint.</p>
              </div>
            </div>
            <div className="panel-body">
              <table className="data">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Fingerprint</th>
                    <th>Integrity</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(offchain).map((d) => {
                    const rec = Object.values<any>(records).find((r) => r.storageRef === d.ref);
                    const ok = rec ? sha256Hex(d.content) === rec.dataHash : null;
                    return (
                      <tr key={d.ref}>
                        <td>
                          {d.title}
                          <div className="muted small">{nameOf(d.patient)}</div>
                        </td>
                        <td>
                          <Hex value={d.hash} />
                        </td>
                        <td>
                          {ok === null ? <span className="status warn">not on chain</span> : ok ? <span className="status good">matches</span> : <span className="status bad">edited</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="grow">
                <h2>Audit log</h2>
                <p>Every event emitted by the contract, newest first. It cannot be edited or deleted.</p>
              </div>
            </div>
            <div className="panel-body audit">
              {failures.length > 0 && (
                <details>
                  <summary>{failures.length} refused attempt{failures.length > 1 ? 's' : ''} recorded</summary>
                  <ul>
                    {failures.map((f) => (
                      <li key={f.tx.hash} className="small">
                        Block #{f.block}: <Who address={f.tx.from} /> tried {f.tx.type === 'upgrade' ? 'a contract upgrade' : `${f.tx.method}()`}: <span className="muted">{f.r.error}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <ul>
                {events.slice(0, 60).map((e, i) => (
                  <li key={i}>
                    <button className="linklike" onClick={() => setState({ tab: 'ledger', selectedBlock: e.block })}>
                      #{e.block}
                    </button>{' '}
                    <strong>{e.name}</strong> <span className="muted small">{preview(e.data, 90)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function JsonTree({ value, name, depth }: { value: any; name: string; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const label = /^0x[0-9a-f]{40}$/.test(name) ? `${nameOf(name)} (${name.slice(0, 8)}…)` : name;
  if (value === null || typeof value !== 'object') {
    return (
      <div className="jt-leaf" style={{ paddingLeft: depth * 14 }}>
        <span className="jt-key">{label}</span>: <span className="jt-val">{typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) ? `${nameOf(value)} (${value.slice(0, 8)}…)` : JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Object.entries(value);
  return (
    <div>
      <button className="jt-branch" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span> <span className="jt-key">{label}</span> <span className="muted small">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span>
      </button>
      {open && entries.map(([k, v]) => <JsonTree key={k} value={v} name={k} depth={depth + 1} />)}
    </div>
  );
}
