import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { DEFS, CATEGORIES, ANNOTATIONS } from '../sim/defs';
import { useStore, graphOf, CARD_W } from '../store';
import { ItemIcon } from './icons';

export default function Palette() {
  const [q, setQ] = useState('');
  const addNode = useStore((s) => s.addNode);
  const addNote = useStore((s) => s.addNote);
  const setPanel = useStore((s) => s.setPanel);
  const { screenToFlowPosition } = useReactFlow();

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    return CATEGORIES.map((c) => ({
      ...c,
      defs: DEFS.filter((d) => d.cat === c.id && (!t || d.name.toLowerCase().includes(t) || d.info.toLowerCase().includes(t))),
    })).filter((g) => g.defs.length);
  }, [q]);

  const place = (def: string) => {
    const board = document.querySelector('.board')?.getBoundingClientRect();
    const c = board ? { x: board.left + board.width / 2, y: board.top + board.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
    const p = screenToFlowPosition(c);
    // find a free spot near the middle of the view, spiralling outwards
    const rects = Object.values(graphOf(useStore.getState().nodes, []).rects);
    const free = (x: number, y: number) => !rects.some((r) => x < r.x + r.w + 24 && x + CARD_W + 24 > r.x && y < r.y + r.h + 24 && y + 168 > r.y);
    let at = { x: p.x - 108, y: p.y - 72 };
    search: for (let ring = 0; ring < 12; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = p.x - 108 + dx * 264, y = p.y - 72 + dy * 216;
        if (free(x, y)) { at = { x, y }; break search; }
      }
    }
    if (def === 'note_box' || def === 'note_text') addNote(def === 'note_box' ? 'box' : 'text', at);
    else addNode(def, at);
    if (matchMedia('(max-width: 820px)').matches) setPanel(null);
  };

  return (
    <>
      <div className="panel-head"><h2>Deployables</h2></div>
      <div style={{ padding: '0 14px 4px' }}>
        <input className="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search deployables" />
      </div>
      <div className="panel-scroll">
        {groups.map((g) => (
          <div className="cat" key={g.id}>
            <h3>{g.label}</h3>
            <div className="palette-grid">
              {g.defs.map((d) => (
                <button
                  key={d.id}
                  className="pal-item"
                  title={`${d.name}\n${d.info}`}
                  aria-label={`Add ${d.name}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-rustwire', d.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => place(d.id)}
                >
                  <ItemIcon s={d.icon} size={40} />
                  <span>{d.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {(!q || 'outline box text label annotate'.includes(q.trim().toLowerCase())) && (
          <div className="cat">
            <h3>Annotate</h3>
            <div className="palette-grid">
              {ANNOTATIONS.map((a) => (
                <button
                  key={a.id}
                  className="pal-item"
                  title={`${a.name}\n${a.info}`}
                  aria-label={`Add ${a.name}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/x-rustwire', a.id); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => place(a.id)}
                >
                  {a.id === 'note_box'
                    ? <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="8" width="30" height="24" fill="none" stroke="#ebe4d8" strokeWidth="2" strokeDasharray="4 3" /></svg>
                    : <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><text x="20" y="28" textAnchor="middle" fontSize="22" fontWeight="700" fill="#ebe4d8" fontFamily="Archivo Narrow, sans-serif">Aa</text></svg>}
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="pal-tip">Tap to drop in the middle of the board, or drag onto a spot. Crafters, storage monitors and hoppers attach to the selected or nearest bench or container.</p>
      </div>
    </>
  );
}
