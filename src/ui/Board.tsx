import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ViewportPortal, useReactFlow,
  ConnectionMode, type Connection, type ConnectionLineComponentProps, type IsValidConnection,
} from '@xyflow/react';
import { useStore, useTick, graphOf, type CableEdge as CableEdgeT, type Pt } from '../store';
import DepNodeView, { PlayerNode } from './DepNode';
import NoteNode from './NoteNode';
import CableEdge, { CableLayers, curvePath, straightPath, type Dir } from './CableEdge';
import { DEF, colorHex } from '../sim/defs';
import { world } from '../sim/world';
import { PX_PER_M, laserSegment } from '../sim/engine';
import { ITEMS, itemName, rawCost } from '../data/items';
import { Ic, ItemIcon } from './icons';
import { handlePos, nextCorner } from './drawTool';

const nodeTypes = { dep: DepNodeView, player: PlayerNode, note: NoteNode };
const edgeTypes = { cable: CableEdge };

/** last pointer position on the board, in flow coordinates (for paste) */
export const cursor: { current: Pt | null } = { current: null };

const portKind = (nodeId: string | null, handle: string | null | undefined) => {
  if (!nodeId || !handle) return null;
  const n = world.current.nodes[nodeId];
  return n ? DEF[n.def].ports.find((p) => p.key === handle.slice(2))?.kind ?? null : null;
};

function ConnLine({ fromX, fromY, toX, toY, fromNode, fromHandle, fromPosition }: ConnectionLineComponentProps) {
  const kind = portKind(fromNode?.id ?? null, fromHandle?.id) ?? 'power';
  const { wireColor, straight } = useStore.getState();
  const sd = (fromPosition ?? 'right') as Dir;
  const td: Dir = sd === 'right' ? 'left' : sd === 'left' ? 'right' : sd === 'top' ? 'bottom' : 'top';
  const pts = [{ x: fromX, y: fromY }, { x: toX, y: toY }];
  const d = straight ? straightPath(pts, sd) : curvePath(pts, sd, td);
  return <g><CableLayers d={d} kind={kind} hex={colorHex(wireColor)} /></g>;
}

/** Range rings and laser beams, drawn in flow space behind the parts. */
function Overlays() {
  useTick();
  const nodes = useStore((s) => s.nodes);
  const g = graphOf(nodes, []);
  const out: React.ReactNode[] = [];
  for (const rn of nodes) {
    const n = world.current.nodes[rn.id];
    const r = g.rects[rn.id];
    if (!n || !r) continue;
    const def = DEF[n.def];
    if (n.def === 'laser') {
      const seg = laserSegment(r, Number(n.params.angle), Number(n.params.length));
      out.push(
        <svg key={`l${rn.id}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <line x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y} stroke={n.st.hit ? '#ff4a3d' : '#ff6b5a'} strokeOpacity={n.pin.in > 0 ? 0.9 : 0.25} strokeWidth={n.st.hit ? 3 : 1.6} strokeDasharray={n.pin.in > 0 ? undefined : '4 6'} />
        </svg>,
      );
    }
    if (!def.radius || !rn.selected) continue;
    // hoppers measure from their container
    const base = n.def === 'hopper' && rn.parentId ? g.rects[rn.parentId] ?? r : r;
    const rad = def.radius(n.params) * PX_PER_M;
    const cls = def.cat === 'defense' || n.def === 'explosive' ? 'ring danger' : n.def === 'sprinkler' ? 'ring water' : 'ring';
    out.push(<div key={rn.id} className={cls} style={{ left: base.x - rad, top: base.y - rad, width: base.w + 2 * rad, height: base.h + 2 * rad, borderRadius: rad + 8 }} />);
  }
  return <ViewportPortal>{out}</ViewportPortal>;
}

/** Custom background image placed in board space so it pans and zooms with the parts. */
function BackgroundImage() {
  const bg = useStore((s) => s.bg);
  if (!bg?.url) return null;
  return (
    <ViewportPortal>
      <img className="board-bg" src={bg.url} alt="" draggable={false} style={{ left: bg.x, top: bg.y, width: bg.w, opacity: bg.opacity }} />
    </ViewportPortal>
  );
}

/** Live preview of a cable being drawn with the wire tool. */
function PendingWire({ mouse }: { mouse: Pt | null }) {
  const pending = useStore((s) => s.pending);
  const straight = useStore((s) => s.straight);
  const color = useStore((s) => s.wireColor);
  const { screenToFlowPosition } = useReactFlow();
  if (!pending) return null;
  const start = handlePos(pending.node, pending.handle, screenToFlowPosition);
  if (!start) return null;
  const pts = [start, ...pending.points];
  const last = pts[pts.length - 1];
  if (mouse) pts.push(pending.drag ? mouse : nextCorner(last, mouse, straight));
  if (pts.length < 2) return null;
  // leave the held port the way a real cable would, and arrive at the cursor from the opposite side
  const n = world.current.nodes[pending.node];
  const side = (n && DEF[n.def].ports.find((p) => p.key === pending.handle.slice(2))?.side) as Dir | undefined;
  const sd: Dir = side ?? (pending.handle.startsWith('o:') ? 'right' : 'left');
  const td: Dir = sd === 'right' ? 'left' : sd === 'left' ? 'right' : sd === 'top' ? 'bottom' : 'top';
  const style = pending.style ?? (straight ? 'straight' : 'curve');
  const d = style === 'straight' ? straightPath(pts, sd) : curvePath(pts, sd, td);
  return (
    <ViewportPortal>
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 5 }}>
        <CableLayers d={d} kind={pending.kind} hex={colorHex(pending.color ?? color)} />
        {pending.points.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={4} fill="#ebe4d8" />)}
      </svg>
    </ViewportPortal>
  );
}

/** Explosions drawn above the parts, in screen space. */
function BlastLayer() {
  useTick();
  const { flowToScreenPosition, getZoom } = useReactFlow();
  const last = world.current.blasts[world.current.blasts.length - 1];
  const lastId = last && !last.dud ? last.id : 0;
  useEffect(() => {
    if (!lastId || Date.now() - (last?.at ?? 0) > 500) return;
    const el = document.querySelector('.board');
    el?.classList.add('shaking');
    const t = setTimeout(() => el?.classList.remove('shaking'), 750);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);
  const host = document.querySelector('.board')?.getBoundingClientRect();
  const now = Date.now();
  const live = world.current.blasts.filter((b) => now - b.at < 1600);
  if (!live.length || !host) return null;
  const z = getZoom();
  return (
    <div className="blast-layer">
      {live.map((b) => {
        const p = flowToScreenPosition({ x: b.x, y: b.y });
        const r = Math.max(b.r, 70) * z * 1.15;
        return (
          <div key={b.id} className={`blast ${b.dud ? 'dud' : ''}`} style={{ left: p.x - host.left - r, top: p.y - host.top - r, width: r * 2, height: r * 2 }}>
            <i /><b />
          </div>
        );
      })}
    </div>
  );
}

/** Total crafting cost of everything on the board. */
function CostPanel() {
  const nodes = useStore((s) => s.nodes);
  const show = useStore((s) => s.showCost);
  const setShow = useStore((s) => s.setShowCost);
  const [raw, setRaw] = useState(false);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const rn of nodes) {
      const n = world.current.nodes[rn.id];
      if (!n) continue;
      const icon = DEF[n.def].icon;
      if (!ITEMS[icon]?.c || DEF[n.def].cat === 'sim') continue;
      const parts = raw ? rawCost(icon, 1).totals : ITEMS[icon].c!.i;
      for (const [s, a] of parts) m.set(s, (m.get(s) ?? 0) + a);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes, raw]);
  if (!totals.length) return null;
  if (!show)
    return (
      <button className="cost-toggle" onClick={() => setShow(true)} title="Show total crafting cost">
        {totals.slice(0, 3).map(([s]) => <ItemIcon key={s} s={s} size={18} />)}
        <span>Cost</span>
      </button>
    );
  return (
    <div className="cost-panel">
      <div className="cost-head">
        <span>Build cost</span>
        <button className={`cost-mode ${raw ? '' : 'on'}`} onClick={() => setRaw(false)}>Recipe</button>
        <button className={`cost-mode ${raw ? 'on' : ''}`} onClick={() => setRaw(true)}>Raw</button>
        <button className="btn icon ghost" style={{ width: 28, height: 28 }} onClick={() => setShow(false)} aria-label="Hide build cost"><Ic.x /></button>
      </div>
      <div className="cost-list">
        {totals.map(([s, a]) => (
          <div key={s} className="cost-item" title={itemName(s)}>
            <ItemIcon s={s} size={28} />
            <span>{Math.ceil(a).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Board() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const addNode = useStore((s) => s.addNode);
  const addNote = useStore((s) => s.addNote);
  const checkpoint = useStore((s) => s.checkpoint);
  const drawMode = useStore((s) => s.drawMode);
  const pending = useStore((s) => s.pending);
  const setPending = useStore((s) => s.setPending);
  const straight = useStore((s) => s.straight);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const fitReq = useStore((s) => s.fitReq);
  const [mouse, setMouse] = useState<Pt | null>(null);

  useEffect(() => {
    if (!fitReq) return;
    const t = setTimeout(() => fitView({ maxZoom: 1.1, minZoom: matchMedia('(max-width: 820px)').matches ? 0.2 : 0.45, padding: 0.12, duration: 300 }), 80);
    return () => clearTimeout(t);
  }, [fitReq, fitView]);

  // Esc cancels a cable being drawn
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && useStore.getState().pending) useStore.getState().setPending(null); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const isValid: IsValidConnection<CableEdgeT> = useCallback((c: Connection | CableEdgeT) => {
    if (c.source === c.target) return false;
    const a = portKind(c.source, c.sourceHandle), b = portKind(c.target, c.targetHandle);
    return !!a && a === b && !!c.sourceHandle?.startsWith('o:') && !!c.targetHandle?.startsWith('i:');
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const def = e.dataTransfer.getData('application/x-rustwire');
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (def === 'note_box' || def === 'note_text') return addNote(def === 'note_box' ? 'box' : 'text', p);
      if (!def || !DEF[def]) return;
      addNode(def, { x: p.x - (def === 'player' ? 22 : 96), y: p.y - (def === 'player' ? 22 : 36) });
    },
    [addNode, addNote, screenToFlowPosition],
  );

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    const s = useStore.getState();
    if (!s.drawMode || !s.pending) return;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const start = handlePos(s.pending.node, s.pending.handle, screenToFlowPosition);
    const last = s.pending.points[s.pending.points.length - 1] ?? start ?? p;
    s.setPending({ ...s.pending, points: [...s.pending.points, nextCorner(last, p, s.straight)] });
  }, [screenToFlowPosition]);

  const minimapColor = useMemo(() => (n: { id: string }) => {
    const w = world.current.nodes[n.id];
    if (!w) return 'rgba(235,228,216,.12)';
    if (w.def === 'player') return '#8fc04a';
    return w.on ? '#ffb627' : '#5b554c';
  }, []);

  return (
    <div
      className={`board ${drawMode ? 'drawing' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={onDrop}
      onPointerMove={(e) => {
        const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        cursor.current = p;
        if (pending) setMouse(p);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(c) => onConnect(c)}
        onNodeDragStart={() => checkpoint()}
        isValidConnection={isValid}
        connectionLineComponent={ConnLine}
        connectionMode={ConnectionMode.Strict}
        connectionRadius={28}
        nodesConnectable={!drawMode}
        edgesReconnectable={false}
        onPaneClick={onPaneClick}
        onPaneContextMenu={(e) => { if (useStore.getState().pending) { e.preventDefault(); setPending(null); } }}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        snapToGrid
        snapGrid={[24, 24]}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        elevateEdgesOnSelect
        zoomOnDoubleClick={false}
        defaultViewport={{ x: 80, y: 80, zoom: 0.9 }}
      >
        <Background id="m1" variant={BackgroundVariant.Lines} gap={PX_PER_M} color="rgba(235,228,216,0.03)" lineWidth={1} />
        <Background id="m5" variant={BackgroundVariant.Lines} gap={PX_PER_M * 5} color="rgba(235,228,216,0.075)" lineWidth={1} />
        <BackgroundImage />
        <Overlays />
        <PendingWire mouse={mouse} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable nodeColor={minimapColor} maskColor="rgba(20,17,14,.6)" className="hide-sm" />
      </ReactFlow>
      <CostPanel />
      <BlastLayer />
      {pending?.drag && <div className="draw-hint">Drop the cable on a port to plug it in, or on the board to unplug it.</div>}
      {drawMode && (
        <div className="draw-hint">
          {pending ? 'Click the board to place corners, click a port to finish. Esc or right-click cancels.' : `Wire tool: click a port to start a ${straight ? 'straight' : 'curved'} cable.`}
        </div>
      )}
      {nodes.length === 0 && <EmptyHint />}
    </div>
  );
}

function EmptyHint() {
  const setPanel = useStore((s) => s.setPanel);
  const setDialog = useStore((s) => s.setDialog);
  return (
    <div className="empty-hint">
      <div>
        <h3>Start wiring</h3>
        <p>Drag a deployable onto the board, then pull a cable from an output to an input. Ready-made setups are in the gallery.</p>
        <div className="btnrow" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => setPanel('items')}><Ic.plus />Add items</button>
          <button className="btn" onClick={() => setDialog('gallery')}><Ic.globe />Browse examples</button>
        </div>
      </div>
    </div>
  );
}
