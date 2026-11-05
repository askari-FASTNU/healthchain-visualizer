// The dynamic smart contract. As the admin of your node you can change who may do what (permissions),
// the numbers and switches the code reads (rules), or the code itself (upgrade). Each change is a transaction.
import { useEffect, useMemo, useState } from 'react';
import { CONTRACT_EXAMPLES } from '../../engine/contractSource';
import { submitTx } from '../../engine/pipeline';
import { inspectContract, type ContractInfo } from '../../engine/runtime';
import { setState, toast, useStore } from '../../engine/store';
import { ROLES, type Role } from '../../engine/types';
import { ROLE_LABEL } from '../../engine/actors';
import { Hex, Who, roleColor } from '../components/bits';
import { CodeEditor } from '../components/CodeEditor';
import { DiffView } from '../components/DiffView';

type Sub = 'permissions' | 'rules' | 'source' | 'versions';

const EMPTY = {};

const PARAM_INFO: Record<string, { label: string; help: string; unit?: string }> = {
  consentRequired: { label: 'Patient consent required', help: 'Providers need the patient’s consent before they can add or open records, or prescribe.' },
  emergencyAccessEnabled: { label: 'Emergency access allowed', help: 'Doctors may use break-glass access without consent. Every use is flagged in the audit log.' },
  maxDailyDoseMg: { label: 'Maximum daily dose', help: 'A prescription is refused if dose × times per day is above this.', unit: 'mg' },
  claimAutoApproveLimit: { label: 'Claim auto-approve limit', help: 'Claims up to this amount are approved by the contract without an insurer.', unit: 'PKR' },
  minEmergencyReasonLength: { label: 'Emergency reason length', help: 'Minimum number of characters in the reason for emergency access.', unit: 'characters' },
  consentValidityBlocks: { label: 'Consent validity', help: 'Consent stops working this many blocks after it was given.', unit: 'blocks' },
};

export function ContractTab() {
  const [sub, setSub] = useState<Sub>('permissions');
  const world = useStore((s) => s.world);
  const versions = useStore((s) => s.versions);
  const info = useStore((s) => s.contractInfo);
  const current = versions[versions.length - 1];
  const [signAs, setSignAs] = useState('admin');

  return (
    <div className="stack contract">
      <section className="panel">
        <div className="panel-head">
          <div className="grow">
            <h2>
              {info.name ?? 'Contract'} v{world.contract.version}
            </h2>
            <p>
              Code hash <Hex value={world.contract.codeHash} />, deployed in block #{current?.block} by {current ? <Who address={current.deployedBy} /> : '—'}. {info.methods.length} methods.
            </p>
          </div>
          <SignAs value={signAs} onChange={setSignAs} />
        </div>
        <div className="panel-body">
          <p className="muted small" style={{ maxWidth: 760 }}>
            You run Northgate General's node and hold the admin role, so you can change this contract. A change is not applied locally: it is sent as a transaction, every hospital runs it through consensus, and only then does the new behaviour take effect everywhere. Watch the trail on the left when you submit.
          </p>
        </div>
        <nav className="subtabs" role="tablist">
          {(
            [
              ['permissions', 'Permissions'],
              ['rules', 'Rules'],
              ['source', 'Source code'],
              ['versions', `Version history (${versions.length})`],
            ] as [Sub, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={sub === id} onClick={() => setSub(id)}>
              {label}
            </button>
          ))}
        </nav>
      </section>
      {sub === 'permissions' && <Permissions signAs={signAs} info={info} />}
      {sub === 'rules' && <Rules signAs={signAs} />}
      {sub === 'source' && <Source signAs={signAs} />}
      {sub === 'versions' && <Versions onLoad={() => setSub('source')} />}
    </div>
  );
}

function SignAs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const actors = useStore((s) => s.actors);
  return (
    <label className="control" title="Changes are signed by this identity. Try a non-admin to see the contract refuse.">
      <span>Sign changes as</span>
      <select className="select" style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Permissions({ signAs, info }: { signAs: string; info: ContractInfo }) {
  const perms: Record<string, string[]> = useStore((s) => s.world.storage.policy?.permissions ?? EMPTY);
  const busy = useStore((s) => s.busy);
  const [draft, setDraft] = useState<Record<string, string[]>>(() => structuredClone(perms));
  const methods = useMemo(() => Array.from(new Set([...info.methods.map((m) => m.name), ...Object.keys(perms)])), [info, perms]);
  const changed = methods.filter((m) => [...(draft[m] ?? [])].sort().join() !== [...(perms[m] ?? [])].sort().join());

  // When the chain changes underneath (a policy update committed), start from the new values.
  useEffect(() => setDraft(structuredClone(perms)), [perms]);

  const toggle = (m: string, r: Role) => {
    const cur = draft[m] ?? [];
    setDraft({ ...draft, [m]: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] });
  };
  const lockout = !(draft.updatePolicy ?? []).includes('admin');

  const submit = () => {
    const patch = Object.fromEntries(changed.map((m) => [m, ROLES.filter((r) => (draft[m] ?? []).includes(r))]));
    void submitTx({ actorId: signAs, type: 'call', method: 'updatePolicy', args: { permissions: patch }, title: `Change permissions for ${changed.join(', ')}` });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="grow">
          <h2>Who may call each method</h2>
          <p>Stored on-chain in policy.permissions and checked by guard() before every call.</p>
        </div>
      </div>
      <div className="panel-body stack">
        <div className="perm-scroll">
          <table className="perm">
            <thead>
              <tr>
                <th>Method</th>
                {ROLES.map((r) => (
                  <th key={r}>
                    <span className="perm-role" style={{ borderColor: roleColor(r) }}>
                      {ROLE_LABEL[r]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m}>
                  <td className="mono">{m}()</td>
                  {ROLES.map((r) => {
                    const on = (draft[m] ?? []).includes(r);
                    const was = (perms[m] ?? []).includes(r);
                    return (
                      <td key={r} className={on !== was ? 'dirty' : ''}>
                        <input type="checkbox" checked={on} onChange={() => toggle(m, r)} aria-label={`${ROLE_LABEL[r]} may call ${m}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lockout && <div className="note warn">Removing the admin role from updatePolicy locks every admin out of policy changes. Only a code upgrade could undo it.</div>}
        <div className="row">
          <button className="btn primary" disabled={!changed.length || busy} onClick={submit}>
            Submit {changed.length || ''} permission change{changed.length === 1 ? '' : 's'}
          </button>
          <button className="btn" disabled={!changed.length} onClick={() => setDraft(structuredClone(perms))}>
            Discard
          </button>
          <span className="muted small">Example: let nurses use emergency access, then switch to Nurse Sana in the portal and try it.</span>
        </div>
      </div>
    </section>
  );
}

function Rules({ signAs }: { signAs: string }) {
  const params: Record<string, any> = useStore((s) => s.world.storage.policy?.params ?? EMPTY);
  const busy = useStore((s) => s.busy);
  const [draft, setDraft] = useState<Record<string, any>>(() => ({ ...params }));
  useEffect(() => setDraft({ ...params }), [params]);
  const changed = Object.keys(params).filter((k) => draft[k] !== params[k]);

  const submit = () => {
    const patch = Object.fromEntries(changed.map((k) => [k, draft[k]]));
    void submitTx({ actorId: signAs, type: 'call', method: 'updatePolicy', args: { params: patch }, title: `Change rule${changed.length > 1 ? 's' : ''}: ${changed.join(', ')}` });
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="grow">
          <h2>Rules the contract enforces</h2>
          <p>Values in policy.params. The contract code reads them on every call.</p>
        </div>
      </div>
      <div className="panel-body stack">
        <div className="rules">
          {Object.entries(params).map(([k, v]) => {
            const meta = PARAM_INFO[k];
            const dirty = draft[k] !== v;
            return (
              <div key={k} className={`rule ${dirty ? 'dirty' : ''}`}>
                <div className="grow">
                  <strong>{meta?.label ?? k}</strong>
                  <p className="muted small">
                    {meta?.help ?? 'A parameter added by a contract upgrade.'} <code>{k}</code>
                  </p>
                </div>
                {typeof v === 'boolean' ? (
                  <label className="switch">
                    <input type="checkbox" checked={Boolean(draft[k])} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
                    <span className="track" />
                    {draft[k] ? 'On' : 'Off'}
                  </label>
                ) : typeof v === 'number' ? (
                  <label className="row" style={{ gap: 6 }}>
                    <input className="input" style={{ width: 120 }} type="number" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === '' ? '' : Number(e.target.value) })} />
                    <span className="muted small">{meta?.unit}</span>
                  </label>
                ) : (
                  <input className="input" style={{ width: 200 }} value={String(draft[k])} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                )}
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="btn primary" disabled={!changed.length || busy} onClick={submit}>
            Submit {changed.length || ''} rule change{changed.length === 1 ? '' : 's'}
          </button>
          <button className="btn" disabled={!changed.length} onClick={() => setDraft({ ...params })}>
            Discard
          </button>
          <span className="muted small">Example: lower the daily dose limit to 1000 mg, then prescribe Paracetamol 500 mg three times a day.</span>
        </div>
      </div>
    </section>
  );
}

function Source({ signAs }: { signAs: string }) {
  const deployed = useStore((s) => s.world.contract.source);
  const version = useStore((s) => s.world.contract.version);
  const draftSource = useStore((s) => s.draftSource);
  const busy = useStore((s) => s.busy);
  const code = draftSource ?? deployed;
  const [check, setCheck] = useState<ContractInfo | null>(null);
  const [note, setNote] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const dirty = code !== deployed;

  const setCode = (v: string) => {
    setState({ draftSource: v === deployed ? null : v });
    setCheck(null);
  };

  const runCheck = async () => {
    const r = await inspectContract(code);
    setCheck(r);
    return r;
  };

  const deploy = async () => {
    const r = await runCheck();
    if (!r.ok) {
      toast('Fix the error before deploying. Deploying broken code would only produce a reverted transaction.', 'bad');
      return;
    }
    void submitTx({ actorId: signAs, type: 'upgrade', source: code, note: note || `Upgrade to v${version + 1}`, title: `Upgrade contract to v${version + 1}` });
    setNote('');
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="grow">
          <h2>Contract source</h2>
          <p>JavaScript that every node runs in a sandbox. Edit it and deploy it as a new version; existing storage carries over.</p>
        </div>
        <label className="control">
          <span>Load an example change</span>
          <select
            className="select"
            style={{ width: 'auto' }}
            value=""
            onChange={(e) => {
              const ex = CONTRACT_EXAMPLES.find((x) => x.id === e.target.value);
              if (!ex) return;
              const next = ex.apply(code);
              if (next === null) toast('That change is already in the code.', 'info');
              else {
                setCode(next);
                setShowDiff(true);
                toast(`${ex.title}: ${ex.description}`, 'info');
              }
            }}
          >
            <option value="">Choose…</option>
            {CONTRACT_EXAMPLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="source-wrap">
        <CodeEditor value={code} onChange={setCode} />
      </div>
      <div className="panel-body stack">
        {check && (check.ok ? <div className="note good">Code loads. Contract "{check.name}" with methods: {check.methods.map((m) => m.name).join(', ')}.</div> : <div className="note bad">{check.error}</div>)}
        {dirty && (
          <div>
            <button className="linklike" onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? 'Hide' : 'Show'} changes against deployed v{version}
            </button>
            {showDiff && <DiffView before={deployed} after={code} />}
          </div>
        )}
        <div className="row">
          <input className="input" style={{ maxWidth: 360 }} placeholder="What does this change do?" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Change description" />
          <button className="btn" onClick={() => void runCheck()}>
            Check code
          </button>
          <button className="btn primary" disabled={!dirty || busy} onClick={() => void deploy()}>
            Deploy as v{version + 1}
          </button>
          <button className="btn" disabled={!dirty} onClick={() => setCode(deployed)}>
            Discard edits
          </button>
        </div>
      </div>
    </section>
  );
}

function Versions({ onLoad }: { onLoad: () => void }) {
  const versions = useStore((s) => s.versions);
  const [sel, setSel] = useState(versions.length - 1);
  const v = versions[Math.min(sel, versions.length - 1)];
  const prev = versions[Math.min(sel, versions.length - 1) - 1];
  return (
    <section className="panel versions">
      <div className="panel-head">
        <div className="grow">
          <h2>Version history</h2>
          <p>Each version is a transaction in a block, so who changed the contract, when and how is permanent.</p>
        </div>
      </div>
      <div className="versions-grid">
        <ul className="vlist">
          {versions
            .map((x, i) => ({ x, i }))
            .reverse()
            .map(({ x, i }) => (
              <li key={x.version}>
                <button className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
                  <strong>v{x.version}</strong> <span className="muted small">block #{x.block}</span>
                  <span className="small">{x.note}</span>
                  <Hex value={x.codeHash} />
                </button>
              </li>
            ))}
        </ul>
        <div className="vbody">
          <div className="row">
            <strong>v{v.version}</strong>
            <span className="muted small">
              deployed by <Who address={v.deployedBy} /> in block #{v.block}
            </span>
            <span className="grow" />
            <button
              className="btn small"
              onClick={() => {
                setState({ draftSource: v.source });
                onLoad();
                toast(`v${v.version} is in the editor. Deploying it creates a new version: history is never rewritten.`, 'info');
              }}
            >
              Load into the editor
            </button>
          </div>
          {prev ? <DiffView before={prev.source} after={v.source} /> : <p className="muted small">The first version, deployed in the genesis block.</p>}
        </div>
      </div>
    </section>
  );
}
