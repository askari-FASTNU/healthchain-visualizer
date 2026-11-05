import { diffLines } from 'diff';

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'gap';
  text: string;
  a?: number;
  b?: number;
}

/** Unified line diff with three lines of context around each change. */
export function DiffView({ before, after, context = 3 }: { before: string; after: string; context?: number }) {
  const parts = diffLines(before, after);
  const lines: Line[] = [];
  let a = 1;
  let b = 1;
  for (const p of parts) {
    const rows = p.value.replace(/\n$/, '').split('\n');
    for (const r of rows) {
      if (p.added) lines.push({ kind: 'add', text: r, b: b++ });
      else if (p.removed) lines.push({ kind: 'del', text: r, a: a++ });
      else lines.push({ kind: 'ctx', text: r, a: a++, b: b++ });
    }
  }
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind !== 'ctx') for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Line[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: 'gap', text: `${skipped} unchanged line${skipped > 1 ? 's' : ''}` });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ kind: 'gap', text: `${skipped} unchanged lines` });
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  if (!added && !removed) return <p className="muted small">No differences.</p>;
  return (
    <div className="diff">
      <div className="diff-stats">
        <span className="plus">+{added}</span> <span className="minus">−{removed}</span> lines
      </div>
      <pre>
        {out.map((l, i) =>
          l.kind === 'gap' ? (
            <div key={i} className="d-gap">
              ⋯ {l.text}
            </div>
          ) : (
            <div key={i} className={`d-${l.kind}`}>
              <span className="d-no">{l.kind === 'add' ? '' : l.a}</span>
              <span className="d-no">{l.kind === 'del' ? '' : l.b}</span>
              <span className="d-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
              {l.text}
            </div>
          ),
        )}
      </pre>
    </div>
  );
}
