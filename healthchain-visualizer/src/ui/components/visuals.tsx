// SVG pictures used by the trail and the ledger: peer network, Merkle tree, PBFT message flow.
import { Fragment } from 'react';
import type { PbftView, MsgState } from '../../engine/consensus';

interface NodeLite {
  id: number;
  short: string;
  online: boolean;
  byzantine: boolean;
}

const POS: Record<number, [number, number]> = {
  1: [62, 96],
  2: [190, 30],
  3: [318, 96],
  4: [190, 162],
};

/** Four hospital nodes, full mesh, with the signed transaction travelling out from the entry node. */
export function NetworkGraph({ nodes, entry, animate = true, labelEntry = 'entry' }: { nodes: NodeLite[]; entry: number; animate?: boolean; labelEntry?: string }) {
  const edges: [number, number][] = [];
  for (let a = 1; a <= 4; a++) for (let b = a + 1; b <= 4; b++) edges.push([a, b]);
  const others = nodes.filter((n) => n.id !== entry);
  return (
    <svg className={`net ${animate ? '' : 'instant'}`} viewBox="0 0 380 196" role="img" aria-label="Hospital node network">
      {edges.map(([a, b]) => {
        const off = !nodes.find((n) => n.id === a)?.online || !nodes.find((n) => n.id === b)?.online;
        return <line key={`${a}-${b}`} x1={POS[a][0]} y1={POS[a][1]} x2={POS[b][0]} y2={POS[b][1]} className={`edge ${off ? 'off' : ''}`} />;
      })}
      {others.map((n, i) => {
        const [x1, y1] = POS[entry];
        const [x2, y2] = POS[n.id];
        const dx = n.online ? x2 - x1 : (x2 - x1) * 0.55;
        const dy = n.online ? y2 - y1 : (y2 - y1) * 0.55;
        return (
          <circle
            key={`p${n.id}`}
            cx={x1}
            cy={y1}
            r={5.5}
            className={`packet ${n.online ? '' : 'lost'}`}
            style={{ ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px`, animationDelay: `calc(${200 + i * 260}ms / var(--speed))` }}
          />
        );
      })}
      {nodes.map((n) => {
        const [x, y] = POS[n.id];
        return (
          <g key={n.id} className={`netnode ${n.online ? '' : 'off'} ${n.byzantine ? 'byz' : ''} ${n.id === entry ? 'entry' : ''}`}>
            <rect x={x - 46} y={y - 16} width={92} height={32} rx={6} />
            <text x={x} y={y - 1} textAnchor="middle" className="nn-name">
              {n.short}
            </text>
            <text x={x} y={y + 11} textAnchor="middle" className="nn-sub">
              {!n.online ? 'offline' : n.byzantine ? 'faulty' : n.id === entry ? labelEntry : `node ${n.id}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Merkle tree drawn root-first. Highlights one leaf's path to the root and the sibling hashes of its proof. */
export function MerkleTreeView({ levels, highlight, labels, width = 400, animate = true }: { levels: string[][]; highlight?: number; labels?: string[]; width?: number; animate?: boolean }) {
  const L = levels.length;
  const boxW = Math.min(78, width / Math.max(levels[0].length, 1) - 8);
  const rowH = 54;
  const hasDup = levels.some((lvl, l) => l < L - 1 && lvl.length % 2 === 1);
  const height = L * rowH + (labels ? 18 : 4) + (hasDup && labels ? 12 : 0);
  // x positions per level
  const xs: number[][] = [];
  xs[0] = levels[0].map((_, i) => ((i + 0.5) * width) / levels[0].length);
  for (let l = 1; l < L; l++) {
    xs[l] = levels[l].map((_, i) => {
      const a = xs[l - 1][2 * i];
      const b = xs[l - 1][2 * i + 1] ?? a;
      return (a + b) / 2;
    });
  }
  const yOf = (l: number) => (L - 1 - l) * rowH + 16;
  const path = new Set<string>();
  const proof = new Set<string>();
  if (highlight !== undefined && highlight >= 0) {
    let idx = highlight;
    for (let l = 0; l < L; l++) {
      path.add(`${l}:${idx}`);
      if (l < L - 1) {
        const sib = idx % 2 ? idx - 1 : Math.min(idx + 1, levels[l].length - 1);
        if (sib !== idx) proof.add(`${l}:${sib}`);
      }
      idx = Math.floor(idx / 2);
    }
  }
  return (
    <svg className={`merkle ${animate ? '' : 'instant'}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Merkle tree of the block's transactions">
      {levels.map((lvl, l) =>
        l === 0
          ? null
          : lvl.map((_, i) => {
              const kids = [2 * i, 2 * i + 1].filter((k) => k < levels[l - 1].length);
              const dup = kids.length === 1;
              return (
                <Fragment key={`e${l}-${i}`}>
                  {kids.map((k) => (
                    <line
                      key={k}
                      x1={xs[l][i]}
                      y1={yOf(l) + 11}
                      x2={xs[l - 1][k]}
                      y2={yOf(l - 1) - 11}
                      className={`m-edge ${path.has(`${l}:${i}`) && path.has(`${l - 1}:${k}`) ? 'on' : ''}`}
                      style={{ animationDelay: `calc(${(l - 1) * 420 + 200}ms / var(--speed))` }}
                    />
                  ))}
                  {dup && (
                    <text x={xs[l - 1][kids[0]]} y={yOf(l - 1) + (l - 1 === 0 && labels ? 38 : 24)} textAnchor="middle" className="m-dup">
                      paired with itself
                    </text>
                  )}
                </Fragment>
              );
            }),
      )}
      {levels.map((lvl, l) =>
        lvl.map((h, i) => {
          const key = `${l}:${i}`;
          const cls = path.has(key) ? 'path' : proof.has(key) ? 'proof' : '';
          const isRoot = l === L - 1;
          return (
            <g key={key} className={`m-node ${cls} ${isRoot ? 'root' : ''}`} style={{ animationDelay: `calc(${l * 420}ms / var(--speed))` }}>
              <rect x={xs[l][i] - boxW / 2} y={yOf(l) - 11} width={boxW} height={22} rx={4} />
              <text x={xs[l][i]} y={yOf(l) + 4} textAnchor="middle">
                {h.slice(0, boxW > 60 ? 8 : 5)}
              </text>
              {isRoot && (
                <text x={xs[l][i] + boxW / 2 + 6} y={yOf(l) + 4} className="m-label">
                  Merkle root
                </text>
              )}
            </g>
          );
        }),
      )}
      {labels &&
        labels.map((t, i) => (
          <text key={`lbl${i}`} x={xs[0][i]} y={yOf(0) + 26} textAnchor="middle" className={`m-leaf ${i === highlight ? 'mine' : ''}`}>
            {t}
          </text>
        ))}
    </svg>
  );
}

/** The classic PBFT message diagram (Castro and Liskov): lanes for the client and each replica. */
export function PbftDiagram({ view, nodes, animate = true }: { view: PbftView; nodes: NodeLite[]; animate?: boolean }) {
  const W = 420;
  const laneY = (k: number) => 30 + k * 26; // 0 = client, 1..4 = nodes
  const cols = ['Request', 'Pre-prepare', 'Prepare', 'Commit', 'Reply'];
  const colX = (c: number) => 62 + c * ((W - 70) / cols.length);
  const colW = (W - 70) / cols.length;
  const H = laneY(4) + 34;
  const primary = view.primary;
  const arrows: { from: number; to: number; col: number; state: MsgState }[] = [];
  arrows.push({ from: 0, to: primary, col: 0, state: 'ok' });
  for (const n of nodes) if (n.id !== primary && view.prePrepare[n.id] && view.prePrepare[n.id] !== 'missing') arrows.push({ from: primary, to: n.id, col: 1, state: view.prePrepare[n.id] });
  for (const [sender, st] of Object.entries(view.prepare)) {
    if (st === 'missing') continue;
    for (const n of nodes) if (n.id !== Number(sender) && n.online) arrows.push({ from: Number(sender), to: n.id, col: 2, state: st });
  }
  for (const [sender, st] of Object.entries(view.commit)) {
    if (st === 'missing') continue;
    for (const n of nodes) if (n.id !== Number(sender) && n.online) arrows.push({ from: Number(sender), to: n.id, col: 3, state: st });
  }
  for (const [sender, st] of Object.entries(view.reply)) {
    if (st === 'missing') continue;
    arrows.push({ from: Number(sender), to: 0, col: 4, state: st });
  }
  const count = (rec: Record<number, MsgState>) => Object.values(rec).filter((s) => s === 'ok').length;
  const tallies = [
    '',
    view.failure && !Object.keys(view.prepare).length ? '' : `${count(view.prePrepare)} sent`,
    Object.keys(view.prepare).length ? `${count(view.prepare)} good, need 2` : '',
    Object.keys(view.commit).length ? `${count(view.commit)} good, need 3` : '',
    Object.keys(view.reply).length ? `${count(view.reply)} good, need 2` : '',
  ];
  return (
    <svg className={`pbft ${animate ? '' : 'instant'}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="PBFT message exchange">
      <defs>
        <marker id="arr-ok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L8 4L0 8z" fill="var(--t-done)" />
        </marker>
        <marker id="arr-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L8 4L0 8z" fill="var(--t-fail)" />
        </marker>
      </defs>
      {cols.map((c, i) => (
        <g key={c}>
          <text x={colX(i) + colW / 2} y={12} textAnchor="middle" className="p-col">
            {c}
          </text>
          <line x1={colX(i)} y1={18} x2={colX(i)} y2={H - 18} className="p-grid" />
          <text x={colX(i) + colW / 2} y={H - 4} textAnchor="middle" className="p-tally">
            {tallies[i]}
          </text>
        </g>
      ))}
      {[{ id: 0, short: 'Client', online: true, byzantine: false }, ...nodes].map((n, k) => (
        <g key={n.id} className={`p-lane ${n.online ? '' : 'off'} ${n.byzantine ? 'byz' : ''} ${n.id === primary ? 'primary' : ''}`}>
          <text x={4} y={laneY(k) + 4} className="p-name">
            {n.short}
            {n.id === primary ? ' ★' : ''}
          </text>
          <line x1={colX(0)} y1={laneY(k)} x2={W - 6} y2={laneY(k)} />
        </g>
      ))}
      {arrows.map((a, i) => {
        const fromK = a.from === 0 ? 0 : nodes.findIndex((n) => n.id === a.from) + 1;
        const toK = a.to === 0 ? 0 : nodes.findIndex((n) => n.id === a.to) + 1;
        const x1 = colX(a.col) + 4;
        const x2 = colX(a.col) + colW - 6;
        return (
          <line
            key={i}
            x1={x1}
            y1={laneY(fromK)}
            x2={x2}
            y2={laneY(toK)}
            className={`p-msg ${a.state}`}
            markerEnd={`url(#arr-${a.state === 'ok' ? 'ok' : 'bad'})`}
            style={{ animationDelay: `calc(${a.col * 700 + 150}ms / var(--speed))` }}
          />
        );
      })}
    </svg>
  );
}
