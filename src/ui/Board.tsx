import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ViewportPortal, useReactFlow,
  ConnectionMode, type Connection, type ConnectionLineComponentProps, type IsValidConnection,
} from '@xyflow/react';
import { useStore, useTick, type CableEdge as CableEdgeT } from '../store';
import DepNodeView, { PlayerNode } from './DepNode';
import CableEdge from './CableEdge';
import { DEF, colorHex } from '../sim/defs';
import { world } from '../sim/world';
import { PX_PER_M, laserSegment } from '../sim/engine';
import { Ic } from './icons';

const nodeTypes = { dep: DepNodeView, player: PlayerNode };
const edgeTypes = { cable: CableEdge };

const portKind = (nodeId: string | null, handle: string | null | undefined) => {
  if (!nodeId || !handle) return null;
  const n = world.current.nodes[nodeId];
  return n ? DEF[n.def].ports.find((p) => p.key === handle.slice(2))?.kind ?? null : null;
};

function ConnLine({ fromX, fromY, toX, toY, fromNode, fromHandle }: ConnectionLineComponentProps) {
  const kind = portKind(fromNode?.id ?? null, fromHandle?.id);
  const color = colorHex(useStore.getState().wireColor);
  const w = kind === 'item' ? 11 : kind === 'fluid' ? 7 : 3;
  const dx = Math.max(40, Math.abs(toX - fromX) * 0.5);
  const d = `M${fromX},${fromY} C${fromX + dx},${fromY} ${toX - dx},${toY} ${toX},${toY}`;
  return (
    <g>
      <path d={d} fill="none" stroke="#0e1416" strokeWidth={w + 2} />
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeDasharray={kind === 'power' ? undefined : '6 4'} />
    </g>
  );
}

function Overlays() {
  useTick();
  const nodes = useStore((s) => s.nodes);
  const rings: React.ReactNode[] = [];
  for (const rn of nodes) {
    const n = world.current.nodes[rn.id];
    if (!n) continue;
    const def = DEF[n.def];
    const w = rn.measured?.width ?? 200, h = rn.measured?.height ?? 120;
    if (n.def === 'laser') {
      const seg = laserSegment({ x: rn.position.x, y: rn.position.y, w, h }, Number(n.params.angle), Number(n.params.length));
      rings.push(
        <svg key={`l${rn.id}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <line x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y} stroke={n.st.hit ? '#ff4a3d' : '#ff6b5a'} strokeOpacity={n.pin.in > 0 ? 0.9 : 0.25} strokeWidth={n.st.hit ? 3 : 1.6} strokeDasharray={n.pin.in > 0 ? undefined : '4 6'} />
        </svg>,
      );
    }
    if (!def.radius || !rn.selected) continue;
    const r = def.radius(n.params) * PX_PER_M;
    const cls = def.cat === 'defense' ? 'ring danger' : n.def === 'sprinkler' ? 'ring water' : 'ring';
    // range measured from the item's edge, so draw a rounded rect grown by r
    rings.push(
      <div
        key={rn.id}
        className={cls}
        style={{ left: rn.position.x - r, top: rn.position.y - r, width: w + 2 * r, height: h + 2 * r, borderRadius: r + 8 }}
      />,
    );
  }
  return <ViewportPortal>{rings}</ViewportPortal>;
}

export default function Board() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const addNode = useStore((s) => s.addNode);
  const checkpoint = useStore((s) => s.checkpoint);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const fitReq = useStore((s) => s.fitReq);
  useEffect(() => {
    if (!fitReq) return;
    const t = setTimeout(() => fitView({ maxZoom: 1.1, minZoom: matchMedia('(max-width: 820px)').matches ? 0.2 : 0.5, padding: 0.12, duration: 300 }), 80);
    return () => clearTimeout(t);
  }, [fitReq, fitView]);

  const isValid: IsValidConnection<CableEdgeT> = useCallback((c: Connection | CableEdgeT) => {
    if (c.source === c.target) return false;
    const a = portKind(c.source, c.sourceHandle), b = portKind(c.target, c.targetHandle);
    return !!a && a === b && !!c.sourceHandle?.startsWith('o:') && !!c.targetHandle?.startsWith('i:');
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const def = e.dataTransfer.getData('application/x-rustwire');
      if (!def || !DEF[def]) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(def, { x: Math.round(p.x / 12) * 12 - (def === 'player' ? 22 : 100), y: Math.round(p.y / 12) * 12 - (def === 'player' ? 22 : 40) });
    },
    [addNode, screenToFlowPosition],
  );

  const minimapColor = useMemo(() => (n: { id: string }) => {
    const w = world.current.nodes[n.id];
    if (!w) return '#3b4950';
    if (w.def === 'player') return '#7fc75a';
    return w.on ? '#f3b23a' : '#4a5a61';
  }, []);

  return (
    <div className="board" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={() => checkpoint()}
        isValidConnection={isValid}
        connectionLineComponent={ConnLine}
        connectionMode={ConnectionMode.Strict}
        connectionRadius={28}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        snapToGrid
        snapGrid={[12, 12]}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ maxZoom: 1.1, padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
        elevateEdgesOnSelect
        zoomOnDoubleClick={false}
      >
        <Background id="m1" variant={BackgroundVariant.Lines} gap={PX_PER_M} color="rgba(235,228,216,0.028)" lineWidth={1} />
        <Background id="m5" variant={BackgroundVariant.Lines} gap={PX_PER_M * 5} color="rgba(235,228,216,0.07)" lineWidth={1} />
        <Overlays />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable nodeColor={minimapColor} maskColor="rgba(20,17,14,.6)" className="hide-sm" />
      </ReactFlow>
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
        <p>Drag a deployable onto the board, then pull a cable from an output to an input. Double-click a cable to bend it.</p>
        <div className="btnrow" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => { setPanel('items'); }}><Ic.plus />Add items</button>
          <button className="btn" onClick={() => setDialog('open')}><Ic.open />Load an example</button>
        </div>
      </div>
    </div>
  );
}
