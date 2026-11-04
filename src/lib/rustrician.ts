// Import from / export to rustrician.io's XML circuit format (mxGraphModel).
import { DEF, DEFS, portsOf, type PortDef, type Side } from '../sim/defs';
import { makeNode, newWorld, snapshotWorld, addItem, type WNode, type World } from '../sim/world';
import type { SaveDoc, NoteData } from '../store';

/** rustrician cmpid → our deployable id */
const CMP: Record<string, string> = {
  solarpanel_large: 'solar', generator_wind: 'wind', fuelgenerator_small: 'fuelgen', testgenerator_small: 'testgen',
  battery_large: 'battery_l', battery_medium: 'battery_m', battery_small: 'battery_s', combiner: 'rootcombiner',
  branch: 'branch', blocker: 'blocker', memorycell: 'memorycell', splitter: 'splitter', timer: 'timer',
  switch_rand: 'rand', switch: 'switch', switch_or: 'or', switch_and: 'and', switch_xor: 'xor', counter: 'counter',
  doorcontroller: 'doorcontroller', hbhfsensor: 'hbhf', laserdetector: 'laser', pressurepad: 'pressurepad',
  seismicsensor: 'seismic', rf_broadcaster: 'rfbroadcaster', rf_receiver: 'rfreceiver', rf_transmitter: 'rftransmitter',
  rf_pager: 'rfpager', audioalarm: 'audioalarm', flasherlight: 'flasher', sirenlight: 'siren', ceilinglight: 'ceilinglight',
  simplelight: 'simplelight', samsite: 'sam', autoturret: 'turret', teslacoil: 'tesla', xmas_lightstring: 'xmaslights',
  igniter: 'igniter', cctv_camera: 'cctv', ptz_cctv_camera: 'ptzcctv', electricheater: 'heater', button: 'button',
  smart_alarm: 'smartalarm', smart_switch: 'smartswitch', modularcarlift: 'carlift', searchlight: 'searchlight',
  reactivetarget: 'reactive', storage_monitor: 'storagemonitor', elevator: 'elevator', telephone: 'telephone',
  neonsign_small: 'neon_s', neonsign_medium: 'neon_m', neonsign_medium_animated: 'neon_ma', neonsign_large: 'neon_l',
  neonsign_large_animated: 'neon_la', industrial_wall_light: 'walllight', industrial_wall_light_green: 'walllight_g',
  industrial_wall_light_red: 'walllight_r', electric_furnace: 'efurnace', watercatcher_large: 'catcher_l',
  watercatcher_small: 'catcher_s', waterbarrel: 'waterbarrel', waterpump: 'waterpump', waterpurifier: 'purifier',
  fluid_switch: 'fluidswitch', fluid_combiner: 'fluidcombiner', fluid_splitter: 'fluidsplitter', sprinkler: 'sprinkler',
  industrial_combiner: 'icombiner', industrial_splitter: 'isplitter', industrial_conveyor: 'conveyor',
  industrial_crafter: 'crafter', digitalclock: 'clock', digital_clock: 'clock', hopper: 'hopper',
};
const REV: Record<string, string> = Object.fromEntries(Object.entries(CMP).map(([k, v]) => [v, k]));
REV.clock = 'digitalclock';

const PORT_TYPE: Record<string, string> = { 'in|power': 'in', 'out|power': 'out', 'in|fluid': 'fin', 'out|fluid': 'fout', 'in|item': 'iin', 'out|item': 'iout' };
const typeToPort = (t: string): { dir: 'in' | 'out'; kind: PortDef['kind'] } | null => {
  switch (t) {
    case 'in': return { dir: 'in', kind: 'power' };
    case 'out': return { dir: 'out', kind: 'power' };
    case 'fin': return { dir: 'in', kind: 'fluid' };
    case 'fout': return { dir: 'out', kind: 'fluid' };
    case 'iin': return { dir: 'in', kind: 'item' };
    case 'iout': return { dir: 'out', kind: 'item' };
    default: return null;
  }
};

// rustrician components are 64 px squares; our cards are much bigger, so spread the layout out
const SX = 3.6, SY = 3.0;
const snap = (v: number) => Math.round(v / 24) * 24;

/**
 * Map one axis of Rustrician's layout onto ours. Positions that line up there (within a few px)
 * become one column/row here; neighbouring columns sit one card apart, and bigger gaps between
 * groups are kept but shrunk.
 */
function axisMap(values: number[], pitch: number, near = 40) {
  const sorted = [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b);
  const centres: number[] = [];
  let group: number[] = [];
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > near) { centres.push(group.reduce((a, b) => a + b, 0) / group.length); group = []; }
    group.push(v);
  }
  if (group.length) centres.push(group.reduce((a, b) => a + b, 0) / group.length);
  const placed: number[] = [];
  let at = 0;
  centres.forEach((c, i) => {
    if (i) {
      const gap = c - centres[i - 1];
      // a normal neighbour spacing in Rustrician is ~70–130 px; wider gaps separate groups
      at += pitch + Math.min(pitch * 2, Math.max(0, gap - 160) * 0.6);
    }
    placed.push(at);
  });
  return (v: number) => {
    if (!centres.length) return 0;
    if (v <= centres[0]) return placed[0] - (centres[0] - v) * (pitch / 90);
    for (let i = 1; i < centres.length; i++) {
      if (v <= centres[i]) {
        const t = (v - centres[i - 1]) / (centres[i] - centres[i - 1]);
        // snap to the nearer column when it's clearly part of it
        if (t < 0.25) return placed[i - 1];
        if (t > 0.75) return placed[i];
        return placed[i - 1] + t * (placed[i] - placed[i - 1]);
      }
    }
    return placed[placed.length - 1] + (v - centres[centres.length - 1]) * (pitch / 90);
  };
}

export type ImportResult = { doc: SaveDoc; title: string; imported: number; skipped: Record<string, number>; wires: number; droppedWires: number };

export function importRustrician(xml: string): ImportResult {
  const dom = new DOMParser().parseFromString(xml, 'text/xml');
  if (dom.querySelector('parsererror') || !dom.querySelector('mxGraphModel')) throw new Error('That isn’t a Rustrician circuit. Paste the XML from Rustrician’s export.');
  const cells = [...dom.querySelectorAll('mxGraphModel > root > mxCell')];
  const byId = new Map(cells.map((c) => [c.getAttribute('id')!, c]));
  const rootCell = byId.get('1');
  const title = rootCell?.getAttribute('name') ?? '';

  const w: World = newWorld();
  const env = rootCell?.querySelector(':scope > Object[as="environment"]');
  if (env) {
    const wind = Number(env.getAttribute('wind'));
    if (isFinite(wind)) w.wind = Math.max(0, Math.min(1, wind / 100));
  }

  const geo = (c: Element) => {
    const g = c.querySelector(':scope > mxGeometry');
    return { x: Number(g?.getAttribute('x') ?? 0), y: Number(g?.getAttribute('y') ?? 0), w: Number(g?.getAttribute('width') ?? 64), h: Number(g?.getAttribute('height') ?? 64) };
  };
  const props = (c: Element) => {
    const out: Record<string, string> = {};
    for (const o of c.querySelectorAll(':scope > Array[as="props"] > Object')) out[(o.getAttribute('name') ?? '').toLowerCase()] = o.getAttribute('value') ?? '';
    return out;
  };

  const comps = cells.filter((c) => c.getAttribute('vertex') === '1' && c.getAttribute('parent') === '1' && (c.getAttribute('style') ?? '').startsWith('cmp_'));
  const texts = cells.filter((c) => c.getAttribute('vertex') === '1' && c.getAttribute('parent') === '1' && (c.getAttribute('style') ?? '').startsWith('text'));
  const compGeo = comps.map(geo);
  const mx = axisMap(compGeo.map((g) => g.x), 264);
  const my = axisMap(compGeo.map((g) => g.y), 240);
  const pos = (x: number, y: number) => ({ x: snap(mx(x)), y: snap(my(y)) });

  const nodes: SaveDoc['nodes'] = [];
  const taken = new Set<string>();
  const skipped: Record<string, number> = {};
  /** rustrician port cell id → our node id + handle */
  const portMap = new Map<string, { node: string; handle: string }>();

  for (const c of comps) {
    const attrs = c.querySelector(':scope > Object[as="attrs"]');
    const cmpid = attrs?.getAttribute('cmpid') ?? (c.getAttribute('style') ?? '').slice(4);
    const defId = CMP[cmpid];
    if (!defId || !DEF[defId]) { skipped[c.getAttribute('value') || cmpid] = (skipped[c.getAttribute('value') || cmpid] ?? 0) + 1; continue; }
    const id = `r${c.getAttribute('id')}`;
    const n: WNode = makeNode(id, defId);
    const pr = props(c);
    const num = (k: string) => (pr[k] !== undefined && pr[k] !== '' && isFinite(Number(pr[k])) ? Number(pr[k]) : undefined);
    const state = attrs?.getAttribute('state');
    switch (defId) {
      case 'branch': if (num('branch') !== undefined) n.params.amount = Math.max(1, num('branch')!); break;
      case 'timer': if (num('duration') !== undefined) n.params.duration = Math.max(0.25, num('duration')!); break;
      case 'button': if (num('duration') !== undefined) n.params.duration = Math.max(0.25, num('duration')!); break;
      case 'counter': { const t = num('target') ?? num('target value'); if (t !== undefined) n.params.target = t; n.st.count = Number(attrs?.getAttribute('value') ?? 0) || 0; break; }
      case 'rfbroadcaster': case 'rfreceiver': case 'rftransmitter': case 'rfpager': if (num('frequency') !== undefined) n.params.freq = num('frequency'); break;
      case 'testgen': if (num('amount') !== undefined) n.params.amount = num('amount'); break;
      case 'solar':
        if (pr['enable sun simulation'] === 'false') { n.params.sun = false; if (num('amount') !== undefined) n.params.amount = Math.min(20, num('amount')!); }
        break;
      case 'wind':
        if (pr['enable wind simulation'] === 'false') { n.params.wind = false; if (num('amount') !== undefined) n.params.amount = Math.min(150, num('amount')!); }
        break;
      case 'battery_s': case 'battery_m': case 'battery_l': {
        const cap = num('capacity');
        if (cap !== undefined) { n.st.charge = cap; n.params.charge = cap; }
        break;
      }
      case 'fuelgen': { const f = num('fuel amount'); if (f) addItem(n.inv, 'lowgradefuel', Math.round(f)); n.params.on = state !== '0'; break; }
      case 'switch': case 'smartswitch': n.params.on = state === '1'; break;
      case 'memorycell': n.st.bit = state === '1'; break;
      case 'rand': n.st.bit = state !== '0'; break;
      case 'turret':
        // Rustrician turrets are always armed; give ours a gun so they behave the same
        addItem(n.inv, 'rifle.ak', 1); addItem(n.inv, 'ammo.rifle', 128); addItem(n.inv, 'ammo.rifle', 128);
        break;
    }
    const label = c.getAttribute('value');
    if (label && label !== DEF[defId].name) n.params._label = label;
    w.nodes[id] = n;
    const g = geo(c);
    // never stack two cards on the same spot
    const at = pos(g.x, g.y);
    while (taken.has(`${at.x},${at.y}`)) at.x += 264;
    taken.add(`${at.x},${at.y}`);
    nodes.push({ id, def: defId, ...at });

    // map this component's port cells onto our ports: by label first, then by direction and kind
    const ours = portsOf(DEF[defId], n.params);
    const used = new Set<string>();
    const ports = cells.filter((p) => p.getAttribute('parent') === c.getAttribute('id') && p.getAttribute('vertex') === '1');
    const pending: Element[] = [];
    for (const p of ports) {
      const t = typeToPort(p.getAttribute('type') ?? '');
      if (!t) continue;
      const lbl = (p.getAttribute('value') ?? '').toLowerCase();
      const m = ours.find((o) => !used.has(o.key) && o.dir === t.dir && o.kind === t.kind && o.label.toLowerCase() === lbl);
      if (m) { used.add(m.key); portMap.set(p.getAttribute('id')!, { node: id, handle: `${m.dir === 'in' ? 'i' : 'o'}:${m.key}` }); }
      else pending.push(p);
    }
    for (const p of pending) {
      const t = typeToPort(p.getAttribute('type') ?? '')!;
      const cands = ours.filter((o) => !used.has(o.key) && o.dir === t.dir && o.kind === t.kind);
      if (cands.length === 1) { used.add(cands[0].key); portMap.set(p.getAttribute('id')!, { node: id, handle: `${t.dir === 'in' ? 'i' : 'o'}:${cands[0].key}` }); }
    }
  }

  for (const c of texts) {
    const g = geo(c);
    const style = c.getAttribute('style') ?? '';
    const text = (c.getAttribute('value') ?? '').trim();
    if (!text) continue;
    const size = style.includes('large') ? 40 : style.includes('medium') ? 28 : 20;
    const note: NoteData = { def: 'note_text', kind: 'text', text: text.split('\n')[0].slice(0, 200), color: '#ebe4d8', size };
    nodes.push({ id: `t${c.getAttribute('id')}`, def: 'note_text', ...pos(g.x, g.y), note });
  }

  const edges: SaveDoc['edges'] = [];
  let dropped = 0;
  const plugged = new Set<string>();
  for (const c of cells.filter((x) => x.getAttribute('edge') === '1')) {
    const s = portMap.get(c.getAttribute('source') ?? ''), t = portMap.get(c.getAttribute('target') ?? '');
    if (!s || !t) { dropped++; continue; }
    // rustrician sometimes stores a wire input→output; flip it so it runs output→input
    const [src, dst] = s.handle.startsWith('o:') ? [s, t] : [t, s];
    if (!src.handle.startsWith('o:') || !dst.handle.startsWith('i:')) { dropped++; continue; }
    const k1 = `${src.node}|${src.handle}`, k2 = `${dst.node}|${dst.handle}`;
    if (plugged.has(k1) || plugged.has(k2)) { dropped++; continue; }
    plugged.add(k1); plugged.add(k2);
    const kind = DEF[w.nodes[src.node].def].ports.find((p) => p.key === src.handle.slice(2))!.kind;
    edges.push({ id: `w${c.getAttribute('id')}`, s: src.node, sh: src.handle, t: dst.node, th: dst.handle, kind, color: kind === 'power' ? 'default' : kind === 'fluid' ? 'lightblue' : 'default', points: [], style: 'straight' });
  }

  return {
    doc: { v: 1, nodes, edges, world: snapshotWorld(w) },
    title, imported: Object.keys(w.nodes).length, skipped, wires: edges.length, droppedWires: dropped,
  };
}

// ───────── export
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '&#xa;');

/** Relative port positions on a rustrician 64×64 square, matching which side the port is on. */
function portGeometry(ports: PortDef[]) {
  const bySide: Record<Side, PortDef[]> = { left: [], right: [], top: [], bottom: [] };
  for (const p of ports) bySide[p.side ?? (p.dir === 'in' ? 'left' : 'right')].push(p);
  const pos = new Map<string, { x: number; y: number }>();
  const spread = (n: number, i: number) => (n === 1 ? 0.4 : 0.1 + (0.7 * i) / (n - 1));
  bySide.left.forEach((p, i, a) => pos.set(p.key, { x: -0.15, y: spread(a.length, i) }));
  bySide.right.forEach((p, i, a) => pos.set(p.key, { x: 1, y: spread(a.length, i) }));
  bySide.top.forEach((p, i, a) => pos.set(p.key, { x: spread(a.length, i), y: -0.2 }));
  bySide.bottom.forEach((p, i, a) => pos.set(p.key, { x: spread(a.length, i), y: 1.05 }));
  return pos;
}

export type ExportResult = { xml: string; exported: number; skipped: Record<string, number> };

export function exportRustrician(doc: SaveDoc, world: World, title: string): ExportResult {
  let next = 2;
  const out: string[] = [];
  const skipped: Record<string, number> = {};
  const portIds = new Map<string, string>(); // "node|handle" → cell id
  const parents = new Map(doc.nodes.map((n) => [n.id, n]));
  const absPos = (n: SaveDoc['nodes'][number]) => {
    const p = n.parent ? parents.get(n.parent) : undefined;
    return { x: n.x + (p?.x ?? 0), y: n.y + (p?.y ?? 0) };
  };
  const toR = (x: number, y: number) => ({ x: Math.round(4000 + x / SX), y: Math.round(3000 + y / SY) });

  for (const n of doc.nodes) {
    if (n.def === 'note_text' || n.def === 'note_box') {
      const text = n.note?.text?.trim();
      if (!text) continue;
      const p = toR(absPos(n).x, absPos(n).y);
      out.push(`    <mxCell id="${next++}" value="${esc(text)}" style="text-large" vertex="1" connectable="0" parent="1">\n      <mxGeometry x="${p.x}" y="${p.y}" width="${Math.max(128, text.length * 12)}" height="64" as="geometry"/>\n    </mxCell>`);
      continue;
    }
    const wn = world.nodes[n.id];
    const cmpid = REV[n.def];
    if (!wn || !cmpid) { const name = DEF[n.def]?.name ?? n.def; skipped[name] = (skipped[name] ?? 0) + 1; continue; }
    const def = DEF[n.def];
    const id = next++;
    const p = toR(absPos(n).x, absPos(n).y);
    const P = wn.params, S = wn.st;
    const attrs: Record<string, string | number> = { cmpid };
    const pr: [string, string, string | number][] = [];
    switch (n.def) {
      case 'branch': pr.push(['Branch', 'int', P.amount]); attrs.display = P.amount; break;
      case 'timer': pr.push(['Duration', 'int', P.duration]); break;
      case 'counter': pr.push(['Target', 'int', P.target]); attrs.value = S.count ?? 0; break;
      case 'rfbroadcaster': case 'rfreceiver': case 'rftransmitter': case 'rfpager': pr.push(['Frequency', 'int', P.freq]); break;
      case 'testgen': pr.push(['Amount', 'int', P.amount]); break;
      case 'solar': pr.push(['Amount', 'int', P.amount ?? 20], ['Enable Sun Simulation', 'bool', String(!!P.sun)]); break;
      case 'wind': pr.push(['Amount', 'int', P.amount ?? 150], ['Enable Wind Simulation', 'bool', String(!!P.wind)]); break;
      case 'battery_s': case 'battery_m': case 'battery_l': pr.push(['Capacity', 'float', Math.round((S.charge ?? 0) * 100) / 100]); break;
      case 'fuelgen': attrs.state = P.on ? 1 : 0; break;
      case 'switch': case 'smartswitch': attrs.state = P.on ? 1 : 0; break;
      case 'memorycell': case 'rand': attrs.state = S.bit ? 1 : 0; break;
    }
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${esc(String(v))}"`).join(' ');
    const propsStr = pr.length
      ? `      <Array as="props">\n${pr.map(([nm, t, v]) => `        <Object name="${esc(nm)}" type="${t}" value="${esc(String(v))}"/>`).join('\n')}\n      </Array>`
      : '      <Array as="props"/>';
    out.push(`    <mxCell id="${id}" value="${esc(String(P._label || def.name))}" style="cmp_${cmpid}" vertex="1" connectable="0" parent="1">\n      <mxGeometry x="${p.x}" y="${p.y}" width="64" height="64" as="geometry"/>\n      <Object ${attrStr} as="attrs"/>\n${propsStr}\n    </mxCell>`);
    const ports = portsOf(def, P);
    const geoms = portGeometry(ports);
    for (const port of ports) {
      const pid = next++;
      const g = geoms.get(port.key)!;
      portIds.set(`${n.id}|${port.dir === 'in' ? 'i' : 'o'}:${port.key}`, String(pid));
      out.push(`    <mxCell id="${pid}" value="${esc(port.label)}" style="portv" vertex="1" type="${PORT_TYPE[`${port.dir}|${port.kind}`]}" consumable="1" reconsumable="0" delayed="0" direct="0" warning="0" parent="${id}">\n      <mxGeometry x="${g.x}" y="${g.y}" width="10" height="10" relative="1" as="geometry"/>\n    </mxCell>`);
    }
  }
  for (const e of doc.edges) {
    const s = portIds.get(`${e.s}|${e.sh}`), t = portIds.get(`${e.t}|${e.th}`);
    if (!s || !t) continue;
    const v = world.nodes[e.s]?.pout[e.sh.slice(2)] ?? 0;
    const pts = (e.points ?? []).map((q) => { const r = toR(q.x, q.y); return `          <mxPoint x="${r.x}" y="${r.y}"/>`; });
    const geom = pts.length
      ? `      <mxGeometry relative="1" as="geometry">\n        <Array as="points">\n${pts.join('\n')}\n        </Array>\n      </mxGeometry>`
      : '      <mxGeometry relative="1" as="geometry"/>';
    out.push(`    <mxCell id="${next++}" value="${v}" edge="1" disabled="0" hovered="0" parent="1" source="${s}" target="${t}">\n${geom}\n    </mxCell>`);
  }
  const env = `<Object sun="100" wind="${Math.round(world.wind * 100)}" water="50" speed="10" as="environment"/>`;
  const xml = `<!-- rustrician.io circuit :: exported from Rustwire Lab ${new Date().toString()} -->
<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0" version="1337.370" tags="" name="${esc(title || 'Rustwire Lab export')}">
      <Object wire="#CCCCFF" hose="#d3d3d3" pipe="#d3d3d3" as="colors"/>
      ${env}
    </mxCell>
${out.join('\n')}
  </root>
</mxGraphModel>
`;
  return { xml, exported: doc.nodes.filter((n) => REV[n.def]).length, skipped };
}

export const RUSTRICIAN_SUPPORTED = DEFS.filter((d) => REV[d.id]).length;
