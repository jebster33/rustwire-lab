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
  if (!s.pending) {
    // clicking a port that already has a cable picks that cable up
    if (!s.pickUp(nodeId, handle)) s.setPending({ node: nodeId, handle, kind, points: [] });
    else s.setPending({ ...useStore.getState().pending!, drag: false });
    return true;
  }
  return finishAt(nodeId, handle);
}

/** Plug the cable being held into this port. */
export function finishAt(nodeId: string, handle: string): boolean {
  const s = useStore.getState();
  const kind = kindOfHandle(nodeId, handle);
  const p = s.pending;
  if (!p || !kind) return false;
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
  s.setPending(null);
  s.onConnect(conn, points, { color: p.color, style: p.style });
  return true;
}

/**
 * Pointer-down on a port that already has a cable: pick the cable's end up and drag it.
 * Release over another port to re-plug it, or over empty board to unplug it.
 */
/** set when a pick-up started, so the matching mousedown/touchstart doesn't start a new cable too */
export const swallow = { current: false };
export function startPickUp(nodeId: string, handle: string, e: React.PointerEvent): boolean {
  const s = useStore.getState();
  if (s.drawMode || s.pending) return false;
  if (!s.pickUp(nodeId, handle)) return false;
  swallow.current = true;
  setTimeout(() => { swallow.current = false; }, 400);
  e.stopPropagation();
  e.preventDefault();
  const up = (ev: PointerEvent) => {
    removeEventListener('pointerup', up, true);
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.react-flow__handle') as HTMLElement | null;
    const st = useStore.getState();
    if (!st.pending) return;
    const nid = el?.dataset.nodeid, hid = el?.dataset.handleid;
    if (nid && hid && !(nid === st.pending.node && hid === st.pending.handle)) {
      const k = kindOfHandle(nid, hid);
      const fromOut = st.pending.handle.startsWith('o:');
      if (k === st.pending.kind && fromOut !== hid.startsWith('o:') && nid !== st.pending.node) { finishAt(nid, hid); return; }
      notify(world.current, k !== st.pending.kind ? 'That port takes a different kind of cable. Cable unplugged.' : 'Connect an output to an input. Cable unplugged.', 'warn');
    }
    st.setPending(null);
    st.bump();
  };
  addEventListener('pointerup', up, true);
  return true;
}

/** Next corner: snapped to the grid, and kept horizontal or vertical when straight mode is on. */
export function nextCorner(last: Pt, cursor: Pt, straight: boolean): Pt {
  const snap = (v: number) => Math.round(v / 24) * 24;
  if (!straight) return { x: snap(cursor.x), y: snap(cursor.y) };
  const dx = Math.abs(cursor.x - last.x), dy = Math.abs(cursor.y - last.y);
  return dx >= dy ? { x: snap(cursor.x), y: last.y } : { x: last.x, y: snap(cursor.y) };
}
