import { useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { DEFS, CATEGORIES } from '../sim/defs';
import { useStore } from '../store';
import { ItemIcon } from './icons';

export default function Palette() {
  const [q, setQ] = useState('');
  const addNode = useStore((s) => s.addNode);
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
    const jitter = () => Math.round((Math.random() - 0.5) * 6) * 12;
    addNode(def, { x: Math.round(p.x / 12) * 12 - 96 + jitter(), y: Math.round(p.y / 12) * 12 - 48 + jitter() });
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
        <p className="pal-tip">Tap to drop in the middle of the board, or drag onto a spot. Hover for details.</p>
      </div>
    </>
  );
}
