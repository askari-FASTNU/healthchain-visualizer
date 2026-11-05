import { useEffect, useRef, useState } from 'react';
import { ROLE_LABEL } from '../engine/actors';
import { nextStep, skipToEnd } from '../engine/pipeline';
import { setState, STAGES, useStore } from '../engine/store';
import { roleColor } from './components/bits';
import { StageDetail } from './StageDetail';

export function Trail() {
  const runs = useStore((s) => s.runs);
  const viewRunId = useStore((s) => s.viewRunId);
  const busy = useStore((s) => s.busy);
  const awaitingNext = useStore((s) => s.awaitingNext);
  const stepMode = useStore((s) => s.settings.stepMode);
  const speed = useStore((s) => s.settings.speed);
  const skip = useStore((s) => s.skip);
  const run = runs.find((r) => r.id === viewRunId);
  const activeIndex = run ? run.stages.findIndex((s) => s.status === 'active') : -1;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLOListElement>(null);
  const isLiveRun = busy && runs[0]?.id === viewRunId;

  // Follow the active stage: open it and close the rest...
  useEffect(() => {
    if (activeIndex >= 0) setOpen(new Set([activeIndex]));
  }, [activeIndex, viewRunId]);

  // ...then scroll to it once the previous stage has collapsed, so the position is right.
  useEffect(() => {
    if (activeIndex < 0 || !open.has(activeIndex)) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'start', behavior: skip ? 'auto' : 'smooth' });
  }, [open, activeIndex, skip]);

  // When a run ends, open the stage where it stopped.
  useEffect(() => {
    if (!run || run.stages.some((s) => s.status === 'active')) return;
    const last = [...run.stages].reverse().findIndex((s) => s.status === 'done' || s.status === 'failed');
    if (last >= 0) setOpen(new Set([run.stages.length - 1 - last]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.outcome?.kind, viewRunId]);

  const toggle = (i: number) => {
    const next = new Set(open);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpen(next);
  };

  return (
    <aside className="trail" style={{ ['--speed' as string]: skip ? 30 : speed }} aria-label="Blockchain trail">
      <div className="trail-head">
        <h2>Blockchain trail</h2>
        <p>Everything the network does with the last action, step by step.</p>
        {runs.length > 0 && (
          <div className="trail-run">
            <label className="visually-hidden" htmlFor="run-pick">
              Transaction to show
            </label>
            <select id="run-pick" value={viewRunId ?? ''} onChange={(e) => setState({ viewRunId: Number(e.target.value) })}>
              {runs.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {i === 0 && busy ? 'In progress: ' : ''}
                  {r.title}, {r.actorName}
                  {r.outcome ? ` [${r.outcome.kind}]` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="trail-scroll">
        {!run ? (
          <div className="trail-empty">
            <strong>No transaction yet</strong>
            Pick an action in the hospital portal and press "Sign and submit". Each of these steps will light up in turn.
            <ol className="stages" style={{ marginTop: 14 }}>
              {STAGES.map((s, i) => (
                <li key={s.id} className="stage waiting">
                  <div className="stage-rail">
                    <span className="stage-dot">{i + 1}</span>
                  </div>
                  <div className="stage-main">
                    <div className="stage-title">
                      <h3>{s.title}</h3>
                      <p>{s.blurb}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <>
            <div className="txchip">
              <span className="band" style={{ background: roleColor(run.actorRole) }} />
              <strong>{run.title}</strong>
              <span>
                {run.actorName}, {ROLE_LABEL[run.actorRole]}
                {run.txType === 'upgrade' ? ', contract upgrade' : run.method ? `, ${run.method}()` : ''}
              </span>
            </div>
            {run.outcome && (
              <div className={`outcome ${run.outcome.kind}`} role="status">
                <strong>
                  {run.outcome.kind === 'committed'
                    ? 'Committed'
                    : run.outcome.kind === 'reverted'
                      ? 'Reverted by the contract'
                      : run.outcome.kind === 'rejected'
                        ? 'Rejected by the network'
                        : 'Not committed'}
                </strong>
                {run.outcome.text}
              </div>
            )}
            <ol className="stages" ref={listRef}>
              {run.stages.map((st, i) => {
                const meta = STAGES[i];
                const isOpen = open.has(i) && st.data;
                return (
                  <li key={st.id} className={`stage ${st.status}`}>
                    <div className="stage-rail">
                      <span className="stage-dot">{st.status === 'done' ? '✓' : st.status === 'failed' ? '✗' : i + 1}</span>
                    </div>
                    <div className="stage-main">
                      <button className="stage-title" onClick={() => st.data && toggle(i)} aria-expanded={Boolean(isOpen)} disabled={!st.data}>
                        <h3>{meta.title}</h3>
                        {st.summary ? <p className="sum">{st.summary}</p> : <p>{meta.blurb}</p>}
                      </button>
                      {isOpen && (
                        <div className={`stage-detail ${st.status === 'active' && isLiveRun && !skip ? '' : 'instant'}`}>
                          <StageDetail stage={st} live={st.status === 'active' && isLiveRun && !skip} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {isLiveRun && (
        <div className="trail-controls">
          {stepMode ? (
            <button className="btn go" onClick={nextStep} disabled={!awaitingNext}>
              Next step
            </button>
          ) : null}
          <span className="hint">{stepMode ? (awaitingNext ? 'Paused. Explain this step, then continue.' : 'Working…') : `Playing at ${speed}x`}</span>
          <button className="btn small" onClick={skipToEnd}>
            Skip to the end
          </button>
        </div>
      )}
    </aside>
  );
}
