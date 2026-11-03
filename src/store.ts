import { create } from 'zustand';
import {
  applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import { DEF, portsOf, type PortKind } from './sim/defs';
import { world, makeNode, newWorld, snapshotWorld, restoreWorld, notify, type Slot } from './sim/world';
import { settle, type Graph, type Rect } from './sim/engine';

export type Pt = { x: number; y: number };
export type CableData = { kind: PortKind; color: string; points: Pt[]; style?: 'curve' | 'straight' };
export type NoteData = { def: string; kind: 'box' | 'text'; text: string; color: string; size?: number };
export type DepData = { def: string } & Partial<NoteData>;
export type DepNode = Node<DepData, 'dep' | 'player' | 'note'>;
export type CableEdge = Edge<CableData, 'cable'>;

export type SaveMeta = { cloudId?: string; editKey?: string; visibility?: 'public' | 'private'; localId?: string };
export type Background = { url: string; x: number; y: number; w: number; opacity: number } | null;

type Snap = { nodes: DepNode[]; edges: CableEdge[]; world: unknown };
type Pending = { node: string; handle: string; kind: PortKind; points: Pt[] } | null;

export type SaveDoc = {
  v: 1;
  nodes: { id: string; def: string; x: number; y: number; parent?: string; w?: number; h?: number; note?: NoteData }[];
  edges: { id: string; s: string; sh: string; t: string; th: string; kind: PortKind; color: string; points: Pt[]; style?: 'curve' | 'straight' }[];
  world: unknown;
  bg?: Background;
};

interface State {
  nodes: DepNode[];
  edges: CableEdge[];
  tick: number;
  fitReq: number;
  running: boolean;
  speed: number;
  wireColor: string;
  straight: boolean;
  drawMode: boolean;
  pending: Pending;
  showCost: boolean;
  bg: Background;
  title: string;
  meta: SaveMeta;
  dirty: boolean;
  past: Snap[];
  future: Snap[];
  panel: 'items' | 'inspect' | 'sim' | null; // mobile sheet
  dialog: null | 'save' | 'saveas' | 'open' | 'online' | 'modules' | 'gallery' | 'calc' | 'help' | 'bg' | 'admin';
  setPanel: (p: State['panel']) => void;
  setDialog: (d: State['dialog']) => void;
  bump: () => void;
  poke: () => void;
  onNodesChange: (c: NodeChange<DepNode>[]) => void;
  onEdgesChange: (c: EdgeChange<CableEdge>[]) => void;
  onConnect: (c: Connection, points?: Pt[]) => void;
  reconnect: (old: CableEdge, c: Connection) => void;
  removeEdge: (id: string) => void;
  addNode: (def: string, pos: Pt, params?: Record<string, unknown>) => string | null;
  addNote: (kind: 'box' | 'text', pos: Pt) => void;
  setNote: (id: string, patch: Partial<NoteData>) => void;
  attach: (def: string, hostId: string) => string | null;
  removeSelected: () => void;
  removeIds: (ids: string[]) => void;
  duplicateSelected: () => void;
  copySelected: () => number;
  paste: (at?: Pt) => void;
  insertDoc: (doc: SaveDoc, at?: Pt) => void;
  spawnPile: (x: number, y: number, inv: Slot[]) => void;
  setParam: (id: string, key: string, value: unknown) => void;
  setEdge: (id: string, patch: Partial<CableData>) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  load: (doc: SaveDoc, meta?: SaveMeta, title?: string) => void;
  newBuild: () => void;
  serialize: () => SaveDoc;
  setRunning: (r: boolean) => void;
  setSpeed: (s: number) => void;
  setWireColor: (c: string) => void;
  setStraight: (v: boolean) => void;
  setDrawMode: (v: boolean) => void;
  setPending: (p: Pending) => void;
  setShowCost: (v: boolean) => void;
  setBg: (bg: Background) => void;
  setTitle: (t: string) => void;
  setMeta: (m: SaveMeta) => void;
  markSaved: () => void;
}

const kindOf = (nodeId: string, handle: string | null | undefined): PortKind | null => {
  const n = world.current.nodes[nodeId];
  if (!n || !handle) return null;
  const p = DEF[n.def].ports.find((x) => x.key === handle.slice(2));
  return p?.kind ?? null;
};

export const CARD_W = 216;
const nodeType = (def: string): DepNode['type'] => (def === 'player' ? 'player' : def.startsWith('note_') ? 'note' : 'dep');

/** Absolute rectangles for the sim (child nodes are positioned relative to their host). */
export function graphOf(nodes: DepNode[], edges: CableEdge[]): Graph {
  const rects: Record<string, Rect> = {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.type === 'note') continue;
    const w = n.measured?.width ?? (n.type === 'player' ? 44 : CARD_W);
    const h = n.measured?.height ?? (n.type === 'player' ? 44 : 144);
    let x = n.position.x, y = n.position.y;
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p) { x += p.position.x; y += p.position.y; }
    rects[n.id] = { x, y, w, h };
  }
  return {
    rects,
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle!, target: e.target, targetHandle: e.targetHandle! })),
  };
}

const snapTo = (v: number) => Math.round(v / 24) * 24;
let clipboard: SaveDoc | null = null;
const prefs = (() => { try { return JSON.parse(localStorage.getItem('rw.prefs') ?? '{}'); } catch { return {}; } })();
const savePrefs = (p: Record<string, unknown>) => { try { localStorage.setItem('rw.prefs', JSON.stringify({ ...prefs, ...p })); Object.assign(prefs, p); } catch { /* ignore */ } };

/** order so hosts come before attached children (React Flow requirement) */
const ordered = (nodes: DepNode[]) => [...nodes.filter((n) => !n.parentId), ...nodes.filter((n) => n.parentId)];

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
  /** ids plus every node attached to them */
  const withChildren = (ids: Set<string>) => {
    for (const n of get().nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    return ids;
  };
  const dropIds = (ids: Set<string>) => {
    withChildren(ids);
    for (const id of ids) delete world.current.nodes[id];
    set((s) => ({
      nodes: s.nodes.filter((n) => !ids.has(n.id)),
      edges: s.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      dirty: true,
    }));
  };

  /** Build a SaveDoc fragment of the given node ids (for copy, modules). */
  const fragment = (ids: Set<string>): SaveDoc => {
    withChildren(ids);
    const { nodes, edges } = get();
    const sel = nodes.filter((n) => ids.has(n.id));
    const wnodes: Record<string, unknown> = {};
    for (const n of sel) {
      const w = world.current.nodes[n.id];
      if (w) wnodes[n.id] = JSON.parse(JSON.stringify({ def: w.def, params: w.params, inv: w.inv, st: w.st }));
    }
    return {
      v: 1,
      nodes: sel.map((n) => ({ id: n.id, def: n.data.def, x: n.position.x, y: n.position.y, parent: n.parentId, w: n.width, h: n.height, note: n.type === 'note' ? (n.data as NoteData) : undefined })),
      edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, s: e.source, sh: e.sourceHandle!, t: e.target, th: e.targetHandle!, kind: e.data!.kind, color: e.data!.color, points: e.data!.points, style: e.data!.style })),
      world: { nodes: wnodes },
    };
  };

  return {
    nodes: [],
    edges: [],
    tick: 0,
    fitReq: 0,
    running: true,
    speed: 1,
    wireColor: 'default',
    straight: !!prefs.straight,
    drawMode: false,
    pending: null,
    showCost: prefs.showCost !== false,
    bg: null,
    title: '',
    meta: {},
    dirty: false,
    past: [],
    future: [],
    panel: null,
    dialog: null,
    setPanel: (panel) => set({ panel }),
    setDialog: (dialog) => set({ dialog }),
    bump: () => set((s) => ({ tick: s.tick + 1 })),
    poke: () => { set({ dirty: true }); resettle(); },
    checkpoint: () => set((s) => ({ past: [...s.past.slice(-49), snap()], future: [], dirty: true })),
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
      if (removing.length) {
        get().checkpoint();
        dropIds(new Set(removing.map((c) => c.id)));
      }
      const rest = changes.filter((c) => c.type !== 'remove');
      if (rest.length) set((s) => ({ nodes: applyNodeChanges(rest, s.nodes) }));
      if (removing.length || rest.some((c) => c.type === 'position' && !c.dragging) || rest.some((c) => c.type === 'dimensions')) resettle();
    },
    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) get().checkpoint();
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
      if (changes.some((c) => c.type === 'remove')) resettle();
    },
    onConnect: (c, points = []) => {
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
        data: { kind, color: get().wireColor, points, style: get().straight ? 'straight' : 'curve' },
      };
      set({ edges: [...edges, edge] });
      const tgt = world.current.nodes[c.target];
      const src = world.current.nodes[c.source];
      if (tgt?.def === 'rootcombiner' && src && !DEF[src.def].root) {
        notify(world.current, `${DEF[src.def].name} isn’t root power. In Rust a Root Combiner ignores it.`, 'warn');
      }
      resettle();
    },
    reconnect: (old, c) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return;
      const kind = kindOf(c.source, c.sourceHandle);
      if (!kind || kind !== kindOf(c.target, c.targetHandle)) return;
      get().checkpoint();
      const edges = get().edges.filter(
        (e) => e.id !== old.id && !(e.source === c.source && e.sourceHandle === c.sourceHandle) && !(e.target === c.target && e.targetHandle === c.targetHandle),
      );
      set({ edges: [...edges, { ...old, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }] });
      resettle();
    },
    removeEdge: (id) => {
      get().checkpoint();
      set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }));
      resettle();
    },
    addNode: (def, pos, params) => {
      const d = DEF[def];
      if (d?.attach) {
        // attachments go on a host: the selected one, or the nearest valid one
        const g = graphOf(get().nodes, []);
        const hosts = get().nodes.filter((n) => d.attach!.includes(n.data.def));
        const selected = hosts.find((n) => n.selected);
        let best = selected;
        if (!best) {
          let bd = Infinity;
          for (const h of hosts) {
            const r = g.rects[h.id];
            const dd = Math.hypot(r.x + r.w / 2 - pos.x, r.y + r.h / 2 - pos.y);
            if (dd < bd) { bd = dd; best = h; }
          }
        }
        if (!best) {
          const names = d.attach.map((x) => DEF[x]?.name).filter(Boolean);
          notify(world.current, `${d.name} attaches to a ${names.slice(0, 3).join(' or ')}${names.length > 3 ? '…' : ''}. Place one first.`, 'warn');
          set((s) => ({ tick: s.tick + 1 }));
          return null;
        }
        return get().attach(def, best.id);
      }
      get().checkpoint();
      const id = nanoid(8);
      world.current.nodes[id] = makeNode(id, def, params as Record<string, any>);
      const node: DepNode = { id, type: nodeType(def), position: { x: snapTo(pos.x), y: snapTo(pos.y) }, data: { def } };
      set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] }));
      resettle();
      return id;
    },
    attach: (def, hostId) => {
      const d = DEF[def];
      const host = get().nodes.find((n) => n.id === hostId);
      if (!d || !host || !d.attach?.includes(host.data.def)) return null;
      const existing = get().nodes.filter((n) => n.parentId === hostId && n.data.def === def);
      if (existing.length >= (d.maxPerHost ?? 1)) {
        notify(world.current, `A ${DEF[host.data.def].name} holds at most ${d.maxPerHost ?? 1} ${d.name}${(d.maxPerHost ?? 1) > 1 ? 's' : ''}.`, 'warn');
        set((s) => ({ tick: s.tick + 1 }));
        return null;
      }
      get().checkpoint();
      const id = nanoid(8);
      const wn = makeNode(id, def);
      wn.st.host = hostId;
      world.current.nodes[id] = wn;
      const hw = host.measured?.width ?? CARD_W;
      const hh = host.measured?.height ?? 144;
      const pos =
        def === 'crafter' ? (existing.length === 0 ? { x: hw + 24, y: 0 } : { x: -CARD_W - 24, y: 0 })
        : def === 'storagemonitor' ? { x: 0, y: -168 }
        : { x: 0, y: snapTo(hh + 24) };
      const node: DepNode = { id, type: 'dep', position: pos, parentId: hostId, draggable: false, data: { def } };
      set((s) => ({ nodes: ordered([...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]) }));
      resettle();
      return id;
    },
    addNote: (kind, pos) => {
      get().checkpoint();
      const id = nanoid(8);
      const node: DepNode = kind === 'box'
        ? { id, type: 'note', position: { x: snapTo(pos.x), y: snapTo(pos.y) }, width: 480, height: 312, zIndex: -1, data: { def: 'note_box', kind: 'box', text: '', color: '#ebe4d8' } }
        : { id, type: 'note', position: { x: snapTo(pos.x), y: snapTo(pos.y) }, data: { def: 'note_text', kind: 'text', text: 'Label', color: '#ebe4d8', size: 24 } };
      set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }] }));
    },
    setNote: (id, patch) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), dirty: true })),
    removeSelected: () => {
      const { nodes, edges } = get();
      const ids = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
      const eids = new Set(edges.filter((e) => e.selected).map((e) => e.id));
      if (!ids.size && !eids.size) return;
      get().checkpoint();
      if (eids.size) set((s) => ({ edges: s.edges.filter((e) => !eids.has(e.id)) }));
      dropIds(ids);
      resettle();
    },
    removeIds: (ids) => {
      const set_ = new Set(ids.filter((id) => world.current.nodes[id]));
      if (!set_.size) return;
      get().checkpoint();
      dropIds(set_);
      resettle();
    },
    copySelected: () => {
      const ids = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id));
      if (!ids.size) return 0;
      clipboard = fragment(ids);
      navigator.clipboard?.writeText(JSON.stringify({ rustwire: 1, ...clipboard })).catch(() => { /* clipboard blocked: internal copy still works */ });
      return clipboard.nodes.length;
    },
    paste: (at) => {
      if (!clipboard) return;
      const top = clipboard.nodes.filter((n) => !n.parent);
      const minX = Math.min(...top.map((n) => n.x)), minY = Math.min(...top.map((n) => n.y));
      get().insertDoc(clipboard, at ?? { x: minX + 48, y: minY + 48 });
    },
    duplicateSelected: () => {
      if (get().copySelected()) get().paste();
    },
    insertDoc: (doc, atIn) => {
      get().checkpoint();
      let at = atIn;
      if (!at) {
        // free space to the right of everything already on the board
        const g = graphOf(get().nodes, []);
        const rs = Object.values(g.rects);
        at = rs.length ? { x: Math.max(...rs.map((r) => r.x + r.w)) + 144, y: Math.min(...rs.map((r) => r.y)) } : { x: 0, y: 0 };
      }
      const map = new Map<string, string>();
      for (const n of doc.nodes) map.set(n.id, nanoid(8));
      const top = doc.nodes.filter((n) => !n.parent);
      const minX = Math.min(...top.map((n) => n.x)), minY = Math.min(...top.map((n) => n.y));
      const dx = snapTo(at.x - minX), dy = snapTo(at.y - minY);
      set((st) => ({ fitReq: st.fitReq + 1 }));
      const wsrc = ((doc.world as any)?.nodes ?? {}) as Record<string, any>;
      const added: DepNode[] = [];
      for (const n of doc.nodes) {
        const id = map.get(n.id)!;
        if (!n.def.startsWith('note_')) {
          if (!DEF[n.def]) continue;
          const src = wsrc[n.id];
          const w = makeNode(id, n.def, src?.params ? JSON.parse(JSON.stringify(src.params)) : undefined);
          if (src?.inv) w.inv = JSON.parse(JSON.stringify(src.inv));
          if (src?.st) w.st = { ...w.st, ...JSON.parse(JSON.stringify(src.st)), prev: {} };
          if (w.st.host) w.st.host = map.get(w.st.host) ?? null;
          world.current.nodes[id] = w;
        }
        const parent = n.parent ? map.get(n.parent) : undefined;
        added.push({
          id, type: nodeType(n.def), data: n.note ? { ...n.note } : { def: n.def }, selected: true,
          position: parent ? { x: n.x, y: n.y } : { x: n.x + dx, y: n.y + dy },
          ...(parent ? { parentId: parent, draggable: false } : {}),
          ...(n.w ? { width: n.w, height: n.h } : {}),
          ...(n.def === 'note_box' ? { zIndex: -1 } : {}),
        });
      }
      const newEdges: CableEdge[] = doc.edges
        .filter((e) => map.has(e.s) && map.has(e.t))
        .map((e) => ({
          id: nanoid(8), source: map.get(e.s)!, sourceHandle: e.sh, target: map.get(e.t)!, targetHandle: e.th, type: 'cable',
          data: { kind: e.kind, color: e.color, style: e.style, points: (e.points ?? []).map((p) => ({ x: p.x + dx, y: p.y + dy })) },
        }));
      set((s) => ({ nodes: ordered([...s.nodes.map((n) => ({ ...n, selected: false })), ...added]), edges: [...s.edges, ...newEdges] }));
      resettle();
    },
    spawnPile: (x, y, inv) => {
      const id = nanoid(8);
      const w = makeNode(id, 'pile');
      inv.forEach((s, i) => { if (i < w.inv.length) w.inv[i] = s; });
      world.current.nodes[id] = w;
      set((s) => ({ nodes: [...s.nodes, { id, type: 'dep', position: { x: snapTo(x), y: snapTo(y) }, data: { def: 'pile' } }] }));
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
      set({ dirty: true });
      resettle();
    },
    setEdge: (id, patch) => {
      set((s) => ({ edges: s.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data!, ...patch } } : e)), dirty: true }));
    },
    serialize: () => {
      const { nodes, edges, bg } = get();
      return {
        v: 1,
        nodes: nodes.map((n) => ({
          id: n.id, def: n.data.def, x: Math.round(n.position.x), y: Math.round(n.position.y),
          ...(n.parentId ? { parent: n.parentId } : {}),
          ...(n.type === 'note' ? { note: n.data as NoteData, w: n.width ?? n.measured?.width, h: n.height ?? n.measured?.height } : {}),
        })),
        edges: edges.map((e) => ({ id: e.id, s: e.source, sh: e.sourceHandle!, t: e.target, th: e.targetHandle!, kind: e.data!.kind, color: e.data!.color, points: e.data!.points, style: e.data!.style })),
        world: snapshotWorld(world.current),
        bg,
      };
    },
    load: (doc, meta = {}, title) => {
      world.current = restoreWorld(doc.world ?? {});
      const nodes: DepNode[] = ordered(doc.nodes
        .filter((n) => DEF[n.def] || n.def.startsWith('note_'))
        .map((n) => {
          if (n.def.startsWith('note_')) {
            return { id: n.id, type: 'note', position: { x: n.x, y: n.y }, data: { ...(n.note ?? { kind: n.def === 'note_box' ? 'box' : 'text', text: '', color: '#ebe4d8' }), def: n.def }, ...(n.w ? { width: n.w, height: n.h } : {}), ...(n.def === 'note_box' ? { zIndex: -1 } : {}) } as DepNode;
          }
          if (!world.current.nodes[n.id]) world.current.nodes[n.id] = makeNode(n.id, n.def);
          return { id: n.id, type: nodeType(n.def), position: { x: n.x, y: n.y }, data: { def: n.def }, ...(n.parent ? { parentId: n.parent, draggable: false } : {}) };
        }));
      const ids = new Set(nodes.map((n) => n.id));
      const live = nodes.filter((n) => !n.parentId || ids.has(n.parentId));
      const edges: CableEdge[] = doc.edges
        .filter((e) => ids.has(e.s) && ids.has(e.t))
        .map((e) => ({ id: e.id, source: e.s, sourceHandle: e.sh, target: e.t, targetHandle: e.th, type: 'cable', data: { kind: e.kind, color: e.color, points: e.points ?? [], style: e.style } }));
      set((st) => ({ nodes: live, edges, meta, bg: doc.bg ?? null, past: [], future: [], dirty: false, fitReq: st.fitReq + 1, title: title ?? '' }));
      resettle();
    },
    newBuild: () => {
      world.current = newWorld();
      set({ nodes: [], edges: [], meta: {}, title: '', bg: null, past: [], future: [], dirty: false });
      history.replaceState(null, '', '/');
      resettle();
    },
    setRunning: (running) => set({ running }),
    setSpeed: (speed) => set({ speed }),
    setWireColor: (wireColor) => set({ wireColor }),
    setStraight: (straight) => { savePrefs({ straight }); set({ straight }); },
    setDrawMode: (drawMode) => set({ drawMode, pending: null }),
    setPending: (pending) => set({ pending }),
    setShowCost: (showCost) => { savePrefs({ showCost }); set({ showCost }); },
    setBg: (bg) => set({ bg, dirty: true }),
    setTitle: (title) => set({ title, dirty: true }),
    setMeta: (meta) => set({ meta }),
    markSaved: () => set({ dirty: false }),
  };
});

/** Re-render hook: components call this to update on sim ticks. */
export const useTick = () => useStore((s) => s.tick);
