// The hospital app people actually use. Every button here creates a signed transaction.
import { useEffect, useMemo, useState } from 'react';
import { ROLE_LABEL } from '../../engine/actors';
import { randomKeyPair, sha256Hex } from '../../engine/crypto';
import { submitTx, type TxDraft } from '../../engine/pipeline';
import { getState, setState, useStore } from '../../engine/store';
import type { Actor, Role, WorldState } from '../../engine/types';
import { Hex, RoleTag, roleColor } from '../components/bits';
import { PatientChart } from './PatientChart';

interface FieldDef {
  key: string;
  label: string;
  type: 'patient' | 'newPatient' | 'provider' | 'member' | 'myProvider' | 'record' | 'prescription' | 'claim' | 'text' | 'textarea' | 'number' | 'select' | 'bool' | 'json';
  options?: string[];
  hint?: (v: Record<string, any>, w: WorldState) => string | undefined;
  wide?: boolean;
  default?: (actor: Actor, w: WorldState) => any;
}

interface ActionDef {
  label: string;
  describe: string;
  fields: FieldDef[];
  build: (v: Record<string, any>, actor: Actor, w: WorldState) => Omit<TxDraft, 'actorId' | 'type' | 'method'> | null;
}

const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const pname = (w: WorldState, a: string) => w.storage.patients?.[a]?.name ?? w.storage.members?.[a]?.name ?? a.slice(0, 10);
const mname = (w: WorldState, a: string) => w.storage.members?.[a]?.name ?? a.slice(0, 10);

const ACTIONS: Record<string, ActionDef> = {
  registerPatient: {
    label: 'Register a patient',
    describe: 'Adds a patient wallet to the on-chain patient registry.',
    fields: [
      { key: 'patient', label: 'Patient wallet', type: 'newPatient' },
      { key: 'age', label: 'Age', type: 'number', default: () => 29 },
      { key: 'bloodGroup', label: 'Blood group', type: 'select', options: BLOOD, default: () => 'A+' },
    ],
    build: (v, _a, w) => ({ title: `Register ${mname(w, v.patient)}`, args: { patient: v.patient, name: mname(w, v.patient), age: Number(v.age), bloodGroup: v.bloodGroup } }),
  },
  addMember: {
    label: 'Onboard a staff member',
    describe: 'Creates a new wallet and adds it to the permissioned network.',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', default: () => 'Dr. Hamza Qureshi' },
      { key: 'role', label: 'Role', type: 'select', options: ['doctor', 'nurse', 'patient', 'lab', 'pharmacist', 'insurer', 'admin'], default: () => 'doctor' },
      { key: 'org', label: 'Organisation', type: 'text', wide: true, default: (a) => a.org },
    ],
    build: (v) => {
      const keys = randomKeyPair();
      const s = getState();
      const actor: Actor = { id: `m-${keys.address.slice(2, 8)}`, name: v.name, role: v.role as Role, org: v.org, nodeId: 1, ...keys };
      setState({ actors: [...s.actors, actor] });
      return { title: `Onboard ${v.name}`, args: { address: keys.address, name: v.name, role: v.role, org: v.org } };
    },
  },
  grantConsent: {
    label: 'Give consent to a provider',
    describe: 'Lets a doctor, nurse or lab read and add to your records.',
    fields: [{ key: 'provider', label: 'Provider', type: 'provider', default: (a, w) => preferUnconsented(a, w) }],
    build: (v, _a, w) => ({ title: `Give consent to ${mname(w, v.provider)}`, args: { provider: v.provider } }),
  },
  revokeConsent: {
    label: 'Withdraw consent',
    describe: 'Stops a provider from accessing your records from the next block on.',
    fields: [{ key: 'provider', label: 'Provider', type: 'myProvider' }],
    build: (v, _a, w) => ({ title: `Withdraw consent from ${mname(w, v.provider)}`, args: { provider: v.provider } }),
  },
  addRecord: {
    label: 'Add a medical record',
    describe: 'The document stays off-chain. Only its SHA-256 fingerprint is recorded.',
    fields: [
      { key: 'patient', label: 'Patient', type: 'patient' },
      { key: 'kind', label: 'Type', type: 'select', options: ['clinical note', 'lab', 'imaging', 'discharge summary'], default: (a) => (a.role === 'lab' ? 'lab' : 'clinical note') },
      { key: 'title', label: 'Title', type: 'text', wide: true, default: (a) => (a.role === 'lab' ? 'Lipid profile' : 'Follow-up visit') },
      {
        key: 'content',
        label: 'Document (kept off-chain)',
        type: 'textarea',
        wide: true,
        default: (a) =>
          a.role === 'lab'
            ? 'Total cholesterol 212 mg/dL, LDL 138 mg/dL, HDL 41 mg/dL, triglycerides 165 mg/dL.'
            : 'Fatigue improving. Fasting glucose 118 mg/dL. Continue current medication and review in 3 months.',
        hint: (v) => (v.content ? `Fingerprint: ${sha256Hex(v.content).slice(0, 20)}…` : undefined),
      },
    ],
    build: (v, a) => {
      const ref = `offchain://${a.id}/${Date.now().toString(36)}`;
      const hash = sha256Hex(v.content);
      return {
        title: `Add record "${v.title}"`,
        args: { patient: v.patient, kind: v.kind, title: v.title, dataHash: hash, storageRef: ref },
        doc: { ref, patient: v.patient, title: v.title, content: v.content, hash, author: a.address },
      };
    },
  },
  accessRecord: {
    label: 'Open a patient record',
    describe: 'Reading is logged on-chain, so every access leaves an audit trail.',
    fields: [
      { key: 'recordId', label: 'Record', type: 'record', wide: true },
      { key: 'reason', label: 'Reason', type: 'text', wide: true, default: () => 'Follow-up consultation' },
    ],
    build: (v) => ({ title: `Open record ${v.recordId}`, args: { recordId: v.recordId, reason: v.reason } }),
  },
  emergencyAccess: {
    label: 'Emergency access (break glass)',
    describe: 'Access without consent in an emergency. Allowed by policy but flagged for review.',
    fields: [
      { key: 'patient', label: 'Patient', type: 'patient', wide: true },
      { key: 'reason', label: 'Reason', type: 'textarea', wide: true, default: () => 'Unconscious in A&E, need medication history', hint: (_v, w) => `Policy needs at least ${w.storage.policy?.params?.minEmergencyReasonLength ?? '?'} characters` },
    ],
    build: (v, _a, w) => ({ title: `Emergency access to ${pname(w, v.patient)}`, args: { patient: v.patient, reason: v.reason } }),
  },
  prescribe: {
    label: 'Write a prescription',
    describe: 'The contract checks the daily dose against the safety limit in the policy.',
    fields: [
      { key: 'patient', label: 'Patient', type: 'patient', wide: true },
      { key: 'drug', label: 'Medicine', type: 'select', options: ['Amoxicillin', 'Paracetamol', 'Metformin', 'Atorvastatin', 'Tramadol', 'Morphine'], default: () => 'Paracetamol' },
      { key: 'doseMg', label: 'Dose (mg)', type: 'number', default: () => 500 },
      { key: 'timesPerDay', label: 'Times per day', type: 'number', default: () => 3 },
      {
        key: 'days',
        label: 'Days',
        type: 'number',
        default: () => 5,
        hint: (v, w) => `Daily dose ${Number(v.doseMg) * Number(v.timesPerDay)} mg. Policy limit ${w.storage.policy?.params?.maxDailyDoseMg ?? '?'} mg.`,
      },
    ],
    build: (v, _a, w) => ({
      title: `Prescribe ${v.drug} for ${pname(w, v.patient)}`,
      args: { patient: v.patient, drug: v.drug, doseMg: Number(v.doseMg), timesPerDay: Number(v.timesPerDay), days: Number(v.days) },
    }),
  },
  dispense: {
    label: 'Dispense a prescription',
    describe: 'Marks the prescription as dispensed so it cannot be filled twice.',
    fields: [{ key: 'prescriptionId', label: 'Prescription', type: 'prescription', wide: true }],
    build: (v) => ({ title: `Dispense ${v.prescriptionId}`, args: { prescriptionId: v.prescriptionId } }),
  },
  submitClaim: {
    label: 'Submit an insurance claim',
    describe: 'Claims under the auto-approve limit are approved by the contract instantly.',
    fields: [
      { key: 'patient', label: 'Patient', type: 'patient' },
      { key: 'amount', label: 'Amount (PKR)', type: 'number', default: () => 85000, hint: (_v, w) => `Auto-approve limit: PKR ${w.storage.policy?.params?.claimAutoApproveLimit?.toLocaleString?.() ?? '?'}` },
      { key: 'description', label: 'Description', type: 'text', wide: true, default: () => 'Two-night admission and blood tests' },
    ],
    build: (v, _a, w) => ({ title: `Claim PKR ${Number(v.amount).toLocaleString()} for ${pname(w, v.patient)}`, args: { patient: v.patient, amount: Number(v.amount), description: v.description } }),
  },
  reviewClaim: {
    label: 'Review an insurance claim',
    describe: 'Approve or reject a claim that was above the auto-approve limit.',
    fields: [
      { key: 'claimId', label: 'Claim', type: 'claim', wide: true },
      { key: 'decision', label: 'Decision', type: 'select', options: ['approve', 'reject'], default: () => 'approve' },
    ],
    build: (v) => ({ title: `${v.decision === 'approve' ? 'Approve' : 'Reject'} claim ${v.claimId}`, args: { claimId: v.claimId, approve: v.decision === 'approve' } }),
  },
};

/** A form for a method added by a contract upgrade, guessed from its parameter names. */
function genericAction(method: string, params: string[]): ActionDef | null {
  if (!params.length) return null;
  const fields: FieldDef[] = params.map((p) => {
    if (/^patient$/i.test(p)) return { key: p, label: p, type: 'patient' };
    if (/recordId/i.test(p)) return { key: p, label: p, type: 'record' };
    if (/prescriptionId/i.test(p)) return { key: p, label: p, type: 'prescription' };
    if (/claimId/i.test(p)) return { key: p, label: p, type: 'claim' };
    if (/provider|doctor|member|address|recipient|^to/i.test(p)) return { key: p, label: p, type: 'member' };
    if (/amount|dose|mg|days|count|age|qty|limit|number/i.test(p)) return { key: p, label: p, type: 'number', default: () => 1 };
    if (/^(approve|enabled|is[A-Z]|allow)/.test(p)) return { key: p, label: p, type: 'bool' as const, options: ['true', 'false'] };
    return { key: p, label: p, type: 'text', wide: true };
  });
  return {
    label: `${method}()`,
    describe: 'A method added by a contract upgrade. The form is guessed from its parameter names.',
    fields,
    build: (v) => ({
      title: `Call ${method}()`,
      args: Object.fromEntries(
        fields.map((f) => [f.key, f.type === 'number' ? Number(v[f.key]) : f.type === 'bool' ? v[f.key] === 'true' : v[f.key]]),
      ),
    }),
  };
}

function preferUnconsented(a: Actor, w: WorldState) {
  const given = w.storage.consents?.[a.address] ?? {};
  const providers = Object.entries<any>(w.storage.members ?? {}).filter(([addr, m]) => m.role !== 'patient' && m.role !== 'admin' && addr !== a.address);
  return (providers.find(([addr]) => !given[addr]) ?? providers[0])?.[0] ?? '';
}

export function Portal() {
  const actors = useStore((s) => s.actors);
  const currentId = useStore((s) => s.currentActorId);
  const world = useStore((s) => s.world);
  const info = useStore((s) => s.contractInfo);
  const busy = useStore((s) => s.busy);
  const forgeNext = useStore((s) => s.forgeNext);
  const actor = actors.find((a) => a.id === currentId) ?? actors[0];
  const members = world.storage.members ?? {};
  const role = members[actor.address]?.role ?? actor.role;
  const perms: Record<string, string[]> = world.storage.policy?.permissions ?? {};
  const methods = info.methods.map((m) => m.name);
  const allowed = methods.filter((m) => (perms[m] ?? []).includes(role));
  const others = methods.filter((m) => !allowed.includes(m));
  const [method, setMethod] = useState<string>(allowed[0] ?? methods[0]);

  useEffect(() => {
    if (!methods.includes(method) || !allowed.includes(method)) setMethod(allowed[0] ?? methods[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  return (
    <div className="portal">
      <section className="identity" aria-label="Acting as">
        <div className="identity-head">
          <h2>Acting as</h2>
          <p className="muted small">Each person has their own key pair. Pick who you are; their key signs the transaction.</p>
        </div>
        <div className="people">
          {actors.map((a) => {
            const onChain = members[a.address];
            return (
              <button key={a.id} className={`person ${a.id === actor.id ? 'on' : ''}`} onClick={() => setState({ currentActorId: a.id })} aria-pressed={a.id === actor.id}>
                <span className="band" style={{ background: roleColor(a.role) }} />
                <span className="pname">{a.name}</span>
                <span className="prole">
                  {ROLE_LABEL[a.role]}
                  {!onChain ? ', joining' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="portal-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="grow">
              <h2>What {actor.name} can do</h2>
              <p>
                From the permissions in contract v{world.contract.version}. <Hex value={actor.address} />
              </p>
            </div>
            <RoleTag role={role} />
          </div>
          <div className="panel-body stack">
            <div className="action-list" role="listbox" aria-label="Actions">
              {allowed.map((m) => (
                <button key={m} role="option" aria-selected={m === method} className={`action ${m === method ? 'on' : ''}`} onClick={() => setMethod(m)}>
                  {ACTIONS[m]?.label ?? `${m}()`}
                </button>
              ))}
              {allowed.length === 0 && <p className="muted small">The current policy gives {ROLE_LABEL[role as Role] ?? role} no permissions.</p>}
            </div>
            {others.length > 0 && (
              <details className="others">
                <summary>Not permitted for this role ({others.length}). Try one to watch the contract refuse it.</summary>
                <div className="action-list">
                  {others.map((m) => (
                    <button key={m} className={`action denied ${m === method ? 'on' : ''}`} onClick={() => setMethod(m)}>
                      {ACTIONS[m]?.label ?? `${m}()`}
                    </button>
                  ))}
                </div>
              </details>
            )}
            {method && (
              <ActionForm
                key={`${actor.id}:${method}:${world.contract.version}`}
                method={method}
                actor={actor}
                world={world}
                params={info.methods.find((m) => m.name === method)?.params ?? []}
                permitted={allowed.includes(method)}
                busy={busy}
                forged={forgeNext}
              />
            )}
          </div>
        </section>
        <PatientChart />
      </div>
    </div>
  );
}

function ActionForm({ method, actor, world, params, permitted, busy, forged }: { method: string; actor: Actor; world: WorldState; params: string[]; permitted: boolean; busy: boolean; forged: boolean }) {
  const def = ACTIONS[method] ?? (method === 'updatePolicy' ? undefined : genericAction(method, params)) ?? undefined;
  const options = useOptions(actor, world);
  const initial = useMemo(() => {
    const v: Record<string, any> = {};
    if (!def) {
      v.json = JSON.stringify(Object.fromEntries(params.map((p) => [p, ''])), null, 2);
      return v;
    }
    for (const f of def.fields) {
      if (f.default) v[f.key] = f.default(actor, world);
      else if (f.type in options) v[f.key] = (options as any)[f.type][0]?.value ?? '';
      else if (f.options) v[f.key] = f.options[0];
      else v[f.key] = '';
    }
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [values, setValues] = useState<Record<string, any>>(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    let draft: TxDraft;
    if (def) {
      const built = def.build(values, actor, world);
      if (!built) return;
      draft = { ...built, actorId: actor.id, type: 'call', method };
    } else {
      let args: any;
      try {
        args = JSON.parse(values.json || '{}');
      } catch (e) {
        setError(`The arguments are not valid JSON: ${(e as Error).message}`);
        return;
      }
      draft = { actorId: actor.id, type: 'call', method, args, title: `Call ${method}()` };
    }
    void submitTx(draft);
  };

  return (
    <div className="action-form">
      <div>
        <h3>{def?.label ?? `${method}()`}</h3>
        <p className="muted small">{def?.describe ?? 'A method without a ready-made form. Enter its arguments as JSON.'}</p>
      </div>
      {method === 'updatePolicy' && (
        <div className="note">
          The Smart contract tab has a permission grid and a rules form that build this call for you.{' '}
          <button className="linklike" onClick={() => setState({ tab: 'contract' })}>
            Open it
          </button>
        </div>
      )}
      <div className="form-grid">
        {def ? (
          def.fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key]} values={values} world={world} options={options} onChange={(val) => setValues({ ...values, [f.key]: val })} />)
        ) : (
          <label className="field wide">
            <span>Arguments (JSON)</span>
            <textarea className="textarea code" rows={6} value={values.json} onChange={(e) => setValues({ json: e.target.value })} />
            <AddressHelper world={world} />
          </label>
        )}
      </div>
      {!permitted && <div className="note warn">The current policy does not allow a {ROLE_LABEL[actor.role]} to call {method}(). Submitting will be reverted by the contract, and the attempt will be recorded.</div>}
      {forged && <div className="note bad">Attack scenario on: this transaction will be signed with an attacker's key while claiming to be from {actor.name}.</div>}
      {error && <div className="note bad">{error}</div>}
      <div className="row">
        <button className="btn primary" onClick={submit} disabled={busy}>
          Sign and submit
        </button>
        {busy && <span className="muted small">Wait for the current transaction to finish, or skip to the end in the trail.</span>}
      </div>
    </div>
  );
}

function AddressHelper({ world }: { world: WorldState }) {
  return (
    <small>
      Addresses:{' '}
      {Object.entries<any>(world.storage.members ?? {})
        .slice(0, 12)
        .map(([a, m]) => (
          <span key={a} className="addr-pill" title={a} onClick={() => navigator.clipboard?.writeText(a).catch(() => undefined)}>
            {m.name}: {a.slice(0, 8)}…
          </span>
        ))}
      <br />
      Click a name to copy its address.
    </small>
  );
}

type Opt = { value: string; label: string };

function useOptions(actor: Actor, w: WorldState) {
  const st = w.storage;
  const members = Object.entries<any>(st.members ?? {});
  const patient: Opt[] = Object.entries<any>(st.patients ?? {}).map(([a, p]) => ({ value: a, label: `${p.name}, ${p.age}` }));
  const newPatient: Opt[] = members.filter(([a, m]) => m.role === 'patient' && !st.patients?.[a]).map(([a, m]) => ({ value: a, label: m.name }));
  const allPatients: Opt[] = members.filter(([, m]) => m.role === 'patient').map(([a, m]) => ({ value: a, label: `${m.name}${st.patients?.[a] ? ' (already registered)' : ''}` }));
  const provider: Opt[] = members.filter(([a, m]) => m.role !== 'patient' && a !== actor.address).map(([a, m]) => ({ value: a, label: `${m.name}, ${ROLE_LABEL[m.role as Role] ?? m.role}` }));
  const member: Opt[] = members.filter(([a]) => a !== actor.address).map(([a, m]) => ({ value: a, label: `${m.name}, ${ROLE_LABEL[m.role as Role] ?? m.role}` }));
  const mine = Object.keys(st.consents?.[actor.address] ?? {});
  const myProvider: Opt[] = mine.length ? mine.map((a) => ({ value: a, label: `${st.members?.[a]?.name ?? a}` })) : provider;
  const record: Opt[] = Object.entries<any>(st.records ?? {}).map(([id, r]) => ({ value: id, label: `${id}: ${r.title} (${st.patients?.[r.patient]?.name ?? 'unknown'})` }));
  const prescription: Opt[] = Object.entries<any>(st.prescriptions ?? {})
    .sort(([, a], [, b]) => (a.status === 'active' ? -1 : 1) - (b.status === 'active' ? -1 : 1))
    .map(([id, r]) => ({ value: id, label: `${id}: ${r.drug} ${r.doseMg} mg for ${st.patients?.[r.patient]?.name ?? '?'} (${r.status})` }));
  const claim: Opt[] = Object.entries<any>(st.claims ?? {})
    .sort(([, a], [, b]) => (a.status === 'pending review' ? -1 : 1) - (b.status === 'pending review' ? -1 : 1))
    .map(([id, c]) => ({ value: id, label: `${id}: PKR ${c.amount.toLocaleString()} for ${st.patients?.[c.patient]?.name ?? '?'} (${c.status})` }));
  return { patient, newPatient: newPatient.length ? newPatient : allPatients, provider, member, myProvider, record, prescription, claim };
}

function FieldInput({ f, value, values, world, options, onChange }: { f: FieldDef; value: any; values: Record<string, any>; world: WorldState; options: ReturnType<typeof useOptions>; onChange: (v: any) => void }) {
  const hint = f.hint?.(values, world);
  const opts = (options as any)[f.type] as Opt[] | undefined;
  const stale = Boolean(opts && opts.length && !opts.some((o) => o.value === value));
  useEffect(() => {
    // Keep the choice valid when the list changes after a block (for example, a patient was just registered).
    if (stale && opts) onChange(opts[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);
  let control;
  if (opts) {
    control = (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {opts.length === 0 && <option value="">Nothing to choose yet</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (f.type === 'select' || f.type === 'bool') {
    control = (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {f.options!.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  } else if (f.type === 'textarea') {
    control = <textarea className="textarea" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = <input className="input" type={f.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <label className={`field ${f.wide ? 'wide' : ''}`}>
      <span>{f.label}</span>
      {control}
      {hint && <small>{hint}</small>}
    </label>
  );
}
