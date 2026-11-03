import { DEF, defaultParams, BATTERY } from './defs';
import { stackSize } from '../data/items';

export type Slot = { s: string; n: number; g?: string } | null;

export type Plant = {
  type: string; // hemp, corn, potato, pumpkin, red.berry ...
  genes: string; // 6 letters of G Y H W X
  age: number; // seconds
  health: number; // 0..1
  crossed?: boolean;
};

export interface WNode {
  id: string;
  def: string;
  params: Record<string, any>;
  inv: Slot[];
  st: Record<string, any>;
  pin: Record<string, number>;
  pout: Record<string, number>;
  on: boolean;
}

export type Notice = { id: number; text: string; kind: 'info' | 'alarm' | 'warn' };

export interface World {
  nodes: Record<string, WNode>;
  time: number; // sim seconds elapsed
  tod: number; // hour of day 0..24
  wind: number; // 0..1
  rain: boolean;
  lockTime: boolean;
  flow: Record<string, number>; // edge id → current flow (rW, mL/s or items moved recently)
  pipeItem: Record<string, string>; // edge id → last item moved
  pipeAt: Record<string, number>; // edge id → sim time of last move
  notices: Notice[];
  blasts: Blast[]; // recent explosions (for drawing)
  destroy: string[]; // node ids blown up, removed by the app
}

export type Blast = { id: number; x: number; y: number; r: number; at: number; kind: string; dud?: boolean };

export function newWorld(): World {
  return { nodes: {}, time: 0, tod: 9, wind: 0.5, rain: false, lockTime: false, flow: {}, pipeItem: {}, pipeAt: {}, notices: [], blasts: [], destroy: [] };
}

export const world: { current: World } = { current: newWorld() };

export function makeNode(id: string, defId: string, params?: Record<string, any>): WNode {
  const def = DEF[defId];
  if (!def) throw new Error(`Unknown deployable: ${defId}`);
  const p = { ...defaultParams(def), ...(params ?? {}) };
  const st: Record<string, any> = {};
  if (BATTERY[defId]) st.charge = Number(p.charge ?? 0);
  if (def.cat === 'farming' && defId.startsWith('planter')) {
    st.plants = Array(Number(p.plants)).fill(null);
    st.water = 0;
  }
  return { id, def: defId, params: p, inv: Array(def.slots ?? 0).fill(null), st, pin: {}, pout: {}, on: false };
}

// ───────── inventory helpers
export function countItem(inv: Slot[], s: string, from = 0, to = inv.length) {
  let c = 0;
  for (let i = from; i < to; i++) if (inv[i]?.s === s) c += inv[i]!.n;
  return c;
}
export function addItem(inv: Slot[], s: string, n: number, g?: string, from = 0, to = inv.length): number {
  const max = stackSize(s);
  let left = n;
  for (let i = from; i < to && left > 0; i++) {
    const sl = inv[i];
    if (sl && sl.s === s && sl.g === g && sl.n < max) {
      const k = Math.min(max - sl.n, left);
      sl.n += k;
      left -= k;
    }
  }
  for (let i = from; i < to && left > 0; i++) {
    if (!inv[i]) {
      const k = Math.min(max, left);
      inv[i] = { s, n: k, ...(g ? { g } : {}) };
      left -= k;
    }
  }
  return n - left;
}
export function spaceFor(inv: Slot[], s: string, g?: string, from = 0, to = inv.length) {
  const max = stackSize(s);
  let sp = 0;
  for (let i = from; i < to; i++) {
    const sl = inv[i];
    if (!sl) sp += max;
    else if (sl.s === s && sl.g === g) sp += max - sl.n;
  }
  return sp;
}
export function takeItem(inv: Slot[], s: string, n: number, from = 0, to = inv.length): number {
  let left = n;
  for (let i = to - 1; i >= from && left > 0; i--) {
    const sl = inv[i];
    if (sl && sl.s === s) {
      const k = Math.min(sl.n, left);
      sl.n -= k;
      left -= k;
      if (sl.n <= 0) inv[i] = null;
    }
  }
  return n - left;
}

export function snapshotWorld(w: World) {
  const nodes: Record<string, Pick<WNode, 'def' | 'params' | 'inv' | 'st'>> = {};
  for (const [id, n] of Object.entries(w.nodes)) nodes[id] = { def: n.def, params: n.params, inv: n.inv, st: n.st };
  return JSON.parse(JSON.stringify({ nodes, time: w.time, tod: w.tod, wind: w.wind, rain: w.rain, lockTime: w.lockTime }));
}
export function restoreWorld(snap: any): World {
  const w = newWorld();
  Object.assign(w, { time: snap.time ?? 0, tod: snap.tod ?? 9, wind: snap.wind ?? 0.5, rain: !!snap.rain, lockTime: !!snap.lockTime });
  for (const [id, n] of Object.entries<any>(snap.nodes ?? {})) {
    if (!DEF[n.def]) continue;
    const base = makeNode(id, n.def, n.params);
    base.inv = n.inv ?? base.inv;
    if (base.inv.length < (DEF[n.def].slots ?? 0)) base.inv = [...base.inv, ...Array((DEF[n.def].slots ?? 0) - base.inv.length).fill(null)];
    base.st = { ...base.st, ...(n.st ?? {}) };
    w.nodes[id] = base;
  }
  return w;
}

let noticeId = 1;
export function notify(w: World, text: string, kind: Notice['kind'] = 'info') {
  w.notices.push({ id: noticeId++, text, kind });
  if (w.notices.length > 6) w.notices.shift();
}
