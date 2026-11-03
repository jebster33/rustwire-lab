import type { SaveDoc } from '../store';
import { makeNode, newWorld, snapshotWorld, addItem, type World } from '../sim/world';
import type { PortKind } from '../sim/defs';

type N = { id: string; def: string; x: number; y: number; params?: Record<string, any>; st?: Record<string, any>; items?: [string, number, string?][] };
type E = [string, string, string, string, PortKind, string?];

function build(nodes: N[], edges: E[], tweak?: (w: World) => void): SaveDoc {
  const w = newWorld();
  for (const n of nodes) {
    const m = makeNode(n.id, n.def, n.params);
    Object.assign(m.st, n.st ?? {});
    for (const [s, q, g] of n.items ?? []) addItem(m.inv, s, q, g);
    w.nodes[n.id] = m;
  }
  tweak?.(w);
  return {
    v: 1,
    nodes: nodes.map((n) => ({ id: n.id, def: n.def, x: n.x, y: n.y })),
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
        { id: 'tur', def: 'turret', x: 600, y: -120, items: [['ammo.rifle', 128], ['ammo.rifle', 128], ['ammo.rifle', 128]] },
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
        { id: 'wb', def: 'wb1', x: 650, y: -12 },
        { id: 'cr', def: 'crafter', x: 650, y: 72, st: { templates: ['gunpowder', null, null, null, null, null] } },
        { id: 'cv2', def: 'conveyor', x: 1000, y: 120 },
        { id: 'box', def: 'box_l', x: 1300, y: 60 },
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
        { id: 'seis', def: 'seismic', x: 300, y: 48, params: { range: 20, hold: 5 } },
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
        { id: 'b1', def: 'button', x: 600, y: -100, params: { duration: 1 } },
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
