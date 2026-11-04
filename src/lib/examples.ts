import type { SaveDoc } from '../store';
import { makeNode, newWorld, snapshotWorld, addItem, type World } from '../sim/world';
import type { PortKind } from '../sim/defs';

type N = { id: string; def: string; x: number; y: number; parent?: string; params?: Record<string, any>; st?: Record<string, any>; items?: [string, number, string?][] };
type E = [string, string, string, string, PortKind, string?];

function build(nodes: N[], edges: E[], tweak?: (w: World) => void): SaveDoc {
  const w = newWorld();
  for (const n of nodes) {
    const m = makeNode(n.id, n.def, n.params);
    Object.assign(m.st, n.st ?? {});
    if (n.parent) m.st.host = n.parent;
    for (const [s, q, g] of n.items ?? []) addItem(m.inv, s, q, g);
    w.nodes[n.id] = m;
  }
  tweak?.(w);
  return {
    v: 1,
    nodes: nodes.map((n) => ({ id: n.id, def: n.def, x: n.x, y: n.y, ...(n.parent ? { parent: n.parent } : {}) })),
    edges: edges.map(([s, sp, t, tp, kind, color], i) => ({ id: `e${i}`, s, sh: `o:${sp}`, t, th: `i:${tp}`, kind, color: color ?? 'default', points: [] })),
    world: snapshotWorld(w),
  };
}

export const EXAMPLES: { id: string; title: string; blurb: string; icons: string[]; doc: () => SaveDoc }[] = [
  {
    id: 'solar-night',
    title: 'Solar battery bank',
    blurb: 'Two solar panels charge a large battery through a root combiner. A switch feeds lights through a splitter overnight.',
    icons: ['electric.solarpanel.large', 'electric.battery.rechargable.large', 'ceilinglight'],
    doc: () => build(
      [
        { id: 'sp1', def: 'solar', x: 0, y: 0 },
        { id: 'sp2', def: 'solar', x: 0, y: 180 },
        { id: 'rc', def: 'rootcombiner', x: 300, y: 84 },
        { id: 'bat', def: 'battery_l', x: 600, y: 72, params: { charge: 6000 }, st: { charge: 6000 } },
        { id: 'sw', def: 'switch', x: 900, y: 72, params: { on: true } },
        { id: 'spl', def: 'splitter', x: 1200, y: 60 },
        { id: 'l1', def: 'ceilinglight', x: 1500, y: -60 },
        { id: 'l2', def: 'ceilinglight', x: 1500, y: 120 },
        { id: 'l3', def: 'siren', x: 1500, y: 300 },
      ],
      [
        ['sp1', 'out', 'rc', 'a', 'power', 'yellow'],
        ['sp2', 'out', 'rc', 'b', 'power', 'yellow'],
        ['rc', 'out', 'bat', 'in', 'power', 'yellow'],
        ['bat', 'out', 'sw', 'in', 'power', 'red'],
        ['sw', 'out', 'spl', 'in', 'power', 'red'],
        ['spl', 'o1', 'l1', 'in', 'power', 'white'],
        ['spl', 'o2', 'l2', 'in', 'power', 'white'],
        ['spl', 'o3', 'l3', 'in', 'power', 'blue'],
      ],
    ),
  },
  {
    id: 'turret-trap',
    title: 'HBHF + turret defense',
    blurb: 'A turret runs off a branch; an HBHF sensor and a laser trip an alarm and a smart alarm. Drag the hostile player around.',
    icons: ['autoturret', 'electric.hbhfsensor', 'electric.laserdetector'],
    doc: () => build(
      [
        { id: 'gen', def: 'testgen', x: 0, y: 120 },
        { id: 'br', def: 'branch', x: 300, y: 0, params: { amount: 11 } },
        { id: 'tur', def: 'turret', x: 600, y: -120, items: [['rifle.ak', 1], ['ammo.rifle', 128], ['ammo.rifle', 128], ['ammo.rifle', 128]] },
        { id: 'hb', def: 'hbhf', x: 600, y: 180, params: { others: true, authed: false } },
        { id: 'alarm', def: 'audioalarm', x: 900, y: 180 },
        { id: 'laser', def: 'laser', x: 300, y: 360, params: { angle: 0, length: 14 } },
        { id: 'sa', def: 'smartalarm', x: 900, y: 420, params: { msg: 'Someone crossed the laser!' } },
        { id: 'p1', def: 'player', x: 1180, y: -40, params: { name: 'Raider', authed: false } },
        { id: 'p2', def: 'player', x: -140, y: 0, params: { name: 'You', authed: true } },
      ],
      [
        ['gen', 'o1', 'br', 'in', 'power', 'red'],
        ['br', 'branch', 'tur', 'in', 'power', 'red'],
        ['br', 'out', 'hb', 'in', 'power', 'green'],
        ['hb', 'out', 'alarm', 'in', 'power', 'green'],
        ['gen', 'o2', 'laser', 'in', 'power', 'blue'],
        ['laser', 'out', 'sa', 'in', 'power', 'blue'],
      ],
    ),
  },
  {
    id: 'autocraft',
    title: 'Gunpowder auto-crafter',
    blurb: 'A God Box feeds sulfur and charcoal into an industrial crafter next to a level 1 workbench. Finished gunpowder goes into a large box.',
    icons: ['industrial.crafter', 'gunpowder', 'industrial.conveyor'],
    doc: () => build(
      [
        { id: 'gen', def: 'testgen', x: -320, y: 300 },
        { id: 'god', def: 'godbox', x: 0, y: 0, st: { entries: [{ s: 'sulfur', mode: 'infinite', n: 1000 }, { s: 'charcoal', mode: 'infinite', n: 1000 }] } },
        { id: 'cv1', def: 'conveyor', x: 300, y: 120 },
        { id: 'wb', def: 'wb1', x: 648, y: 24 },
        { id: 'cr', def: 'crafter', x: 240, y: 0, parent: 'wb', st: { templates: ['gunpowder', null, null, null, null, null] } },
        { id: 'cv2', def: 'conveyor', x: 1200, y: 120 },
        { id: 'box', def: 'box_l', x: 1488, y: 72 },
      ],
      [
        ['god', 'iout', 'cv1', 'iin', 'item', 'yellow'],
        ['cv1', 'iout', 'cr', 'iin', 'item', 'yellow'],
        ['cr', 'iout', 'cv2', 'iin', 'item', 'green'],
        ['cv2', 'iout', 'box', 'iin', 'item', 'green'],
        ['gen', 'o1', 'cv1', 'in', 'power'],
        ['cv1', 'out', 'cr', 'in', 'power'],
        ['cr', 'out', 'cv2', 'in', 'power'],
      ],
    ),
  },
  {
    id: 'farm',
    title: 'Sprinkler hemp farm',
    blurb: 'A powered pump and purifier fill a barrel that feeds sprinklers over two large planters. A ceiling light keeps them growing at night.',
    icons: ['planter.large', 'electric.sprinkler', 'waterpump'],
    doc: () => build(
      [
        { id: 'gen', def: 'testgen', x: -300, y: 0 },
        { id: 'pump', def: 'waterpump', x: 0, y: -60 },
        { id: 'pur', def: 'purifier', x: 300, y: -60 },
        { id: 'bar', def: 'waterbarrel', x: 600, y: -60, st: { water: 8000 } },
        { id: 'fs', def: 'fluidsplitter', x: 900, y: -72 },
        { id: 's1', def: 'sprinkler', x: 1236, y: -200 },
        { id: 's2', def: 'sprinkler', x: 1236, y: 140 },
        { id: 'pl1', def: 'planter_l', x: 1464, y: -280, st: { water: 600, plants: Array.from({ length: 9 }, (_, i) => ({ type: 'hemp', genes: i % 2 ? 'GGGYYH' : 'GYYYHX', age: 0, health: 1 })) } },
        { id: 'pl2', def: 'planter_l', x: 1464, y: 60, st: { water: 600, plants: Array.from({ length: 9 }, () => ({ type: 'corn', genes: 'GGYYHW', age: 0, health: 1 })) } },
        { id: 'light', def: 'ceilinglight', x: 1680, y: -60 },
      ],
      [
        ['gen', 'o1', 'pump', 'in', 'power', 'red'],
        ['gen', 'o2', 'pur', 'in', 'power', 'red'],
        ['gen', 'o3', 'light', 'in', 'power', 'yellow'],
        ['pump', 'wout', 'pur', 'win', 'fluid', 'lightblue'],
        ['pur', 'wout', 'bar', 'win', 'fluid', 'blue'],
        ['bar', 'wout', 'fs', 'win', 'fluid', 'blue'],
        ['fs', 'o1', 's1', 'win', 'fluid', 'green'],
        ['fs', 'o2', 's2', 'win', 'fluid', 'green'],
      ],
    ),
  },
  {
    id: 'smelter',
    title: 'Automated smelting',
    blurb: 'Ore and wood flow from a God Box into a large furnace. A second conveyor pulls only the finished metal and charcoal into a box.',
    icons: ['furnace.large', 'metal.ore', 'metal.fragments'],
    doc: () => build(
      [
        { id: 'gen', def: 'testgen', x: -300, y: 260 },
        { id: 'god', def: 'godbox', x: 0, y: 0, st: { entries: [{ s: 'metal.ore', mode: 'infinite', n: 1000 }, { s: 'wood', mode: 'infinite', n: 1000 }] } },
        { id: 'cv1', def: 'conveyor', x: 300, y: 100, st: { filters: [{ s: 'metal.ore', max: 3000 }, { s: 'wood', max: 1000 }] } },
        { id: 'fur', def: 'furnace_l', x: 650, y: 0, params: { on: true }, items: [['wood', 500], ['metal.ore', 1000]] },
        { id: 'cv2', def: 'conveyor', x: 1000, y: 100 },
        { id: 'box', def: 'box_l', x: 1300, y: 0 },
      ],
      [
        ['god', 'iout', 'cv1', 'iin', 'item', 'orange'],
        ['cv1', 'iout', 'fur', 'iin', 'item', 'orange'],
        ['fur', 'iout', 'cv2', 'iin', 'item', 'default'],
        ['cv2', 'iout', 'box', 'iin', 'item', 'default'],
        ['gen', 'o1', 'cv1', 'in', 'power'],
        ['cv1', 'out', 'cv2', 'in', 'power'],
      ],
    ),
  },
  {
    id: 'raid-alarm',
    title: 'Seismic raid alarm',
    blurb: 'A seismic sensor trips a siren, an audio alarm and a smart alarm when something explodes nearby. Light the C4 and watch it go.',
    icons: ['electric.seismicsensor', 'explosive.timed', 'electric.sirenlight'],
    doc: () => build(
      [
        { id: 'bat', def: 'battery_l', x: 0, y: 60, params: { charge: 24000 }, st: { charge: 24000 } },
        { id: 'seis', def: 'seismic', x: 312, y: 48, params: { range: 20 } },
        { id: 'spl', def: 'splitter', x: 600, y: 36 },
        { id: 'siren', def: 'siren', x: 900, y: -120 },
        { id: 'alarm', def: 'audioalarm', x: 900, y: 60 },
        { id: 'sa', def: 'smartalarm', x: 900, y: 220, params: { msg: 'Seismic sensor: you are being raided!' } },
        { id: 'box', def: 'box_l', x: 300, y: 252, items: [['sulfur', 5000], ['explosive.timed', 4], ['metal.refined', 400]] },
        { id: 'c4', def: 'explosive', x: 330, y: 420, params: { type: 'explosive.timed', destroy: true } },
        { id: 'raider', def: 'player', x: 620, y: 470, params: { name: 'Raider', authed: false } },
      ],
      [
        ['bat', 'out', 'seis', 'in', 'power', 'red'],
        ['seis', 'out', 'spl', 'in', 'power', 'red'],
        ['spl', 'o1', 'siren', 'in', 'power', 'yellow'],
        ['spl', 'o2', 'alarm', 'in', 'power', 'yellow'],
        ['spl', 'o3', 'sa', 'in', 'power', 'yellow'],
      ],
    ),
  },
  {
    id: 'logic',
    title: 'Memory cell door latch',
    blurb: 'Two buttons set and reset a memory cell that drives a door controller, with a counter tracking presses through a timer.',
    icons: ['electrical.memorycell', 'electric.button', 'electric.counter'],
    doc: () => build(
      [
        { id: 'bat', def: 'battery_m', x: 0, y: 120, params: { charge: 9000 }, st: { charge: 9000 } },
        { id: 'spl', def: 'splitter', x: 300, y: 100 },
        { id: 'b1', def: 'button', x: 600, y: -96, params: { duration: 1 } },
        { id: 'b2', def: 'button', x: 600, y: 140, params: { duration: 1 } },
        { id: 'mc', def: 'memorycell', x: 950, y: 0 },
        { id: 'dc', def: 'doorcontroller', x: 1300, y: -60 },
        { id: 'fl', def: 'flasher', x: 1300, y: 140 },
        { id: 'cnt', def: 'counter', x: 950, y: 320, params: { target: 3 } },
      ],
      [
        ['bat', 'out', 'spl', 'in', 'power', 'red'],
        ['spl', 'o1', 'b1', 'in', 'power', 'green'],
        ['spl', 'o2', 'b2', 'in', 'power', 'red'],
        ['spl', 'o3', 'mc', 'in', 'power', 'yellow'],
        ['b1', 'out', 'mc', 'set', 'power', 'green'],
        ['b2', 'out', 'mc', 'reset', 'power', 'red'],
        ['mc', 'out', 'dc', 'in', 'power', 'yellow'],
        ['mc', 'inv', 'fl', 'in', 'power', 'purple'],
        ['dc', 'out', 'cnt', 'in', 'power', 'yellow'],
      ],
    ),
  },
];

const turretGrid = () => {
  const nodes: N[] = [{ id: 'bat', def: 'battery_l', x: 0, y: 312, params: { charge: 24000 }, st: { charge: 24000 } }];
  const edges: E[] = [];
  let prev = 'bat', port = 'out';
  for (let i = 0; i < 9; i++) {
    const br = `br${i}`, t = `t${i}`;
    nodes.push({ id: br, def: 'branch', x: 264 + i * 264, y: 312, params: { amount: 11 } });
    nodes.push({ id: t, def: 'turret', x: 264 + i * 264, y: 0, items: [['rifle.ak', 1], ['ammo.rifle', 128], ['ammo.rifle', 128]] });
    edges.push([prev, port, br, 'in', 'power', 'red'], [br, 'branch', t, 'in', 'power', 'red']);
    prev = br; port = 'out';
  }
  return build(nodes, edges);
};

export const MODULES: { id: string; title: string; blurb: string; icons: string[]; doc: () => SaveDoc }[] = [
  { id: 'turrets9', title: '9 turret line', blurb: 'A large battery feeding nine AK turrets through branches set to 11 rW each.', icons: ['autoturret', 'electrical.branch', 'electric.battery.rechargable.large'], doc: turretGrid },
  {
    id: 'solar6', title: 'Solar bank (6 panels)', blurb: 'Six large solar panels joined by root combiners into one 120 rW line.', icons: ['electric.solarpanel.large', 'electrical.combiner'],
    doc: () => build(
      [0, 1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, def: 'solar', x: 0, y: i * 168 })).concat([
        { id: 'r1', def: 'rootcombiner', x: 288, y: 48 }, { id: 'r2', def: 'rootcombiner', x: 288, y: 384 }, { id: 'r3', def: 'rootcombiner', x: 288, y: 720 },
        { id: 'r4', def: 'rootcombiner', x: 576, y: 216 }, { id: 'r5', def: 'rootcombiner', x: 864, y: 456 },
      ] as N[]),
      [
        ['s0', 'out', 'r1', 'a', 'power', 'yellow'], ['s1', 'out', 'r1', 'b', 'power', 'yellow'], ['s2', 'out', 'r2', 'a', 'power', 'yellow'], ['s3', 'out', 'r2', 'b', 'power', 'yellow'],
        ['s4', 'out', 'r3', 'a', 'power', 'yellow'], ['s5', 'out', 'r3', 'b', 'power', 'yellow'], ['r1', 'out', 'r4', 'a', 'power', 'yellow'], ['r2', 'out', 'r4', 'b', 'power', 'yellow'],
        ['r4', 'out', 'r5', 'a', 'power', 'yellow'], ['r3', 'out', 'r5', 'b', 'power', 'yellow'],
      ],
    ),
  },
  {
    id: 'battery-switch', title: 'Battery with on/off switch', blurb: 'A medium battery behind a switch, so it charges and only discharges when you flip it.', icons: ['electric.battery.rechargable.medium', 'electric.switch'],
    doc: () => build([{ id: 'b', def: 'battery_m', x: 0, y: 0 }, { id: 'sw', def: 'switch', x: 288, y: 0 }], [['b', 'out', 'sw', 'in', 'power', 'red']]),
  },
  {
    id: 'hbhf-light', title: 'HBHF motion light', blurb: 'An HBHF sensor that turns on ceiling lights when someone walks in.', icons: ['electric.hbhfsensor', 'ceilinglight'],
    doc: () => build(
      [{ id: 'h', def: 'hbhf', x: 0, y: 0, params: { authed: true } }, { id: 'l1', def: 'ceilinglight', x: 288, y: -72 }, { id: 'l2', def: 'ceilinglight', x: 288, y: 120 }, { id: 'sp', def: 'splitter', x: 0, y: 216 }],
      [['h', 'out', 'sp', 'in', 'power', 'yellow'], ['sp', 'o1', 'l1', 'in', 'power', 'yellow'], ['sp', 'o2', 'l2', 'in', 'power', 'yellow']],
    ),
  },
  {
    id: 'sorter', title: 'Industrial sorter', blurb: 'A conveyor pulls from a box and a splitter spreads items over three boxes.', icons: ['industrial.conveyor', 'industrial.splitter', 'box.wooden.large'],
    doc: () => build(
      [
        { id: 'in', def: 'box_l', x: 0, y: 0 }, { id: 'cv', def: 'conveyor', x: 288, y: 0 }, { id: 'sp', def: 'isplitter', x: 576, y: 24 },
        { id: 'a', def: 'box_l', x: 864, y: -168 }, { id: 'b', def: 'box_l', x: 864, y: 24 }, { id: 'c', def: 'box_l', x: 864, y: 216 },
      ],
      [['in', 'iout', 'cv', 'iin', 'item'], ['cv', 'iout', 'sp', 'iin', 'item'], ['sp', 'o1', 'a', 'iin', 'item'], ['sp', 'o2', 'b', 'iin', 'item'], ['sp', 'o3', 'c', 'iin', 'item']],
    ),
  },
  {
    id: 'furnace-chain', title: 'Daisy-chained furnaces', blurb: 'One conveyor feeds three large furnaces chained through their storage adaptors; a second pulls the metal out the end.', icons: ['furnace.large', 'industrial.conveyor', 'metal.fragments'],
    doc: () => build(
      [
        { id: 'gen', def: 'testgen', x: -288, y: 288 },
        { id: 'god', def: 'godbox', x: 0, y: 0, st: { entries: [{ s: 'metal.ore', mode: 'infinite', n: 1000 }, { s: 'wood', mode: 'infinite', n: 1000 }] } },
        { id: 'cv1', def: 'conveyor', x: 288, y: 96, st: { filters: [{ s: 'metal.ore', max: 2000 }, { s: 'wood', max: 1000 }] } },
        { id: 'f1', def: 'furnace_l', x: 576, y: 0, params: { on: true }, items: [['wood', 200]] },
        { id: 'f2', def: 'furnace_l', x: 864, y: 0, params: { on: true }, items: [['wood', 200]] },
        { id: 'f3', def: 'furnace_l', x: 1152, y: 0, params: { on: true }, items: [['wood', 200]] },
        { id: 'cv2', def: 'conveyor', x: 1440, y: 96, st: { filters: [{ s: 'metal.fragments' }, { s: 'charcoal' }] } },
        { id: 'box', def: 'box_l', x: 1728, y: 0 },
      ],
      [
        ['god', 'iout', 'cv1', 'iin', 'item', 'orange'], ['cv1', 'iout', 'f1', 'iin', 'item', 'orange'],
        ['f1', 'iout', 'f2', 'iin', 'item', 'orange'], ['f2', 'iout', 'f3', 'iin', 'item', 'orange'],
        ['f3', 'iout', 'cv2', 'iin', 'item', 'default'], ['cv2', 'iout', 'box', 'iin', 'item', 'default'],
        ['gen', 'o1', 'cv1', 'in', 'power'], ['gen', 'o2', 'cv2', 'in', 'power'],
      ],
    ),
  },
  {
    id: 'workbench-crafters', title: 'Workbench 3 with two crafters', blurb: 'A level 3 workbench with both industrial crafter slots attached.', icons: ['workbench3', 'industrial.crafter'],
    doc: () => build([{ id: 'wb', def: 'wb3', x: 0, y: 0 }, { id: 'c1', def: 'crafter', x: 240, y: 0, parent: 'wb' }, { id: 'c2', def: 'crafter', x: -240, y: 0, parent: 'wb' }], []),
  },
];
