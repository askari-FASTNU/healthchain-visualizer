// Read-only view of one patient, built from this node's copy of the world state.
// Reading costs nothing and needs no transaction: the node already has all the data.
import { useState } from 'react';
import { sha256Hex } from '../../engine/crypto';
import { getState, setState, useStore } from '../../engine/store';
import type { OffChainDoc } from '../../engine/types';
import { Hex, Who } from '../components/bits';

export function PatientChart() {
  const world = useStore((s) => s.world);
  const offchain = useStore((s) => s.offchain);
  const patients = world.storage.patients ?? {};
  const ids = Object.keys(patients);
  const [sel, setSel] = useState<string>(ids[0] ?? '');
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const pid = patients[sel] ? sel : ids[0];
  const p = pid ? patients[pid] : null;
  const st = world.storage;

  if (!p) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Patient chart</h2>
        </div>
        <div className="panel-body muted">No patients are registered yet. Act as the node admin and register one.</div>
      </section>
    );
  }

  const consents = Object.entries<any>(st.consents?.[pid] ?? {});
  const emergency = Object.entries<any>(st.emergency?.[pid] ?? {});
  const records = Object.entries<any>(st.records ?? {}).filter(([, r]) => r.patient === pid);
  const rxs = Object.entries<any>(st.prescriptions ?? {}).filter(([, r]) => r.patient === pid);
  const claims = Object.entries<any>(st.claims ?? {}).filter(([, c]) => c.patient === pid);
  const recIds = new Set(records.map(([id]) => id));
  const log = (st.accessLog ?? []).filter((l: any) => recIds.has(l.recordId));

  return (
    <section className="panel chart">
      <div className="panel-head">
        <div className="grow">
          <h2>Patient chart</h2>
          <p>Read from your node's copy of the state. Reading is free; only changes need a transaction.</p>
        </div>
        <select className="select" style={{ width: 'auto' }} value={pid} onChange={(e) => setSel(e.target.value)} aria-label="Patient">
          {ids.map((id) => (
            <option key={id} value={id}>
              {patients[id].name}
            </option>
          ))}
        </select>
      </div>
      <div className="panel-body stack">
        <div className="chart-id">
          <div>
            <strong>{p.name}</strong>
            <span className="muted">
              {' '}
              Age {p.age}, blood group {p.bloodGroup}
            </span>
          </div>
          <div className="small muted">
            Wallet <Hex value={pid} />, registered by {p.registeredBy} in block #{p.block}
          </div>
        </div>

        <ChartSection title="Consent" empty="No provider has consent. Nobody can read or add records.">
          {consents.map(([addr, c]) => (
            <li key={addr}>
              <Who address={addr} /> <span className="muted small">since block #{c.block}</span>
            </li>
          ))}
          {emergency.map(([addr, e]) => (
            <li key={'e' + addr} className="flag">
              <Who address={addr} /> <span className="status warn">emergency access</span> <span className="small muted">"{e.reason}", block #{e.block}</span>
            </li>
          ))}
        </ChartSection>

        <ChartSection title="Records" empty="No records yet.">
          {records.map(([id, r]) => (
            <li key={id}>
              <div className="row">
                <strong>{id}</strong> {r.title} <span className="tag">{r.kind}</span>
                <span className="grow" />
                <button className="btn small" onClick={() => setOpenDoc(openDoc === id ? null : id)}>
                  {openDoc === id ? 'Close' : 'Open document'}
                </button>
              </div>
              <div className="small muted">
                by <Who address={r.author} />, block #{r.block}, fingerprint <Hex value={r.dataHash} />
              </div>
              {openDoc === id && <DocView doc={offchain[r.storageRef]} onChainHash={r.dataHash} />}
            </li>
          ))}
        </ChartSection>

        <ChartSection title="Prescriptions" empty="No prescriptions.">
          {rxs.map(([id, r]) => (
            <li key={id} className="row">
              <strong>{id}</strong> {r.drug} {r.doseMg} mg, {r.timesPerDay}x a day for {r.days} days
              <span className={`status ${r.status === 'active' ? 'info' : 'good'}`}>{r.status}</span>
            </li>
          ))}
        </ChartSection>

        <ChartSection title="Insurance claims" empty="No claims.">
          {claims.map(([id, c]) => (
            <li key={id} className="row">
              <strong>{id}</strong> PKR {c.amount.toLocaleString()} <span className="muted small">{c.description}</span>
              <span className={`status ${c.status === 'approved' ? 'good' : c.status === 'rejected' ? 'bad' : 'warn'}`}>{c.status}</span>
            </li>
          ))}
        </ChartSection>

        <ChartSection title="Access log" empty="Nobody has opened these records yet.">
          {log
            .slice()
            .reverse()
            .slice(0, 8)
            .map((l: any, i: number) => (
              <li key={i} className="small">
                <Who address={l.by} /> opened {l.recordId} in block #{l.block} <span className="muted">"{l.reason}"</span>
              </li>
            ))}
        </ChartSection>
      </div>
    </section>
  );
}

function ChartSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="chart-section">
      <h3>{title}</h3>
      {items.length ? <ul>{children}</ul> : <p className="muted small">{empty}</p>}
    </div>
  );
}

function DocView({ doc, onChainHash }: { doc?: OffChainDoc; onChainHash: string }) {
  if (!doc) return <div className="note warn">The off-chain file is missing from this hospital's storage.</div>;
  const actual = sha256Hex(doc.content);
  const ok = actual === onChainHash;
  const tamper = () => {
    const s = getState();
    const d = s.offchain[doc.ref];
    setState({ offchain: { ...s.offchain, [doc.ref]: { ...d, content: d.content.replace(/\d+/, (n) => String(Number(n) + 40)), original: d.original ?? d.content } as OffChainDoc } });
  };
  const restore = () => {
    const s = getState();
    const d = s.offchain[doc.ref];
    setState({ offchain: { ...s.offchain, [doc.ref]: { ...d, content: d.original ?? d.content, original: undefined } } });
  };
  return (
    <div className="docview">
      <p>{doc.content}</p>
      <div className={`note ${ok ? 'good' : 'bad'}`}>
        {ok ? (
          <>SHA-256 of this file matches the fingerprint on the chain, so it has not been changed since it was recorded.</>
        ) : (
          <>
            The file's SHA-256 is now <Hex value={actual} />, which does not match the on-chain fingerprint <Hex value={onChainHash} />. Someone edited it after it was recorded.
          </>
        )}
      </div>
      <div className="row">
        {ok ? (
          <button className="btn small danger" onClick={tamper}>
            Simulate someone editing the stored file
          </button>
        ) : (
          <button className="btn small" onClick={restore}>
            Restore the original file
          </button>
        )}
      </div>
    </div>
  );
}
