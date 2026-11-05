import { useState, type ReactNode } from 'react';
import { ROLE_LABEL } from '../../engine/actors';
import { getState } from '../../engine/store';
import type { Role } from '../../engine/types';

export function RoleTag({ role, label }: { role: string; label?: string }) {
  const known = (ROLE_LABEL as Record<string, string>)[role];
  return (
    <span className="tag" style={{ color: `var(--role-${role}, var(--muted))` }}>
      <span className="band" />
      <span style={{ color: 'var(--ink-2)' }}>{label ?? known ?? role}</span>
    </span>
  );
}

export function roleColor(role: Role | string) {
  return `var(--role-${role}, var(--muted))`;
}

/** A hash or other hex value. Short by default, full on demand. */
export function Hex({ value, full = false, className = '' }: { value: string; full?: boolean; className?: string }) {
  if (!value) return null;
  const has0x = value.startsWith('0x');
  const body = has0x ? value.slice(2) : value;
  const text = full || body.length <= 16 ? value : `${has0x ? '0x' : ''}${body.slice(0, 8)}…${body.slice(-6)}`;
  return (
    <span className={`hex ${className}`} title={value}>
      {text}
    </span>
  );
}

export function Who({ address }: { address: string }) {
  const s = getState();
  const m = s.world.storage.members?.[address];
  const name = m?.name ?? s.actors.find((a) => a.address === address)?.name;
  return (
    <span title={address}>
      {name ?? <Hex value={address} />}
    </span>
  );
}

export function Json({ value, maxHeight }: { value: unknown; maxHeight?: number }) {
  return (
    <pre className="json" style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function preview(v: unknown, max = 60): string {
  if (v === undefined) return '—';
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function Collapsible({ title, children, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? 'open' : ''}`}>
      <button className="collapsible-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chev" aria-hidden>
          ▸
        </span>
        <span className="grow">{title}</span>
        {right}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

export function Mark() {
  // Brand mark: a chain link crossed with a medical plus.
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#0d2a30" />
      <rect x="6.5" y="10" width="11" height="12" rx="3.5" fill="none" stroke="#5fd59b" strokeWidth="2.4" />
      <rect x="14.5" y="10" width="11" height="12" rx="3.5" fill="none" stroke="#f4b740" strokeWidth="2.4" />
      <path d="M16 13.5v5M13.5 16h5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
