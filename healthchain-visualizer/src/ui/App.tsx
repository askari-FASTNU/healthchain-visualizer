import { useEffect, useRef } from 'react';
import { Blocks, FileCode2, Network, Stethoscope, Database } from 'lucide-react';
import { initialise, setState, useStore, type Tab } from '../engine/store';
import { Header } from './Header';
import { Trail } from './Trail';
import { Portal } from './tabs/Portal';
import { ContractTab } from './tabs/ContractTab';
import { Ledger } from './tabs/Ledger';
import { NetworkTab } from './tabs/NetworkTab';
import { StateTab } from './tabs/StateTab';
import { Mark } from './components/bits';

const TABS: { id: Tab; label: string; icon: typeof Blocks }[] = [
  { id: 'portal', label: 'Hospital portal', icon: Stethoscope },
  { id: 'contract', label: 'Smart contract', icon: FileCode2 },
  { id: 'ledger', label: 'Ledger', icon: Blocks },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'state', label: 'World state', icon: Database },
];

export function App() {
  const ready = useStore((s) => s.ready);
  const tab = useStore((s) => s.tab);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void initialise();
  }, []);

  if (!ready) {
    return (
      <div className="loading">
        <div style={{ textAlign: 'center' }}>
          <Mark />
          <h1 style={{ fontSize: 18, marginTop: 10 }}>Building the genesis block</h1>
          <p>Generating keys, deploying the contract and replaying the first blocks…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Header />
      <Trail />
      <main className="main">
        <ChainRibbon />
        <nav className="tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setState({ tab: t.id })}>
              <t.icon aria-hidden /> {t.label}
            </button>
          ))}
        </nav>
        <div className="tab-body" role="tabpanel" key={tab}>
          {tab === 'portal' && <Portal />}
          {tab === 'contract' && <ContractTab />}
          {tab === 'ledger' && <Ledger />}
          {tab === 'network' && <NetworkTab />}
          {tab === 'state' && <StateTab />}
        </div>
      </main>
      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ChainRibbon() {
  const blocks = useStore((s) => s.blocks);
  const newest = useStore((s) => s.newestBlock);
  const selected = useStore((s) => s.selectedBlock);
  const tab = useStore((s) => s.tab);
  const busy = useStore((s) => s.busy);
  const speed = useStore((s) => s.settings.speed);
  const shown = blocks.slice(-8);
  const ref = useRef<HTMLDivElement>(null);
  // Keep the newest block in view.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [blocks.length, busy]);
  return (
    <div className="ribbon" ref={ref} aria-label="Latest blocks" style={{ ['--speed' as string]: speed }}>
      <span className="ribbon-label">Chain</span>
      {blocks.length > shown.length && <span className="ribbon-label">…</span>}
      {shown.map((b, i) => (
        <div key={b.hash} style={{ display: 'flex', alignItems: 'center' }}>
          {i > 0 && <span className="ribbon-link" aria-hidden />}
          <button
            className={`ribbon-block ${b.header.number === newest ? 'newest' : ''} ${tab === 'ledger' && selected === b.header.number ? 'selected' : ''}`}
            onClick={() => setState({ tab: 'ledger', selectedBlock: b.header.number })}
            title={`Block ${b.header.number}: ${b.hash}`}
          >
            <strong>#{b.header.number}</strong>
            <span className="mono">{b.hash.slice(0, 8)}</span>
            <span>
              {b.txs.length} tx{b.txs.length > 1 ? 's' : ''}
            </span>
          </button>
        </div>
      ))}
      {busy && (
        <>
          <span className="ribbon-link" aria-hidden />
          <div className="ribbon-pending">
            <strong>#{blocks.length}</strong>
            <div>being built</div>
          </div>
        </>
      )}
    </div>
  );
}
