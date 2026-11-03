import { create } from 'zustand';
import {
  applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import { DEF, portsOf, type PortKind } from './sim/defs';
import { world, makeNode, newWorld, snapshotWorld, restoreWorld } from './sim/world';
import { settle, type Graph, type Rect } from './sim/engine';

export type CableData = { kind: PortKind; color: string; points: { x: number; y: number }[] };
export type DepNode = Node<{ def: string }, 'dep' | 'player'>;
export type CableEdge = Edge<CableData, 'cable'>;

export type SaveMeta = { cloudId?: string; editKey?: string; visibility?: 'public' | 'private'; localId?: string };

type Snap = { nodes: DepNode[]; edges: CableEdge[]; world: unknown };

interface State {
  nodes: DepNode[];
  edges: CableEdge[];
  tick: number;
  fitReq: number;
  running: boolean;
  speed: number;
  wireColor: string;
  title: string;
  meta: SaveMeta;
  past: Snap[];
  future: Snap[];
  panel: 'items' | 'inspect' | 'sim' | null; // mobile sheet
  dialog: null | 'save' | 'open' | 'gallery' | 'calc' | 'help';
  lootPlayer: string | null;
  setPanel: (p: State['panel']) => void;
  setDialog: (d: State['dialog']) => void;
  bump: () => void;
  poke: () => void;
  onNodesChange: (c: NodeChange<DepNode>[]) => void;
  onEdgesChange: (c: EdgeChange<CableEdge>[]) => void;
  onConnect: (c: Connection) => void;
  addNode: (def: string, pos: { x: number; y: number }, params?: Record<string, unknown>) => string;
  removeSelected: () => void;
  removeIds: (ids: string[]) => void;
  duplicateSelected: () => void;
  setParam: (id: string, key: string, value: unknown) => void;
  setEdge: (id: string, patch: Partial<CableData>) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  load: (doc: SaveDoc, meta?: SaveMeta, title?: string) => void;
  clear: () => void;
  serialize: () => SaveDoc;
  setRunning: (r: boolean) => void;
  setSpeed: (s: number) => void;
  setWireColor: (c: string) => void;
  setTitle: (t: string) => void;
  setMeta: (m: SaveMeta) => void;
  setLootPlayer: (id: string | null) => void;
}

export type SaveDoc = {
  v: 1;
  nodes: { id: string; def: string; x: number; y: number }[];
  edges: { id: string; s: string; sh: string; t: string; th: string; kind: PortKind; color: string; points: { x: number; y: number }[] }[];
  world: unknown;
};

const kindOf = (nodeId: string, handle: string | null | undefined): PortKind | null => {
  const n = world.current.nodes[nodeId];
  if (!n || !handle) return null;
  const p = DEF[n.def].ports.find((x) => x.key === handle.slice(2));
  return p?.kind ?? null;
};

export function graphOf(nodes: DepNode[], edges: CableEdge[]): Graph {
  const rects: Record<string, Rect> = {};
  for (const n of nodes) {
    const w = n.measured?.width ?? (n.type === 'player' ? 44 : 200);
    const h = n.measured?.height ?? (n.type === 'player' ? 44 : 120);
    rects[n.id] = { x: n.position.x, y: n.position.y, w, h };
  }
  return {
    rects,
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle!, target: e.target, targetHandle: e.targetHandle! })),
  };
}

export const useStore = create<State>((set, get) => {
  const resettle = () => {
    const { nodes, edges } = get();
    if (!get().running) settle(world.current, graphOf(nodes, edges));
    set((s) => ({ tick: s.tick + 1 }));
  };
  const snap = (): Snap => ({ nodes: get().nodes, edges: get().edges, world: snapshotWorld(world.current) });
  const applySnap = (s: Snap) => {
    world.current = restoreWorld(s.world);
    set({ nodes: s.nodes, edges: s.edges });
    resettle();
  };
  return {
    nodes: [],
    edges: [],
    tick: 0,
    fitReq: 0,
    running: true,
    speed: 1,
    wireColor: 'default',
    title: 'Untitled base',
    meta: {},
    past: [],
    future: [],
    panel: null,
    dialog: null,
    lootPlayer: null,
    setPanel: (panel) => set({ panel }),
    setDialog: (dialog) => set({ dialog }),
    bump: () => set((s) => ({ tick: s.tick + 1 })),
    poke: () => resettle(),
    checkpoint: () => set((s) => ({ past: [...s.past.slice(-49), snap()], future: [] })),
    undo: () => {
      const { past } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set((s) => ({ past: s.past.slice(0, -1), future: [snap(), ...s.future].slice(0, 50) }));
      applySnap(prev);
    },
    redo: () => {
      const { future } = get();
      if (!future.length) return;
      const next = future[0];
      set((s) => ({ future: s.future.slice(1), past: [...s.past, snap()] }));
      applySnap(next);
    },
    onNodesChange: (changes) => {
      const removing = changes.filter((c) => c.type === 'remove');
      if (removing.length) get().checkpoint();
      for (const c of removing) delete world.current.nodes[c.id];
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
      if (removing.length || changes.some((c) => c.type === 'position' && !c.dragging) || changes.some((c) => c.type === 'dimensions')) resettle();
    },
    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) get().checkpoint();
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
      if (changes.some((c) => c.type === 'remove')) resettle();
    },
    onConnect: (c) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
      const kind = kindOf(c.source, c.sourceHandle);
      if (!kind || kind !== kindOf(c.target, c.targetHandle)) return;
      get().checkpoint();
      // one cable per port, like in-game: replace existing ones on either end
      const edges = get().edges.filter(
        (e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle) && !(e.target === c.target && e.targetHandle === c.targetHandle),
      );
      const edge: CableEdge = {
        id: nanoid(8),
        source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle,
        type: 'cable',
        data: { kind, color: get().wireColor, points: [] },
      };
      set({ edges: [...edges, edge] });
      resettle();
    },
    addNode: (def, pos, params) => {
      get().checkpoint();
      const id = nanoid(8);
      world.current.nodes[id] = makeNode(id, def, params as Record<string, any>);
      const node: DepNode = { id, type: def === 'player' ? 'player' : 'dep', position: pos, data: { def } };
      set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] }));
      resettle();
      return id;
    },
    removeSelected: () => {
      const { nodes, edges } = get();
      const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
      const eids = new Set(edges.filter((e) => e.selected || ids.has(e.source) || ids.has(e.target)).map((e) => e.id));
      if (!ids.size && !eids.size) return;
      get().checkpoint();
      for (const id of ids) delete world.current.nodes[id];
      set({ nodes: nodes.filter((n) => !ids.has(n.id)), edges: edges.filter((e) => !eids.has(e.id)) });
      resettle();
    },
    removeIds: (ids) => {
      const set_ = new Set(ids.filter((id) => world.current.nodes[id]));
      if (!set_.size) return;
      get().checkpoint();
      for (const id of set_) delete world.current.nodes[id];
      set((s) => ({ nodes: s.nodes.filter((n) => !set_.has(n.id)), edges: s.edges.filter((e) => !set_.has(e.source) && !set_.has(e.target)) }));
      resettle();
    },
    duplicateSelected: () => {
      const sel = get().nodes.filter((n) => n.selected);
      if (!sel.length) return;
      get().checkpoint();
      const map = new Map<string, string>();
      const added: DepNode[] = [];
      for (const n of sel) {
        const id = nanoid(8);
        map.set(n.id, id);
        const src = world.current.nodes[n.id];
        const copy = makeNode(id, src.def, JSON.parse(JSON.stringify(src.params)));
        copy.inv = JSON.parse(JSON.stringify(src.inv));
        copy.st = JSON.parse(JSON.stringify(src.st));
        world.current.nodes[id] = copy;
        added.push({ id, type: n.type, data: { ...n.data }, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true });
      }
      const newEdges = get().edges
        .filter((e) => map.has(e.source) && map.has(e.target))
        .map((e) => ({ ...e, id: nanoid(8), source: map.get(e.source)!, target: map.get(e.target)!, selected: false, data: { ...e.data!, points: e.data!.points.map((p) => ({ x: p.x + 40, y: p.y + 40 })) } }));
      set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...added], edges: [...s.edges, ...newEdges] }));
      resettle();
    },
    setParam: (id, key, value) => {
      const n = world.current.nodes[id];
      if (!n) return;
      n.params[key] = value;
      const def = DEF[n.def];
      // drop cables attached to ports that disappeared (e.g. storage adaptor removed)
      const live = new Set(portsOf(def, n.params).map((p) => p.key));
      const edges = get().edges.filter(
        (e) => !((e.source === id && !live.has(e.sourceHandle!.slice(2))) || (e.target === id && !live.has(e.targetHandle!.slice(2)))),
      );
      if (edges.length !== get().edges.length) set({ edges });
      resettle();
    },
    setEdge: (id, patch) => {
      set((s) => ({ edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data!, ...patch } } : e)) }));
    },
    serialize: () => {
      const { nodes, edges } = get();
      return {
        v: 1,
        nodes: nodes.map((n) => ({ id: n.id, def: n.data.def, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
        edges: edges.map((e) => ({ id: e.id, s: e.source, sh: e.sourceHandle!, t: e.target, th: e.targetHandle!, kind: e.data!.kind, color: e.data!.color, points: e.data!.points })),
        world: snapshotWorld(world.current),
      };
    },
    load: (doc, meta = {}, title) => {
      world.current = restoreWorld(doc.world ?? {});
      const nodes: DepNode[] = doc.nodes
        .filter((n) => DEF[n.def])
        .map((n) => {
          if (!world.current.nodes[n.id]) world.current.nodes[n.id] = makeNode(n.id, n.def);
          return { id: n.id, type: n.def === 'player' ? 'player' : 'dep', position: { x: n.x, y: n.y }, data: { def: n.def } };
        });
      const ids = new Set(nodes.map((n) => n.id));
      const edges: CableEdge[] = doc.edges
        .filter((e) => ids.has(e.s) && ids.has(e.t))
        .map((e) => ({ id: e.id, source: e.s, sourceHandle: e.sh, target: e.t, targetHandle: e.th, type: 'cable', data: { kind: e.kind, color: e.color, points: e.points ?? [] } }));
      set((st) => ({ nodes, edges, meta, past: [], future: [], fitReq: st.fitReq + 1, ...(title ? { title } : {}) }));
      resettle();
    },
    clear: () => {
      get().checkpoint();
      world.current = newWorld();
      set({ nodes: [], edges: [], meta: {}, title: 'Untitled base' });
      resettle();
    },
    setRunning: (running) => set({ running }),
    setSpeed: (speed) => set({ speed }),
    setWireColor: (wireColor) => set({ wireColor }),
    setTitle: (title) => set({ title }),
    setMeta: (meta) => set({ meta }),
    setLootPlayer: (lootPlayer) => set({ lootPlayer }),
  };
});

/** Re-render hook: components call this to update on sim ticks. */
export const useTick = () => useStore((s) => s.tick);
