// The four hospital validators, consensus settings and the attack scenarios.
import { MY_NODE_ID, ROLE_LABEL } from '../../engine/actors';
import { QUORUM } from '../../engine/consensus';
import { setNodeByzantine, setNodeOnline, setState, updateSettings, useStore } from '../../engine/store';
import type { Role } from '../../engine/types';
import { Hex, RoleTag } from '../components/bits';
import { NetworkGraph } from '../components/visuals';

const EMPTY = {};

export function NetworkTab() {
  const nodes = useStore((s) => s.nodes);
  const blocks = useStore((s) => s.blocks);
  const settings = useStore((s) => s.settings);
  const busy = useStore((s) => s.busy);
  const forgeNext = useStore((s) => s.forgeNext);
  const members = useStore((s) => s.world.storage.members ?? EMPTY);
  const actors = useStore((s) => s.actors);
  const height = blocks.length;
  const honest = nodes.filter((n) => n.online && !n.byzantine).length;
  const nextPrimary = nodes[height % 4];

  const preset = (fn: () => void) => () => {
    for (const n of nodes) {
      if (!n.online) setNodeOnline(n.id, true);
      if (n.byzantine) setNodeByzantine(n.id, false);
    }
    fn();
  };

  return (
    <div className="network stack">
      <div className="net-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="grow">
              <h2>Hospital validator nodes</h2>
              <p>Each hospital runs a full copy of the chain and votes in consensus.</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="monitor">
              <NetworkGraph nodes={nodes} entry={MY_NODE_ID} animate={false} labelEntry="your node" />
            </div>
            <div className={`note ${honest >= QUORUM ? 'good' : 'bad'}`} style={{ marginTop: 12 }}>
              {honest} of 4 nodes are online and honest. PBFT needs {QUORUM} (2f + 1 with f = 1) to commit a block.{' '}
              {honest >= QUORUM ? 'The network can make progress.' : 'New blocks will not be committed until enough nodes return.'}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Scenarios</h2>
          </div>
          <div className="panel-body stack">
            <Scenario
              title="Forged signature"
              text="The next transaction claims to come from the person you act as, but is signed with someone else's key. Every node rejects it at verification."
              action={forgeNext ? 'Armed for the next transaction' : 'Arm for the next transaction'}
              disabled={busy || forgeNext}
              onClick={() => setState({ forgeNext: true, tab: 'portal' })}
            />
            <Scenario
              title="One faulty hospital"
              text="Summit sends wrong PREPARE and COMMIT messages. The three honest hospitals still reach 3 commits, so the block goes through."
              action="Make Summit faulty"
              disabled={busy}
              onClick={preset(() => {
                setNodeByzantine(4, true);
                updateSettings({ consensus: 'pbft' });
              })}
            />
            <Scenario
              title="Faulty primary"
              text={`The next block's primary is ${nextPrimary.short}. If it lies, the replicas notice and elect the next hospital as primary (a view change).`}
              action={`Make ${nextPrimary.short} faulty`}
              disabled={busy}
              onClick={preset(() => {
                setNodeByzantine(nextPrimary.id, true);
                updateSettings({ consensus: 'pbft' });
              })}
            />
            <Scenario
              title="Two hospitals offline"
              text="Only 2 of 4 nodes remain, below the quorum of 3. PBFT refuses to commit anything rather than risk two different histories."
              action="Take Riverside and Summit offline"
              disabled={busy}
              onClick={preset(() => {
                setNodeOnline(3, false);
                setNodeOnline(4, false);
                updateSettings({ consensus: 'pbft' });
              })}
            />
            <Scenario
              title="Tampering with history"
              text="Edit an old transaction in your copy of the ledger and watch the hashes and links break."
              action="Open the ledger"
              onClick={() => setState({ tab: 'ledger' })}
            />
            <button className="btn" onClick={preset(() => undefined)} disabled={busy}>
              Bring every node back to normal
            </button>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div className="grow">
            <h2>Node controls</h2>
            <p>Switch nodes off or make them misbehave, then submit a transaction from the portal.</p>
          </div>
          <label className="control">
            <span>Proof-of-work difficulty</span>
            <select className="select" style={{ width: 'auto' }} value={settings.difficulty} onChange={(e) => updateSettings({ difficulty: Number(e.target.value) })} disabled={busy}>
              {[2, 3, 4, 5].map((d) => (
                <option key={d} value={d}>
                  {d} leading zeros (about {Math.pow(16, d).toLocaleString()} hashes)
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panel-body">
          <table className="data">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Chain height</th>
                <th>Latest block</th>
                <th>Next PBFT primary</th>
                <th>Online</th>
                <th>Faulty (Byzantine)</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id}>
                  <td>
                    <strong>{n.name}</strong>
                    {n.id === MY_NODE_ID && <span className="muted small"> (your node)</span>}
                  </td>
                  <td>
                    {n.height}
                    {n.height < height && <span className="status warn"> {height - n.height} behind</span>}
                  </td>
                  <td>{n.height > 0 ? <Hex value={blocks[n.height - 1]?.hash ?? ''} /> : '—'}</td>
                  <td>{n.id === nextPrimary.id ? <span className="status info">next primary</span> : ''}</td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={n.online} onChange={(e) => setNodeOnline(n.id, e.target.checked)} disabled={busy} />
                      <span className="track" />
                      {n.online ? 'Online' : 'Offline'}
                    </label>
                  </td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={n.byzantine} onChange={(e) => setNodeByzantine(n.id, e.target.checked)} disabled={busy} />
                      <span className="track" />
                      {n.byzantine ? 'Faulty' : 'Honest'}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="grow">
            <h2>Network members</h2>
            <p>A permissioned chain: only these addresses may send transactions. The admin adds members with addMember().</p>
          </div>
        </div>
        <div className="panel-body">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Organisation</th>
                <th>Address</th>
                <th>Connects through</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries<any>(members).map(([addr, m]) => {
                const a = actors.find((x) => x.address === addr);
                return (
                  <tr key={addr}>
                    <td>{m.name}</td>
                    <td>
                      <RoleTag role={m.role} label={ROLE_LABEL[m.role as Role]} />
                    </td>
                    <td>{m.org}</td>
                    <td>
                      <Hex value={addr} full />
                    </td>
                    <td>{nodes.find((n) => n.id === a?.nodeId)?.short ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Scenario({ title, text, action, onClick, disabled }: { title: string; text: string; action: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="scenario">
      <div className="grow">
        <strong>{title}</strong>
        <p className="muted small">{text}</p>
      </div>
      <button className="btn small" onClick={onClick} disabled={disabled}>
        {action}
      </button>
    </div>
  );
}
