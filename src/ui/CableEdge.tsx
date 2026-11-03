import { memo, useCallback } from 'react';
import { useReactFlow, type EdgeProps } from '@xyflow/react';
import { useStore, useTick, type CableEdge as CableEdgeT } from '../store';
import { colorHex } from '../sim/defs';
import { world } from '../sim/world';
import { iconUrl } from '../data/items';

type Pt = { x: number; y: number };

export type Dir = 'left' | 'right' | 'top' | 'bottom';
const VEC: Record<Dir, Pt> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

export function curvePath(pts: Pt[], sd: Dir, td: Dir): string {
  const a = pts[0], b = pts[pts.length - 1];
  const sv = VEC[sd], tv = VEC[td];
  if (pts.length === 2) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(40, dist * 0.45);
    const sag = Math.min(50, dist * 0.07);
    return `M${a.x},${a.y} C${a.x + sv.x * k},${a.y + sv.y * k + sag} ${b.x + tv.x * k},${b.y + tv.y * k + sag} ${b.x},${b.y}`;
  }
  // Catmull-Rom through all points, leaving and entering along each port's direction
  const p = [{ x: a.x - sv.x * 60, y: a.y - sv.y * 60 }, ...pts, { x: b.x - tv.x * 60, y: b.y - tv.y * 60 }];
  p[0] = { x: a.x - (pts[1].x - a.x), y: a.y - (pts[1].y - a.y) };
  p[0] = { x: a.x - sv.x * 60, y: a.y - sv.y * 60 };
  p[p.length - 1] = { x: b.x - tv.x * 60, y: b.y - tv.y * 60 };
  let d = `M${a.x},${a.y}`;
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Straight segments with sharp corners; adds an elbow when there are no bends. */
export function straightPath(pts: Pt[], sd: Dir): string {
  let all = pts;
  if (pts.length === 2) {
    const [a, b] = pts;
    if (a.x !== b.x && a.y !== b.y) {
      all = sd === 'top' || sd === 'bottom'
        ? [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b]
        : [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b];
    }
  }
  return all.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' ');
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function lighten(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + amt), g = Math.min(255, ((n >> 8) & 255) + amt), b = Math.min(255, (n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

function CableEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<CableEdgeT>) {
  useTick();
  const { screenToFlowPosition } = useReactFlow();
  const setEdge = useStore((s) => s.setEdge);
  const checkpoint = useStore((s) => s.checkpoint);
  const points = data?.points ?? [];
  const kind = data?.kind ?? 'power';
  const hex = colorHex(data?.color ?? 'default');
  const all = [{ x: sourceX, y: sourceY }, ...points, { x: targetX, y: targetY }];
  const d = data?.style === 'straight' ? straightPath(all, sourcePosition as Dir) : curvePath(all, sourcePosition as Dir, targetPosition as Dir);
  const w = world.current;
  const flow = w.flow[id] ?? 0;
  const itemActive = kind === 'item' && w.time - (w.pipeAt[id] ?? -99) < 1.6;

  const addPoint = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let best = 0, bd = Infinity;
      for (let i = 0; i < all.length - 1; i++) {
        const dd = segDist(p, all[i], all[i + 1]);
        if (dd < bd) { bd = dd; best = i; }
      }
      checkpoint();
      const next = [...points];
      next.splice(best, 0, { x: Math.round(p.x), y: Math.round(p.y) });
      setEdge(id, { points: next });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, sourceX, sourceY, targetX, targetY],
  );

  const dragPoint = (idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    checkpoint();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const p = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const cur = useStore.getState().edges.find((x) => x.id === id)?.data?.points ?? [];
      const next = cur.map((q, i) => (i === idx ? { x: Math.round(p.x), y: Math.round(p.y) } : q));
      setEdge(id, { points: next });
    };
    const up = () => {
      el.removeEventListener('pointermove', move as EventListener);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up);
  };
  const removePoint = (idx: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    checkpoint();
    setEdge(id, { points: points.filter((_, i) => i !== idx) });
  };

  const sel = selected ? 1 : 0;
  return (
    <g>
      {kind === 'power' && (
        <>
          <path d={d} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={5} transform="translate(0,2)" />
          {selected && <path d={d} fill="none" stroke="#f3b23a" strokeOpacity={0.35} strokeWidth={9} />}
          {flow > 0 && <path d={d} fill="none" stroke="#f3b23a" strokeOpacity={0.18} strokeWidth={8} />}
          <path d={d} fill="none" stroke={hex} strokeWidth={3.2} strokeLinecap="round" />
          <path d={d} fill="none" stroke={lighten(hex, 70)} strokeOpacity={0.45} strokeWidth={1} />
          {flow > 0 && <path d={d} fill="none" stroke="#fff3c4" strokeWidth={2.2} strokeDasharray="2 16" strokeLinecap="round" className="cable-flow" />}
        </>
      )}
      {kind === 'fluid' && (
        <>
          <path d={d} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={10} transform="translate(0,3)" />
          {selected && <path d={d} fill="none" stroke="#47b5e0" strokeOpacity={0.4} strokeWidth={14} />}
          <path d={d} fill="none" stroke="#0e1416" strokeWidth={9} strokeLinecap="round" />
          <path d={d} fill="none" stroke={hex} strokeWidth={7} strokeLinecap="round" />
          <path d={d} fill="none" stroke="rgba(0,0,0,.38)" strokeWidth={7} strokeDasharray="1.6 4.4" />
          <path d={d} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={1.6} />
          {flow > 0 && <path d={d} fill="none" stroke="#c9eeff" strokeWidth={2.4} strokeDasharray="7 13" strokeLinecap="round" className="cable-water" />}
        </>
      )}
      {kind === 'item' && (
        <>
          <path d={d} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth={15} transform="translate(0,3)" />
          {selected && <path d={d} fill="none" stroke="#a9bb4b" strokeOpacity={0.4} strokeWidth={20} />}
          <path d={d} fill="none" stroke="#0e1416" strokeWidth={14} />
          <path d={d} fill="none" stroke={hex} strokeWidth={11} />
          <path d={d} fill="none" stroke="rgba(120,130,134,.42)" strokeWidth={11} />
          <path d={d} fill="none" stroke="#11181b" strokeWidth={14} strokeDasharray="3.5 27" />
          <path d={d} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth={2.5} />
          {itemActive && w.pipeItem[id] && (
            <image href={iconUrl(w.pipeItem[id])} width={20} height={20} x={-10} y={-10}>
              <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
            </image>
          )}
        </>
      )}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="react-flow__edge-interaction"
        onDoubleClick={addPoint}
        style={{ pointerEvents: 'stroke' }}
      />
      {sel === 1 && points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={7}
          className="waypoint nodrag nopan"
          onPointerDown={dragPoint(i)}
          onDoubleClick={removePoint(i)}
        />
      ))}
    </g>
  );
}

export default memo(CableEdgeView);

/** The textured cable look without live effects, used for the cable you're holding. */
export function CableLayers({ d, kind, hex }: { d: string; kind: string; hex: string }) {
  if (kind === 'fluid')
    return (
      <>
        <path d={d} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={10} transform="translate(0,3)" />
        <path d={d} fill="none" stroke="#0e1416" strokeWidth={9} strokeLinecap="round" />
        <path d={d} fill="none" stroke={hex} strokeWidth={7} strokeLinecap="round" />
        <path d={d} fill="none" stroke="rgba(0,0,0,.38)" strokeWidth={7} strokeDasharray="1.6 4.4" />
        <path d={d} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={1.6} />
      </>
    );
  if (kind === 'item')
    return (
      <>
        <path d={d} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth={15} transform="translate(0,3)" />
        <path d={d} fill="none" stroke="#0e1416" strokeWidth={14} />
        <path d={d} fill="none" stroke={hex} strokeWidth={11} />
        <path d={d} fill="none" stroke="rgba(120,130,134,.42)" strokeWidth={11} />
        <path d={d} fill="none" stroke="#11181b" strokeWidth={14} strokeDasharray="3.5 27" />
        <path d={d} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth={2.5} />
      </>
    );
  return (
    <>
      <path d={d} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={5} transform="translate(0,2)" />
      <path d={d} fill="none" stroke={hex} strokeWidth={3.2} strokeLinecap="round" />
      <path d={d} fill="none" stroke={lighten(hex, 70)} strokeOpacity={0.45} strokeWidth={1} />
    </>
  );
}
