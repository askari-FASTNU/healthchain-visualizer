import { RotateCcw } from 'lucide-react';
import { MY_NODE_ID } from '../engine/actors';
import { initialise, setState, updateSettings, useStore } from '../engine/store';
import { Mark } from './components/bits';

export function Header() {
  const settings = useStore((s) => s.settings);
  const nodes = useStore((s) => s.nodes);
  const busy = useStore((s) => s.busy);
  const forgeNext = useStore((s) => s.forgeNext);
  const height = useStore((s) => s.blocks.length);
  const me = nodes.find((n) => n.id === MY_NODE_ID)!;

  return (
    <header className="topbar">
      <div className="brand">
        <Mark />
        <div>
          <h1>HealthChain Visualizer</h1>
          <p>A permissioned hospital blockchain, step by step</p>
        </div>
      </div>
      <div className="my-node" title="You operate this validator node and hold the contract admin role">
        <span className="pulse-dot" style={me.online ? undefined : { background: 'var(--bad)', boxShadow: 'none' }} />
        <span>
          Your node: <strong>{me.name.replace(' Hospital', '')}</strong>, height {height}
        </span>
      </div>
      <div className="spacer" />
      <div className="control">
        <span>Consensus</span>
        <div className="seg" role="group" aria-label="Consensus algorithm">
          <button aria-pressed={settings.consensus === 'pbft'} onClick={() => updateSettings({ consensus: 'pbft' })} disabled={busy}>
            PBFT
          </button>
          <button title="Proof of work" aria-pressed={settings.consensus === 'pow'} onClick={() => updateSettings({ consensus: 'pow' })} disabled={busy}>
            PoW
          </button>
        </div>
      </div>
      <div className="control">
        <label htmlFor="speed">Speed</label>
        <select id="speed" className="select" style={{ width: 'auto', padding: '4px 6px' }} value={settings.speed} onChange={(e) => updateSettings({ speed: Number(e.target.value) })}>
          {[0.5, 1, 2, 4].map((v) => (
            <option key={v} value={v}>
              {v}x
            </option>
          ))}
        </select>
      </div>
      <label className="switch" title="Pause after every stage so you can explain it">
        <input type="checkbox" checked={settings.stepMode} onChange={(e) => updateSettings({ stepMode: e.target.checked })} />
        <span className="track" />
        Step by step
      </label>
      <label className="switch" title="Transactions from other hospitals share your block, so the Merkle tree has several leaves">
        <input type="checkbox" checked={settings.traffic} onChange={(e) => updateSettings({ traffic: e.target.checked })} disabled={busy} />
        <span className="track" />
        Other hospitals
      </label>
      {forgeNext && (
        <button className="btn small danger" onClick={() => setState({ forgeNext: false })} title="Cancel the forged-signature scenario">
          Next transaction will be forged
        </button>
      )}
      <button
        className="btn small ghost"
        disabled={busy}
        onClick={() => {
          if (confirmReset()) void initialise(true);
        }}
        title="Start again from the genesis block"
      >
        <RotateCcw /> Reset
      </button>
    </header>
  );
}

function confirmReset() {
  try {
    return window.confirm('Reset the network? This rebuilds the chain from the genesis block and discards contract upgrades.');
  } catch {
    return true;
  }
}
