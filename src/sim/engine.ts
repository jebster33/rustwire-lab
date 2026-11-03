import { DEF, BATTERY, WATER_CAP, WB_TIER } from './defs';
import { ITEMS, stackSize } from '../data/items';
import {
  type World, type WNode, type Slot, addItem, spaceFor, takeItem, countItem, notify,
} from './world';
import { STAGES, stageOf, stageStart, crossbreed, neighboursOf, geneCount, PLANT, harvestYield } from './plants';

export const PX_PER_M = 24;
export const STEP = 0.25; // sim seconds per tick

export type Rect = { x: number; y: number; w: number; h: number };
export type GraphEdge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string };
export type Graph = { rects: Record<string, Rect>; edges: GraphEdge[] };

type Link = { node: string; port: string; edge: string };
type Ctx = {
  w: World;
  ins: Map<string, Link>; // "node:port" (input) -> source
  outs: Map<string, Link>; // "node:port" (output) -> target
  rects: Record<string, Rect>;
  players: WNode[];
  rf: Set<number>;
};

const k = (n: string, p: string) => `${n}:${p}`;
const hk = (h: string) => h.slice(2); // strip "i:" / "o:"

export function buildCtx(w: World, g: Graph): Ctx {
  const ins = new Map<string, Link>();
  const outs = new Map<string, Link>();
  for (const e of g.edges) {
    if (!w.nodes[e.source] || !w.nodes[e.target]) continue;
    ins.set(k(e.target, hk(e.targetHandle)), { node: e.source, port: hk(e.sourceHandle), edge: e.id });
    outs.set(k(e.source, hk(e.sourceHandle)), { node: e.target, port: hk(e.targetHandle), edge: e.id });
  }
  const players = Object.values(w.nodes).filter((n) => n.def === 'player');
  return { w, ins, outs, rects: g.rects, players, rf: new Set() };
}

// ───────── geometry (metres)
export function rectDist(a?: Rect, b?: Rect) {
  if (!a || !b) return Infinity;
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy) / PX_PER_M;
}
const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
export function laserSegment(r: Rect, angleDeg: number, lengthM: number) {
  const c = center(r);
  const a = (angleDeg * Math.PI) / 180;
  const len = lengthM * PX_PER_M;
  return { a: c, b: { x: c.x + Math.cos(a) * len, y: c.y + Math.sin(a) * len } };
}

// ───────── environment
export function sunFactor(tod: number) {
  // Sunrise ~6:30, sunset ~19:30
  if (tod < 6.5 || tod > 19.5) return 0;
  return Math.sin(((tod - 6.5) / 13) * Math.PI);
}
const isDay = (w: World) => sunFactor(w.tod) > 0.15;

// ───────── power
const powerIn = (c: Ctx, n: WNode, port: string) => {
  const l = c.ins.get(k(n.id, port));
  return l ? c.w.nodes[l.node]?.pout[l.port] ?? 0 : 0;
};
const connectedOut = (c: Ctx, n: WNode, port: string) => c.outs.has(k(n.id, port));

const TRIGGERS = ['set', 'reset', 'toggle', 'on', 'off', 'trig', 'inc', 'dec', 'clear', 'start', 'stop', 'block', 'pump'];

function computePower(c: Ctx, n: WNode): Record<string, number> {
  const d = DEF[n.def];
  const P = n.params;
  const S = n.st;
  const i = (p: string) => n.pin[p] ?? 0;
  const pass = (draw = d.draw ?? 0) => Math.max(0, i('in') - draw);
  const o: Record<string, number> = {};
  n.on = false;
  switch (n.def) {
    case 'solar': {
      const v = P.sun ? Math.round(20 * sunFactor(c.w.tod)) : Number(P.amount);
      o.out = v; n.on = v > 0; break;
    }
    case 'wind': {
      const hf = Math.min(1, 0.3 + Number(P.height) * 0.1);
      const v = P.wind ? Math.round(150 * c.w.wind * hf) : Number(P.amount);
      o.out = v; n.on = v > 0; break;
    }
    case 'fuelgen': {
      const run = !!P.on && (countItem(n.inv, 'lowgradefuel') > 0 || (S.fuelAcc ?? 0) > 0);
      o.out = run ? 40 : 0; n.on = run; break;
    }
    case 'testgen': {
      for (const p of ['o1', 'o2', 'o3']) o[p] = Number(P.amount);
      n.on = true; break;
    }
    case 'battery_s': case 'battery_m': case 'battery_l': {
      const b = BATTERY[n.def];
      const can = (S.charge ?? 0) > 0 && (S.discharging || (S.charge ?? 0) >= (b.out * 5) / 60);
      o.out = can ? b.out : 0; n.on = can; break;
    }
    case 'rootcombiner': o.out = i('a') + i('b'); n.on = o.out > 0; break;
    case 'branch': {
      const avail = pass();
      o.branch = Math.min(Number(P.amount), avail);
      o.out = Math.max(0, avail - o.branch);
      n.on = i('in') > 0; break;
    }
    case 'splitter': {
      const ports = ['o1', 'o2', 'o3'].filter((p) => connectedOut(c, n, p));
      const each = ports.length ? Math.floor(pass() / ports.length) : 0;
      for (const p of ['o1', 'o2', 'o3']) o[p] = ports.includes(p) ? each : 0;
      n.on = i('in') > 0; break;
    }
    case 'blocker': o.out = i('block') > 0 ? 0 : pass(); n.on = o.out > 0; break;
    case 'memorycell': o.out = S.bit ? pass() : 0; o.inv = S.bit ? 0 : pass(); n.on = !!S.bit; break;
    case 'and': o.out = i('a') > 0 && i('b') > 0 ? Math.max(i('a'), i('b')) : 0; n.on = o.out > 0; break;
    case 'or': o.out = Math.max(0, Math.max(i('a'), i('b')) - 1); n.on = o.out > 0; break;
    case 'xor': {
      const a = i('a') > 0, b = i('b') > 0;
      o.out = a !== b ? Math.max(0, Math.max(i('a'), i('b')) - 1) : 0; n.on = o.out > 0; break;
    }
    case 'switch': case 'smartswitch': o.out = P.on ? pass() : 0; n.on = !!P.on; break;
    case 'button': o.out = (S.t ?? 0) > 0 ? (i('in') > 0 ? pass() : 2) : 0; n.on = (S.t ?? 0) > 0; break;
    case 'timer': o.out = (S.t ?? 0) > 0 ? pass() : 0; n.on = (S.t ?? 0) > 0; break;
    case 'rand': o.out = (S.bit ?? true) ? pass() : 0; n.on = !!(S.bit ?? true); break;
    case 'counter': {
      const cnt = S.count ?? 0;
      o.out = P.display ? pass() : cnt >= Number(P.target) ? pass() : 0;
      n.on = i('in') > 0; break;
    }
    case 'rfbroadcaster': n.on = i('in') >= 1; if (n.on) c.rf.add(Number(P.freq)); break;
    case 'rftransmitter': n.on = !!S.held; if (n.on) c.rf.add(Number(P.freq)); break;
    case 'rfreceiver': n.on = c.rf.has(Number(P.freq)) && i('in') > 0; o.out = n.on ? pass() : 0; break;
    case 'rfpager': n.on = c.rf.has(Number(P.freq)); break;
    case 'clock': o.out = (S.t ?? 0) > 0 ? pass() : 0; n.on = i('in') > 0; break;
    case 'hbhf': {
      const cnt = S.detected ?? 0;
      o.out = i('in') >= 2 ? Math.min(pass(), cnt) : 0; n.on = o.out > 0; break;
    }
    case 'laser': case 'pressurepad': {
      const hit = !!S.hit;
      if (n.def === 'pressurepad' && hit && i('in') === 0) { o.out = 1; n.on = true; break; }
      o.out = hit ? pass() : 0; n.on = hit && i('in') > 0; break;
    }
    case 'storagemonitor': o.out = i('in') >= 2 && (S.t ?? 0) > 0 ? 1 : 0; n.on = i('in') >= 1; break;
    case 'turret': case 'sam': {
      const need = d.draw ?? 0;
      const ammo = n.inv.reduce((a, s) => a + (s && s.s.startsWith('ammo.') ? s.n : 0), 0);
      n.on = i('in') >= need;
      const aux = i('in') >= need + 1;
      const target = n.on && !!S.target && ammo > 0;
      o.target = aux && target ? 1 : 0;
      o.low = aux && ammo > 0 && ammo < (n.def === 'sam' ? 6 : 40) ? 1 : 0;
      o.none = aux && ammo === 0 ? 1 : 0;
      o.out = Math.max(0, i('in') - need);
      S.ammo = ammo;
      break;
    }
    case 'fluidswitch': n.on = !!P.on; break;
    case 'efurnace': n.on = i('in') >= 3 && !!P.on; break;
    case 'conveyor': case 'crafter': n.on = i('in') >= 1 && !!P.on; o.out = pass(); break;
    case 'waterpump': case 'purifier': n.on = i('in') >= (d.draw ?? 0); break;
    default: {
      // plain consumers with optional passthrough
      if (d.draw != null && d.ports.some((p) => p.key === 'in')) {
        n.on = i('in') >= d.draw;
        if (d.ports.some((p) => p.dir === 'out' && p.kind === 'power')) o.out = pass();
      }
    }
  }
  return o;
}

function solvePower(c: Ctx) {
  const nodes = Object.values(c.w.nodes);
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    c.rf.clear();
    for (const n of nodes) {
      const d = DEF[n.def];
      for (const p of d.ports) if (p.dir === 'in' && p.kind === 'power') n.pin[p.key] = powerIn(c, n, p.key);
    }
    for (const n of nodes) {
      const o = computePower(c, n);
      for (const [key, v] of Object.entries(o)) {
        if (n.pout[key] !== v) { n.pout[key] = v; changed = true; }
      }
    }
    if (!changed && iter > 0) break;
  }
}

/** Rising-edge triggers. Returns true when state changed and power must be re-solved. */
function processTriggers(c: Ctx): boolean {
  let changed = false;
  for (const n of Object.values(c.w.nodes)) {
    const prev = (n.st.prev ??= {});
    for (const t of TRIGGERS) {
      if (!(t in n.pin)) continue;
      const now = (n.pin[t] ?? 0) > 0;
      const was = !!prev[t];
      prev[t] = now;
      if (!now || was) continue;
      const P = n.params, S = n.st;
      switch (n.def) {
        case 'memorycell':
          if (t === 'set') S.bit = true;
          else if (t === 'reset') S.bit = false;
          else if (t === 'toggle') S.bit = !S.bit;
          changed = true; break;
        case 'rand':
          if (t === 'set') S.bit = Math.random() < 0.5;
          if (t === 'reset') S.bit = false;
          changed = true; break;
        case 'switch': case 'smartswitch':
          if (t === 'on') P.on = true;
          if (t === 'off') P.on = false;
          changed = true; break;
        case 'timer': if (t === 'trig') { S.t = Number(P.duration); changed = true; } break;
        case 'counter':
          if (t === 'inc') S.count = Math.min(100, (S.count ?? 0) + 1);
          if (t === 'dec') S.count = Math.max(0, (S.count ?? 0) - 1);
          if (t === 'clear') S.count = 0;
          changed = true; break;
        case 'fuelgen':
          if (t === 'start') P.on = true;
          if (t === 'stop') P.on = false;
          changed = true; break;
        case 'fluidswitch': if (t === 'toggle') { P.on = !P.on; changed = true; } break;
        case 'efurnace': case 'conveyor': case 'crafter':
          if (t === 'on') P.on = true;
          if (t === 'off') P.on = false;
          if (t === 'toggle') P.on = !P.on;
          changed = true; break;
      }
    }
  }
  return changed;
}

/** How much power a node draws from the line feeding `port` (used for battery drain and load readouts). */
function demand(c: Ctx, nodeId: string, port: string, seen: Set<string>): number {
  const n = c.w.nodes[nodeId];
  if (!n || seen.has(nodeId) || TRIGGERS.includes(port)) return 0;
  seen.add(nodeId);
  const d = DEF[n.def];
  let sum = 0;
  if (BATTERY[n.def]) {
    const b = BATTERY[n.def];
    sum = (n.st.charge ?? 0) < b.cap ? Math.min(n.pin.in ?? 0, b.out * 4) : 0;
  } else if (n.def === 'rootcombiner') {
    sum = 0;
  } else {
    const active = (n.pin[port] ?? 0) > 0 && (n.on || (d.draw ?? 0) <= 1);
    if (active) sum += d.draw ?? 0;
    for (const p of d.ports) {
      if (p.dir !== 'out' || p.kind !== 'power' || !(n.pout[p.key] > 0)) continue;
      const l = c.outs.get(k(n.id, p.key));
      if (l) sum += Math.min(n.pout[p.key], demand(c, l.node, l.port, seen));
    }
  }
  seen.delete(nodeId);
  return sum;
}

// ───────── sensors, timers, batteries (time-based)
function updateTimed(c: Ctx, dt: number) {
  const w = c.w;
  for (const n of Object.values(w.nodes)) {
    const S = n.st, P = n.params;
    const r = c.rects[n.id];
    switch (n.def) {
      case 'button': case 'timer':
        if (S.t > 0) S.t = Math.max(0, S.t - dt);
        break;
      case 'clock': {
        if (S.t > 0) S.t = Math.max(0, S.t - dt);
        const a = Number(P.alarm);
        const prevTod = S.lastTod ?? w.tod;
        if ((prevTod < a && w.tod >= a) || (prevTod > w.tod && a < w.tod)) S.t = 5;
        S.lastTod = w.tod;
        break;
      }
      case 'hbhf': {
        let cnt = 0;
        for (const p of c.players) {
          const authed = !!p.params.authed;
          if (authed && !P.authed) continue;
          if (!authed && !P.others) continue;
          if (rectDist(r, c.rects[p.id]) <= Number(P.range)) cnt++;
        }
        S.detected = cnt;
        break;
      }
      case 'laser': {
        if (!r) break;
        const seg = laserSegment(r, Number(P.angle), Number(P.length));
        S.hit = c.players.some((p) => {
          const pr = c.rects[p.id];
          return pr && segDist(center(pr), seg.a, seg.b) <= Math.max(pr.w, pr.h) / 2 + 4;
        });
        break;
      }
      case 'pressurepad':
        S.hit = c.players.some((p) => rectDist(r, c.rects[p.id]) <= 0.15);
        break;
      case 'turret': {
        S.target = c.players.some((p) => !p.params.authed && rectDist(r, c.rects[p.id]) <= Number(P.range));
        if (S.target && n.on && (S.ammo ?? 0) > 0) {
          S.shot = (S.shot ?? 0) + dt * 2;
          while (S.shot >= 1) {
            S.shot -= 1;
            const slot = n.inv.find((s) => s && s.s.startsWith('ammo.'));
            if (slot) takeItem(n.inv, slot.s, 1);
          }
        }
        break;
      }
      case 'sam':
        S.target = !!P.aircraft;
        break;
      case 'storagemonitor': {
        if (S.t > 0) S.t = Math.max(0, S.t - dt);
        let best: WNode | undefined, bd = 3.01;
        for (const m of Object.values(w.nodes)) {
          if (m.id === n.id || !DEF[m.def].adaptor || m.def === 'player') continue;
          const dd = rectDist(r, c.rects[m.id]);
          if (dd < bd) { bd = dd; best = m; }
        }
        S.target = best?.id ?? null;
        const h = best ? JSON.stringify(best.inv) : '';
        if (S.hash !== undefined && h !== S.hash) S.t = 1;
        S.hash = h;
        break;
      }
      case 'smartalarm': {
        const on = n.on;
        if (on && !S.was) notify(w, `${P.msg || 'Smart alarm'}`, 'alarm');
        S.was = on;
        break;
      }
      case 'rfpager': {
        if (n.on && !S.was) notify(w, `RF Pager beeping on ${P.freq}`, 'info');
        S.was = n.on;
        break;
      }
      case 'fuelgen': {
        if (n.on) {
          S.fuelAcc = (S.fuelAcc ?? 0) - dt / 15;
          if (S.fuelAcc <= 0) {
            if (takeItem(n.inv, 'lowgradefuel', 1)) S.fuelAcc += 1;
            else S.fuelAcc = 0;
          }
        }
        break;
      }
      case 'battery_s': case 'battery_m': case 'battery_l': {
        const b = BATTERY[n.def];
        const charge = S.charge ?? 0;
        // charging
        const inP = Math.min(n.pin.in ?? 0, b.out * 4);
        let ch = charge + (inP * 0.8 * dt) / 60;
        // discharging by downstream demand
        let used = 0;
        if (n.pout.out > 0) {
          const l = c.outs.get(k(n.id, 'out'));
          used = l ? Math.min(b.out, demand(c, l.node, l.port, new Set([n.id]))) : 0;
          ch -= (used * dt) / 60;
          S.discharging = ch > 0;
        } else S.discharging = false;
        S.load = used;
        S.chargeRate = inP * 0.8;
        S.charge = Math.max(0, Math.min(b.cap, ch));
        break;
      }
    }
    // load readouts for generators
    if (['solar', 'wind', 'fuelgen', 'testgen', 'rootcombiner'].includes(n.def)) {
      let load = 0;
      for (const p of DEF[n.def].ports) {
        if (p.dir !== 'out') continue;
        const l = c.outs.get(k(n.id, p.key));
        if (l && n.pout[p.key] > 0) load += Math.min(n.pout[p.key], demand(c, l.node, l.port, new Set([n.id])));
      }
      S.load = load;
    }
  }
}

// ───────── water
const FLOW = 100; // mL/s per hose
const WATER_STORES = new Set(['waterbarrel', 'catcher_s', 'catcher_l', 'waterpump', 'purifier']);

function deliverWater(c: Ctx, nodeId: string, _port: string, amount: number, salt: boolean, dt: number, depth = 0): number {
  const n = c.w.nodes[nodeId];
  if (!n || amount <= 0 || depth > 24) return 0;
  const S = n.st;
  const fwd = (p: string, a: number) => {
    const l = c.outs.get(k(n.id, p));
    if (!l) return 0;
    const got = deliverWater(c, l.node, l.port, a, salt, dt, depth + 1);
    c.w.flow[l.edge] = (c.w.flow[l.edge] ?? 0) + got / dt;
    return got;
  };
  switch (n.def) {
    case 'waterbarrel': case 'catcher_s': case 'catcher_l': case 'waterpump': {
      const cap = WATER_CAP[n.def];
      const a = Math.min(amount, cap - (S.water ?? 0));
      if (a > 0) { S.water = (S.water ?? 0) + a; if (salt) S.salt = true; }
      return a;
    }
    case 'purifier': {
      const a = Math.min(amount, 5000 - (S.raw ?? 0));
      S.raw = (S.raw ?? 0) + a;
      S.rawSalt = salt || S.rawSalt;
      return a;
    }
    case 'fluidswitch': return n.params.on ? fwd('wout', amount) : 0;
    case 'fluidcombiner': return fwd('wout', amount);
    case 'fluidsplitter': {
      const ports = ['o1', 'o2', 'o3'].filter((p) => c.outs.has(k(n.id, p)));
      if (!ports.length) return 0;
      let got = 0;
      for (const p of ports) got += fwd(p, amount / ports.length);
      return got;
    }
    case 'sprinkler': {
      const passUsed = c.outs.has(k(n.id, 'wout'));
      const need = 3 * dt * (passUsed ? 2 : 1);
      const use = Math.min(amount, need);
      S.wet = (S.wet ?? 0) + use;
      const rest = passUsed ? fwd('wout', amount - use) : 0;
      return use + rest;
    }
    default:
      if (n.def.startsWith('planter')) {
        const a = Math.min(amount, 1000 - (S.water ?? 0));
        S.water = (S.water ?? 0) + a;
        if (salt && a > 0) S.saltHit = (S.saltHit ?? 0) + a;
        return a;
      }
  }
  return 0;
}

function updateWater(c: Ctx, dt: number) {
  const w = c.w;
  for (const n of Object.values(w.nodes)) {
    const S = n.st;
    if (n.def === 'waterpump' && n.on) {
      S.water = Math.min(WATER_CAP.waterpump, (S.water ?? 0) + 8.5 * dt);
      S.salt = !!n.params.salt;
    }
    if (n.def === 'catcher_s' || n.def === 'catcher_l') {
      const rate = (w.rain ? 6 : 0.4) * (n.def === 'catcher_l' ? 3 : 1);
      S.water = Math.min(WATER_CAP[n.def], (S.water ?? 0) + rate * dt);
    }
    if (n.def === 'purifier' && n.on && (S.raw ?? 0) > 0) {
      const conv = Math.min(S.raw, 20 * dt, WATER_CAP.purifier - (S.water ?? 0));
      S.raw -= conv;
      S.water = (S.water ?? 0) + conv;
      S.salt = false;
    }
    if (n.def === 'sprinkler') S.wet = 0;
  }
  // push from stores
  for (const n of Object.values(w.nodes)) {
    if (!WATER_STORES.has(n.def)) continue;
    const S = n.st;
    if (!(S.water > 0)) continue;
    const l = c.outs.get(k(n.id, 'wout'));
    if (!l) continue;
    const got = deliverWater(c, l.node, l.port, Math.min(S.water, FLOW * dt), !!S.salt, dt);
    S.water -= got;
    w.flow[l.edge] = (w.flow[l.edge] ?? 0) + got / dt;
  }
  // sprinklers water planters in range
  for (const n of Object.values(w.nodes)) {
    if (n.def !== 'sprinkler' || !(n.st.wet > 0)) continue;
    n.on = true;
    const targets = Object.values(w.nodes).filter((m) => m.def.startsWith('planter') && rectDist(c.rects[n.id], c.rects[m.id]) <= 3);
    for (const t of targets) t.st.water = Math.min(1000, (t.st.water ?? 0) + (n.st.wet / Math.max(1, targets.length)) * 4);
  }
}

// ───────── processing: furnaces, refinery, recycler, composter, god/void boxes
const SMELT: Record<string, { out: string; n: number; t: number }> = {
  'metal.ore': { out: 'metal.fragments', n: 1, t: 4 },
  'sulfur.ore': { out: 'sulfur', n: 1, t: 2 },
  'hq.metal.ore': { out: 'metal.refined', n: 1, t: 8 },
  'can.beans.empty': { out: 'metal.fragments', n: 15, t: 4 },
  'can.tuna.empty': { out: 'metal.fragments', n: 10, t: 4 },
  'crude.oil': { out: 'lowgradefuel', n: 3, t: 5 },
};
const SMELTABLE = new Set(['metal.ore', 'sulfur.ore', 'hq.metal.ore', 'can.beans.empty', 'can.tuna.empty']);

/** What a container will accept from a pipe/hand. */
export function accepts(n: WNode, s: string): boolean {
  switch (n.def) {
    case 'furnace': case 'furnace_l': return s === 'wood' || SMELTABLE.has(s);
    case 'efurnace': return SMELTABLE.has(s);
    case 'refinery': return s === 'wood' || s === 'crude.oil';
    case 'fuelgen': return s === 'lowgradefuel';
    case 'turret': return s.startsWith('ammo.') && !s.includes('rocket') && !s.includes('grenade');
    case 'sam': return s === 'ammo.rocket.sam';
    case 'godbox': return false;
    case 'crafter': {
      const t: (string | null)[] = n.st.templates ?? [];
      return t.some((x) => x && ITEMS[x]?.c?.i.some(([ing]) => ing === s));
    }
    case 'composter': return s === 'horsedung' || s === 'plantfiber' || ITEMS[s]?.g === 'food';
    default:
      if (n.def.startsWith('planter')) return s === 'fertilizer';
      return true;
  }
}
/** Slots a conveyor may pull from. */
export function pullable(n: WNode, s: string, idx: number): boolean {
  switch (n.def) {
    case 'furnace': case 'furnace_l': case 'efurnace': return s !== 'wood' && !SMELTABLE.has(s);
    case 'refinery': return s === 'lowgradefuel' || s === 'charcoal';
    case 'recycler': return idx >= 6;
    case 'crafter': return idx >= 12;
    case 'composter': return s === 'fertilizer';
    case 'voidbox': return false;
    default: return true;
  }
}
/** Insert range for pipe input. */
function insertRange(n: WNode): [number, number] {
  if (n.def === 'crafter') return [0, 12];
  if (n.def === 'recycler') return [0, 6];
  return [0, n.inv.length];
}
export function insertItem(n: WNode, s: string, qty: number, g?: string): number {
  if (!accepts(n, s)) return 0;
  if (n.def === 'voidbox') {
    const v = (n.st.voided ??= {});
    v[s] = (v[s] ?? 0) + qty;
    return qty;
  }
  const [a, b] = insertRange(n);
  if (n.def === 'crafter') {
    // keep room for every ingredient: at most two stacks of each
    qty = Math.min(qty, Math.max(0, stackSize(s) * 2 - countItem(n.inv, s, 0, 12)));
    if (qty <= 0) return 0;
  }
  return addItem(n.inv, s, qty, g, a, b);
}

function processors(c: Ctx, dt: number) {
  const w = c.w;
  for (const n of Object.values(w.nodes)) {
    const P = n.params, S = n.st;
    switch (n.def) {
      case 'furnace': case 'furnace_l': case 'refinery': case 'efurnace': {
        // igniters within 1.5 m light it up
        if (n.def !== 'efurnace' && !P.on) {
          const ig = Object.values(w.nodes).some((m) => m.def === 'igniter' && m.on && rectDist(c.rects[m.id], c.rects[n.id]) <= 1.5);
          if (ig && countItem(n.inv, 'wood') > 0) P.on = true;
        }
        const electric = n.def === 'efurnace';
        const lit = electric ? n.on : !!P.on;
        if (!lit) { S.burning = false; break; }
        const speed = n.def === 'furnace_l' ? 5 : 1;
        if (!electric) {
          S.fuel = (S.fuel ?? 0) - dt * speed / 2;
          if (S.fuel <= 0) {
            if (takeItem(n.inv, 'wood', 1)) {
              S.fuel += 1;
              S.char = (S.char ?? 0) + 0.75;
              if (S.char >= 1) { S.char -= 1; addItem(n.inv, 'charcoal', 1); }
            } else { P.on = false; S.fuel = 0; S.burning = false; break; }
          }
        }
        S.burning = true;
        // cook the first smeltable stack
        const slot = n.inv.find((s) => s && (n.def === 'refinery' ? s.s === 'crude.oil' : SMELTABLE.has(s.s)));
        if (!slot) { S.cook = 0; break; }
        const rec = SMELT[slot.s];
        S.cook = (S.cook ?? 0) + dt * speed;
        while (S.cook >= rec.t && countItem(n.inv, slot.s) > 0) {
          if (spaceFor(n.inv, rec.out) < rec.n) break;
          S.cook -= rec.t;
          takeItem(n.inv, slot.s, 1);
          addItem(n.inv, rec.out, rec.n);
        }
        break;
      }
      case 'recycler': {
        if (!P.on) break;
        const idx = n.inv.findIndex((s, i) => i < 6 && s && ITEMS[s.s]?.r);
        if (idx < 0) { P.on = false; S.t = 0; break; }
        S.t = (S.t ?? 0) + dt;
        if (S.t >= 5) {
          S.t -= 5;
          const it = n.inv[idx]!;
          const y = (P.rad ? ITEMS[it.s].rr : null) ?? ITEMS[it.s].r!;
          const acc = (S.acc ??= {});
          let fits = true;
          for (const [s, a] of y) if (spaceFor(n.inv, s, undefined, 6, 12) < Math.ceil(a)) fits = false;
          if (!fits) { P.on = false; notify(w, 'Recycler output is full', 'warn'); break; }
          takeItem(n.inv, it.s, 1, idx, idx + 1);
          for (const [s, a] of y) {
            acc[s] = (acc[s] ?? 0) + a;
            const whole = Math.floor(acc[s]);
            if (whole > 0) { acc[s] -= whole; addItem(n.inv, s, whole, undefined, 6, 12); }
          }
        }
        break;
      }
      case 'composter': {
        S.t = (S.t ?? 0) + dt;
        if (S.t >= 10) {
          S.t = 0;
          const slot = n.inv.find((s) => s && s.s !== 'fertilizer');
          if (slot && spaceFor(n.inv, 'fertilizer') > 0) {
            const gain = slot.s === 'horsedung' ? 2 : 1;
            takeItem(n.inv, slot.s, slot.s === 'plantfiber' ? Math.min(10, slot.n) : 1);
            addItem(n.inv, 'fertilizer', gain);
          }
        }
        break;
      }
      case 'godbox': {
        const entries: { s: string; mode: string; n: number }[] = S.entries ?? [];
        for (const e of entries) {
          if (e.mode === 'infinite') {
            const have = countItem(n.inv, e.s);
            const want = Math.max(1, Math.min(e.n || 1e9, 1e9));
            if (have < Math.min(want, 1000000)) addItem(n.inv, e.s, Math.min(want, 1e9) - have);
          } else if (e.mode === 'fill') {
            addItem(n.inv, e.s, 1e7);
          }
        }
        break;
      }
    }
  }
}

// ───────── industrial
type Found = { node: WNode; path: string[] };
function findSources(c: Ctx, nodeId: string, port: string, path: string[], out: Found[], depth = 0) {
  if (depth > 32 || out.length >= 32) return;
  const l = c.ins.get(k(nodeId, port));
  if (!l) return;
  const src = c.w.nodes[l.node];
  if (!src) return;
  const p2 = [...path, l.edge];
  if (src.def === 'icombiner' || src.def === 'isplitter') {
    for (const ip of src.def === 'icombiner' ? ['a', 'b', 'c'] : ['iin']) findSources(c, src.id, ip, p2, out, depth + 1);
  } else if (src.def === 'conveyor') {
    return; // conveyors don't store items
  } else if (src.inv.length) out.push({ node: src, path: p2 });
}
function findDests(c: Ctx, nodeId: string, port: string, path: string[], out: Found[], depth = 0) {
  if (depth > 32 || out.length >= 32) return;
  const l = c.outs.get(k(nodeId, port));
  if (!l) return;
  const dst = c.w.nodes[l.node];
  if (!dst) return;
  const p2 = [...path, l.edge];
  if (dst.def === 'isplitter') for (const op of ['o1', 'o2', 'o3']) findDests(c, dst.id, op, p2, out, depth + 1);
  else if (dst.def === 'icombiner') findDests(c, dst.id, 'iout', p2, out, depth + 1);
  else if (dst.def === 'conveyor') return;
  else if (dst.inv.length || dst.def === 'voidbox') out.push({ node: dst, path: p2 });
}

export type Filter = { s: string; min?: number; max?: number };

function industrial(c: Ctx, dt: number) {
  const w = c.w;
  for (const n of Object.values(w.nodes)) {
    if (n.def !== 'conveyor' || !n.on) continue;
    const S = n.st;
    S.t = (S.t ?? 0) + dt;
    if (S.t < 1) continue;
    S.t = 0;
    const srcs: Found[] = [];
    const dsts: Found[] = [];
    findSources(c, n.id, 'iin', [], srcs);
    findDests(c, n.id, 'iout', [], dsts);
    if (!srcs.length || !dsts.length) continue;
    const filters: Filter[] = S.filters ?? [];
    let budget = Number(n.params.rate) || 60;
    S.rr = (S.rr ?? 0) % dsts.length;
    let movedAny = false;
    outer: for (const src of srcs) {
      for (let si = 0; si < src.node.inv.length; si++) {
        const sl = src.node.inv[si];
        if (!sl || !pullable(src.node, sl.s, si)) continue;
        const f = filters.length ? filters.find((x) => x.s === sl.s) : undefined;
        if (filters.length && !f) continue;
        if (f?.min && countItem(src.node.inv, sl.s) <= f.min) continue;
        for (let tries = 0; tries < dsts.length && budget > 0; tries++) {
          const dst = dsts[(S.rr + tries) % dsts.length];
          if (dst.node.id === src.node.id) continue;
          let qty = Math.min(sl.n, budget);
          if (f?.min) qty = Math.min(qty, countItem(src.node.inv, sl.s) - f.min);
          if (f?.max) qty = Math.min(qty, f.max - countItem(dst.node.inv, sl.s));
          if (qty <= 0) continue;
          const moved = insertItem(dst.node, sl.s, qty, sl.g);
          if (moved > 0) {
            takeItem(src.node.inv, sl.s, moved, si, si + 1);
            budget -= moved;
            movedAny = true;
            for (const e of [...src.path, ...dst.path]) { w.pipeAt[e] = w.time; w.pipeItem[e] = sl.s; }
            S.rr = (S.rr + tries + 1) % dsts.length;
            break;
          }
        }
        if (budget <= 0) break outer;
      }
    }
    S.moved = movedAny;
  }
}

function crafter(c: Ctx, dt: number) {
  const w = c.w;
  for (const n of Object.values(w.nodes)) {
    if (n.def !== 'crafter') continue;
    const S = n.st;
    // tier from the nearest workbench within 3 m
    let tier = 0;
    for (const m of Object.values(w.nodes)) {
      const t = WB_TIER[m.def];
      if (t && rectDist(c.rects[n.id], c.rects[m.id]) <= 3) tier = Math.max(tier, t);
    }
    S.tier = tier;
    if (!n.on || !tier) continue;
    const templates: string[] = (S.templates ?? []).filter(Boolean);
    if (S.cur) {
      S.prog = (S.prog ?? 0) + dt;
      const rec = ITEMS[S.cur]?.c;
      if (!rec) { S.cur = null; continue; }
      if (S.prog >= Math.max(1, rec.t)) {
        if (spaceFor(n.inv, S.cur, undefined, 12, 18) >= rec.y) {
          addItem(n.inv, S.cur, rec.y, undefined, 12, 18);
          S.made = (S.made ?? 0) + rec.y;
          S.cur = null; S.prog = 0;
        }
      }
      continue;
    }
    for (let a = 0; a < templates.length; a++) {
      const idx = ((S.next ?? 0) + a) % templates.length;
      const it = templates[idx];
      const rec = ITEMS[it]?.c;
      if (!rec || rec.wb > tier) continue;
      if (!rec.i.every(([s, q]) => countItem(n.inv, s, 0, 12) >= q)) continue;
      if (spaceFor(n.inv, it, undefined, 12, 18) < rec.y) continue;
      for (const [s, q] of rec.i) takeItem(n.inv, s, q, 0, 12);
      S.cur = it; S.prog = 0; S.next = idx + 1;
      break;
    }
  }
}

// ───────── farming
function farming(c: Ctx, dt: number) {
  const w = c.w;
  for (const n of Object.values(w.nodes)) {
    if (!n.def.startsWith('planter')) continue;
    const S = n.st;
    const plants: (import('./world').Plant | null)[] = S.plants ?? [];
    const lit = isDay(w) || Object.values(w.nodes).some((m) => m.def === 'ceilinglight' && m.on && rectDist(c.rects[m.id], c.rects[n.id]) <= 3);
    S.light = lit;
    const fert = countItem(n.inv, 'fertilizer') > 0;
    let waterUse = 0;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      if (!p) continue;
      const st = stageOf(p.age);
      if (st.name === 'Dying') { p.health = Math.max(0, p.health - dt / 600); continue; }
      const hasWater = (S.water ?? 0) > 0;
      const hard = geneCount(p.genes, 'H');
      const water = hasWater ? 1 : 0.15 * hard;
      const light = lit ? 1 : 0.15 * hard;
      const rate = (1 + 0.25 * geneCount(p.genes, 'G')) * Math.min(water, light) * (fert ? 1.25 : 1);
      p.health = Math.max(0, Math.min(1, p.health + (rate > 0.5 ? dt / 300 : -dt / 900)));
      const before = st.i;
      p.age += dt * rate;
      waterUse += 0.02 * (1 + 0.5 * geneCount(p.genes, 'W')) * dt;
      // crossbreed when leaving the crossbreed stage
      if (before <= 3 && stageOf(p.age).i >= 4 && !p.crossed) {
        const nb = neighboursOf(i, plants.length).map((j) => plants[j]).filter((x): x is NonNullable<typeof x> => !!x && stageOf(x.age).i >= 3);
        const ng = crossbreed(p, nb);
        if (ng !== p.genes) S.crossed = [...(S.crossed ?? []), ng];
        p.genes = ng;
        p.crossed = true;
      }
      if (S.auto && stageOf(p.age).name === 'Ripe') {
        const qty = harvestYield(p);
        addItem(n.inv, PLANT[p.type].product, qty);
        if (p.type === 'hemp' || Math.random() < 0.5) addItem(n.inv, PLANT[p.type].seed, 1);
        p.age = stageStart(4); // regrow from mature
      }
    }
    if (S.crossed?.length) {
      notify(w, `${S.crossed.length} plant${S.crossed.length > 1 ? 's' : ''} crossbred in ${DEF[n.def].name}: ${[...new Set(S.crossed)].slice(0, 3).join(', ')}`);
      S.crossed = [];
    }
    if (fert && plants.some(Boolean)) {
      S.fertAcc = (S.fertAcc ?? 0) + dt / 600;
      if (S.fertAcc >= 1) { S.fertAcc = 0; takeItem(n.inv, 'fertilizer', 1); }
    }
    S.water = Math.max(0, (S.water ?? 0) - waterUse);
    void STAGES;
  }
}

// ───────── main step
export function step(w: World, g: Graph, dt = STEP, ctx?: Ctx) {
  const c = ctx ?? buildCtx(w, g);
  if (!w.lockTime) w.tod = (w.tod + dt / 150) % 24; // 60 min day/night cycle
  w.time += dt;
  w.flow = {};
  solvePower(c);
  for (let r = 0; r < 4 && processTriggers(c); r++) solvePower(c);
  updateTimed(c, dt);
  solvePower(c);
  for (let r = 0; r < 4 && processTriggers(c); r++) solvePower(c);
  // power flow on wires
  for (const [key, l] of c.ins) {
    const v = c.w.nodes[l.node]?.pout[l.port] ?? 0;
    const tgt = key.slice(0, key.lastIndexOf(':'));
    if (v > 0 && w.nodes[tgt] && !l.edge.startsWith('_')) w.flow[l.edge] = v;
  }
  updateWater(c, dt);
  processors(c, dt);
  industrial(c, dt);
  crafter(c, dt);
  farming(c, dt);
  playerCrafting(c, dt);
  return c;
}

function playerCrafting(c: Ctx, dt: number) {
  for (const p of c.players) {
    const q: { s: string; n: number; t: number; left: number; per: number }[] = p.st.queue ?? [];
    if (!q.length) continue;
    const job = q[0];
    job.left -= dt;
    while (job.left <= 0 && job.n > 0) {
      addItem(p.inv, job.s, job.per);
      job.n -= job.per;
      job.left += Math.max(0.5, job.t);
    }
    if (job.n <= 0) {
      q.shift();
      notify(c.w, `${p.params.name} crafted ${ITEMS[job.s]?.n ?? job.s}`);
    }
  }
}

/** Settle power without advancing time (used while paused so edits show immediately). */
export function settle(w: World, g: Graph) {
  const c = buildCtx(w, g);
  updateTimed(c, 0);
  solvePower(c);
  for (let r = 0; r < 4 && processTriggers(c); r++) solvePower(c);
  for (const [, l] of c.ins) {
    const v = c.w.nodes[l.node]?.pout[l.port] ?? 0;
    if (v > 0) w.flow[l.edge] = v;
    else if (DEF[w.nodes[l.node]?.def]?.ports.find((p) => p.key === l.port)?.kind === 'power') delete w.flow[l.edge];
  }
}

export type { Slot };
