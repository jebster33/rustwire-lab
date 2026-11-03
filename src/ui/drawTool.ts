import { useStore, type Pt } from '../store';
import { world, notify } from '../sim/world';
import { DEF, type PortKind } from '../sim/defs';

export const kindOfHandle = (nodeId: string, handle: string): PortKind | null => {
  const n = world.current.nodes[nodeId];
  return n ? DEF[n.def].ports.find((p) => p.key === handle.slice(2))?.kind ?? null : null;
};

/** Centre of a handle in flow coordinates, read from the DOM. */
export function handlePos(nodeId: string, handle: string, toFlow: (p: Pt) => Pt): Pt | null {
  const el = document.querySelector(`.react-flow__handle[data-nodeid="${CSS.escape(nodeId)}"][data-handleid="${CSS.escape(handle)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return toFlow({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

/** Handles a port click while the wire tool is on. Returns true when it used the click. */
export function portClick(nodeId: string, handle: string): boolean {
  const s = useStore.getState();
  if (!s.drawMode) return false;
  const kind = kindOfHandle(nodeId, handle);
  if (!kind) return true;
  const p = s.pending;
  if (!p) {
    s.setPending({ node: nodeId, handle, kind, points: [] });
    return true;
  }
  if (p.node === nodeId && p.handle === handle) { s.setPending(null); return true; }
  const fromOut = p.handle.startsWith('o:');
  const toOut = handle.startsWith('o:');
  if (p.kind !== kind || fromOut === toOut || p.node === nodeId) {
    notify(world.current, p.kind !== kind ? 'That port takes a different kind of cable.' : 'Connect an output to an input.', 'warn');
    s.bump();
    return true;
  }
  const points = fromOut ? p.points : [...p.points].reverse();
  const conn = fromOut
    ? { source: p.node, sourceHandle: p.handle, target: nodeId, targetHandle: handle }
    : { source: nodeId, sourceHandle: handle, target: p.node, targetHandle: p.handle };
  s.onConnect(conn, points);
  s.setPending(null);
  return true;
}

/** Next corner: snapped to the grid, and kept horizontal or vertical when straight mode is on. */
export function nextCorner(last: Pt, cursor: Pt, straight: boolean): Pt {
  const snap = (v: number) => Math.round(v / 24) * 24;
  if (!straight) return { x: snap(cursor.x), y: snap(cursor.y) };
  const dx = Math.abs(cursor.x - last.x), dy = Math.abs(cursor.y - last.y);
  return dx >= dy ? { x: snap(cursor.x), y: last.y } : { x: last.x, y: snap(cursor.y) };
}
