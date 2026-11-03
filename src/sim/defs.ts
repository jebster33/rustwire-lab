export type PortKind = 'power' | 'fluid' | 'item';
export type PortDef = { key: string; label: string; kind: PortKind; dir: 'in' | 'out'; when?: string };
export type ParamDef = {
  key: string;
  label: string;
  type: 'int' | 'float' | 'bool' | 'select' | 'text';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string | number; label: string }[];
  hint?: string;
  simOnly?: boolean;
};
export type Category =
  | 'power' | 'logic' | 'sensors' | 'devices' | 'defense' | 'water' | 'farming'
  | 'industrial' | 'storage' | 'crafting' | 'sim';

export interface Def {
  id: string;
  name: string;
  icon: string;
  cat: Category;
  info: string;
  ports: PortDef[];
  params?: ParamDef[];
  /** power subtracted from passthrough / needed to run */
  draw?: number;
  /** inventory slot count */
  slots?: number;
  /** container that can take a storage adaptor */
  adaptor?: boolean;
  /** shows an interactive button on the node */
  press?: 'toggle' | 'press' | 'hold';
  /** spatial radius in metres, drawn on the board when selected */
  radius?: (p: Record<string, unknown>) => number;
  tips?: string[];
}

const pin = (key: string, label: string): PortDef => ({ key, label, kind: 'power', dir: 'in' });
const pout = (key: string, label: string): PortDef => ({ key, label, kind: 'power', dir: 'out' });
const fin = (key: string, label: string): PortDef => ({ key, label, kind: 'fluid', dir: 'in' });
const fout = (key: string, label: string): PortDef => ({ key, label, kind: 'fluid', dir: 'out' });
const iin = (key: string, label: string, when?: string): PortDef => ({ key, label, kind: 'item', dir: 'in', when });
const iout = (key: string, label: string, when?: string): PortDef => ({ key, label, kind: 'item', dir: 'out', when });

const PIN = pin('in', 'Power In');
const POUT = pout('out', 'Power Out');
const PASS = pout('out', 'Passthrough');
const ADAPTOR: PortDef[] = [iin('iin', 'Industrial In', 'adaptor'), iout('iout', 'Industrial Out', 'adaptor')];
const ADAPTOR_PARAM: ParamDef = { key: 'adaptor', label: 'Storage adaptor attached', type: 'bool', default: true };

const consumer = (
  id: string, name: string, icon: string, draw: number, info: string, pass = true, cat: Category = 'devices',
): Def => ({ id, name, icon, cat, draw, info, ports: pass ? [PIN, PASS] : [PIN] });

const battery = (id: string, name: string, icon: string, out: number, cap: number): Def => ({
  id, name, icon, cat: 'power', info: `Stores ${cap.toLocaleString()} rWm and outputs up to ${out} rW. Charges at 80% efficiency, max input ${out * 4} rW. Needs 5 seconds of charge before it discharges.`,
  ports: [PIN, POUT],
  params: [{ key: 'charge', label: 'Starting charge (rWm)', type: 'float', default: 0, min: 0, max: cap, simOnly: true }],
  tips: ['Can be wired in series', 'Block discharge with a Blocker, Switch or RF Receiver on the output'],
});

const container = (id: string, name: string, icon: string, slots: number, info: string, cat: Category = 'storage'): Def => ({
  id, name, icon, cat, slots, adaptor: true, info, ports: [...ADAPTOR], params: [ADAPTOR_PARAM],
});

const planter = (id: string, name: string, icon: string, slots: number): Def => ({
  id, name, icon, cat: 'farming', slots: 12, adaptor: true,
  info: `Holds ${slots} plants. Needs water (hose or sprinkler) and light (sun or a ceiling light within 3 m).`,
  ports: [fin('win', 'Water In'), ...ADAPTOR],
  params: [ADAPTOR_PARAM, { key: 'plants', label: 'Plant slots', type: 'int', default: slots, min: slots, max: slots }],
});

export const DEFS: Def[] = [
  // ───────────── Power
  {
    id: 'solar', name: 'Large Solar Panel', icon: 'electric.solarpanel.large', cat: 'power',
    info: 'Outputs 0–20 rW depending on the sun. Follows the time of day on the sim bar.',
    ports: [POUT],
    params: [
      { key: 'sun', label: 'Follow sun simulation', type: 'bool', default: true },
      { key: 'amount', label: 'Fixed output', type: 'int', default: 20, min: 0, max: 20, simOnly: true },
    ],
  },
  {
    id: 'wind', name: 'Wind Turbine', icon: 'generator.wind.scrap', cat: 'power',
    info: 'Outputs 0–150 rW depending on wind and altitude.',
    ports: [POUT],
    params: [
      { key: 'wind', label: 'Follow wind simulation', type: 'bool', default: true },
      { key: 'height', label: 'Height (floors above ground)', type: 'int', default: 4, min: 0, max: 12 },
      { key: 'amount', label: 'Fixed output', type: 'int', default: 150, min: 0, max: 150, simOnly: true },
    ],
  },
  {
    id: 'fuelgen', name: 'Small Generator', icon: 'electric.fuelgenerator.small', cat: 'power', slots: 1,
    info: 'Burns Low Grade Fuel (4 per minute) and outputs 40 rW. Force Start / Force Stop control it remotely.',
    ports: [pin('start', 'Force Start'), pin('stop', 'Force Stop'), POUT],
    params: [{ key: 'on', label: 'Turned on', type: 'bool', default: true }],
    press: 'toggle',
  },
  {
    id: 'testgen', name: 'Test Generator', icon: 'electric.generator.small', cat: 'power',
    info: 'Admin-spawned generator. Each of its 3 outputs gives the set amount.',
    ports: [pout('o1', 'Power Output 1'), pout('o2', 'Power Output 2'), pout('o3', 'Power Output 3')],
    params: [{ key: 'amount', label: 'Output per port', type: 'int', default: 100, min: 0, max: 1000 }],
  },
  battery('battery_s', 'Small Rechargeable Battery', 'electric.battery.rechargable.small', 15, 400),
  battery('battery_m', 'Medium Rechargeable Battery', 'electric.battery.rechargable.medium', 50, 9000),
  battery('battery_l', 'Large Rechargeable Battery', 'electric.battery.rechargable.large', 100, 24000),
  {
    id: 'rootcombiner', name: 'Root Combiner', icon: 'electrical.combiner', cat: 'power',
    info: 'Adds two root power sources (generators, panels, batteries) into one output. Only accepts root power.',
    ports: [pin('a', 'Power In 1'), pin('b', 'Power In 2'), POUT],
  },

  // ───────────── Logic
  {
    id: 'branch', name: 'Electrical Branch', icon: 'electrical.branch', cat: 'logic', draw: 1,
    info: 'Sends a set amount out of Branch Out and the rest out of Power Out. Uses 1 rW.',
    ports: [PIN, pout('branch', 'Branch Out'), POUT],
    params: [{ key: 'amount', label: 'Branch amount', type: 'int', default: 2, min: 2, max: 10000 }],
  },
  {
    id: 'splitter', name: 'Splitter', icon: 'electric.splitter', cat: 'logic', draw: 1,
    info: 'Splits power evenly between the outputs that are connected. Uses 1 rW.',
    ports: [PIN, pout('o1', 'Power Out 1'), pout('o2', 'Power Out 2'), pout('o3', 'Power Out 3')],
  },
  {
    id: 'blocker', name: 'Blocker', icon: 'electric.blocker', cat: 'logic', draw: 1,
    info: 'Passes power through unless Block Passthrough is powered.',
    ports: [PIN, pin('block', 'Block Passthrough'), POUT],
  },
  {
    id: 'memorycell', name: 'Memory Cell', icon: 'electrical.memorycell', cat: 'logic', draw: 1,
    info: 'A 1-bit store. Set turns it on, Reset turns it off, Toggle flips it. Output is powered when on, Inverted when off.',
    ports: [PIN, pin('set', 'Set'), pin('reset', 'Reset'), pin('toggle', 'Toggle'), pout('inv', 'Power Out Inverted'), POUT],
  },
  {
    id: 'and', name: 'AND Switch', icon: 'electric.andswitch', cat: 'logic', draw: 0,
    info: 'Outputs the greater input only while BOTH inputs are powered.',
    ports: [pin('a', 'Power In 1'), pin('b', 'Power In 2'), POUT],
  },
  {
    id: 'or', name: 'OR Switch', icon: 'electric.orswitch', cat: 'logic', draw: 1,
    info: 'Outputs the greater input while EITHER input is powered.',
    ports: [pin('a', 'Power In 1'), pin('b', 'Power In 2'), POUT],
  },
  {
    id: 'xor', name: 'XOR Switch', icon: 'electric.xorswitch', cat: 'logic', draw: 1,
    info: 'Outputs only while exactly one input is powered.',
    ports: [pin('a', 'Power In 1'), pin('b', 'Power In 2'), POUT],
  },
  {
    id: 'switch', name: 'Switch', icon: 'electric.switch', cat: 'logic', draw: 1, press: 'toggle',
    info: 'A toggle switch. Tap it on the board, or drive it with Switch On / Switch Off.',
    ports: [PIN, pin('on', 'Switch On'), pin('off', 'Switch Off'), POUT],
    params: [{ key: 'on', label: 'On', type: 'bool', default: false }],
  },
  {
    id: 'smartswitch', name: 'Smart Switch', icon: 'smart.switch', cat: 'logic', draw: 1, press: 'toggle',
    info: 'A switch you can flip from the Rust+ app. Tap it on the board to simulate the app.',
    ports: [PIN, pin('on', 'Switch On'), pin('off', 'Switch Off'), POUT],
    params: [{ key: 'on', label: 'On', type: 'bool', default: false }],
  },
  {
    id: 'button', name: 'Button', icon: 'electric.button', cat: 'logic', draw: 1, press: 'press',
    info: 'Passes power for the press duration when pressed. Outputs a 2 rW pulse when it has no input.',
    ports: [PIN, POUT],
    params: [{ key: 'duration', label: 'Press duration (s)', type: 'float', default: 5, min: 0.25, max: 60 }],
  },
  {
    id: 'timer', name: 'Timer', icon: 'electric.timer', cat: 'logic', draw: 1,
    info: 'When Toggle On receives power, passes power through for the set duration.',
    ports: [PIN, pin('trig', 'Toggle On'), POUT],
    params: [{ key: 'duration', label: 'Duration (s)', type: 'float', default: 30, min: 0.25, max: 3600 }],
  },
  {
    id: 'rand', name: 'RAND Switch', icon: 'electric.random.switch', cat: 'logic', draw: 1,
    info: 'Each time Set is powered it rolls 50/50 to allow passthrough. Reset turns it off.',
    ports: [PIN, pin('set', 'Set'), pin('reset', 'Reset'), POUT],
  },
  {
    id: 'counter', name: 'Counter', icon: 'electric.counter', cat: 'logic', draw: 1,
    info: 'Counts rising edges. Passes power through once the count reaches the target, or just shows the power received.',
    ports: [PIN, pin('inc', 'Increment Counter'), pin('dec', 'Decrement Counter'), pin('clear', 'Clear Counter'), pout('out', 'Passthrough')],
    params: [
      { key: 'target', label: 'Target', type: 'int', default: 10, min: 0, max: 100 },
      { key: 'display', label: 'Show passthrough power instead of count', type: 'bool', default: false },
    ],
  },
  {
    id: 'rfbroadcaster', name: 'RF Broadcaster', icon: 'electric.rf.broadcaster', cat: 'logic', draw: 1,
    info: 'Broadcasts its frequency map-wide while powered.',
    ports: [PIN],
    params: [{ key: 'freq', label: 'Frequency', type: 'int', default: 1, min: 1, max: 9999 }],
  },
  {
    id: 'rfreceiver', name: 'RF Receiver', icon: 'electric.rf.receiver', cat: 'logic', draw: 1,
    info: 'Passes power through while its frequency is being broadcast.',
    ports: [PIN, POUT],
    params: [{ key: 'freq', label: 'Frequency', type: 'int', default: 1, min: 1, max: 9999 }],
  },
  {
    id: 'rftransmitter', name: 'RF Transmitter', icon: 'rf.detonator', cat: 'logic', press: 'hold',
    info: 'Hand-held transmitter. Hold the button on the board to broadcast.',
    ports: [],
    params: [{ key: 'freq', label: 'Frequency', type: 'int', default: 1, min: 1, max: 9999 }],
  },
  {
    id: 'rfpager', name: 'RF Pager', icon: 'rf_pager', cat: 'logic',
    info: 'Beeps when its frequency is broadcast.',
    ports: [],
    params: [{ key: 'freq', label: 'Frequency', type: 'int', default: 1, min: 1, max: 9999 }],
  },
  {
    id: 'clock', name: 'Digital Clock', icon: 'electric.digitalclock', cat: 'logic', draw: 1,
    info: 'Outputs a 5 second pulse at the alarm time (in-game time).',
    ports: [PIN, POUT],
    params: [
      { key: 'alarm', label: 'Alarm hour', type: 'float', default: 8, min: 0, max: 23.99, step: 0.25 },
    ],
  },
  {
    id: 'doorcontroller', name: 'Door Controller', icon: 'electric.doorcontroller', cat: 'logic', draw: 1,
    info: 'Opens its paired door while powered and closes it when power stops.',
    ports: [PIN, PASS],
  },

  // ───────────── Sensors
  {
    id: 'hbhf', name: 'HBHF Sensor', icon: 'electric.hbhfsensor', cat: 'sensors', draw: 1,
    info: 'Outputs 1 rW per player detected within its range (up to the input minus 1).',
    ports: [PIN, POUT],
    params: [
      { key: 'range', label: 'Range (m)', type: 'float', default: 10, min: 1, max: 10 },
      { key: 'others', label: 'Include others', type: 'bool', default: true },
      { key: 'authed', label: 'Include authorized', type: 'bool', default: false },
    ],
    radius: (p) => Number(p.range ?? 10),
  },
  {
    id: 'laser', name: 'Laser Detector', icon: 'electric.laserdetector', cat: 'sensors', draw: 1,
    info: 'Passes power while a player stands in the beam. Drag a player across the beam line to trip it.',
    ports: [PIN, POUT],
    params: [
      { key: 'length', label: 'Beam length (m)', type: 'float', default: 8, min: 1, max: 30 },
      { key: 'angle', label: 'Beam direction (°)', type: 'int', default: 0, min: 0, max: 359, step: 15 },
    ],
  },
  {
    id: 'pressurepad', name: 'Pressure Pad', icon: 'electric.pressurepad', cat: 'sensors', draw: 1,
    info: 'Passes power while a player stands on it. Without input it gives a 1 rW pulse.',
    ports: [PIN, POUT],
    radius: () => 1,
  },
  {
    id: 'storagemonitor', name: 'Storage Monitor', icon: 'storage.monitor', cat: 'sensors', draw: 1,
    info: 'Attaches to the nearest box or tool cupboard within 3 m. Pulses 1 rW when the contents change (needs 2 rW input).',
    ports: [PIN, POUT],
    radius: () => 3,
  },
  {
    id: 'smartalarm', name: 'Smart Alarm', icon: 'smart.alarm', cat: 'sensors', draw: 1,
    info: 'Sends a phone notification when powered. Shows a notification here instead.',
    ports: [PIN, PASS],
    params: [{ key: 'msg', label: 'Message', type: 'text', default: 'Base alarm triggered' }],
  },

  // ───────────── Devices
  consumer('ceilinglight', 'Ceiling Light', 'ceilinglight', 2, 'Lights the room. Also gives light to plants within 3 m.'),
  consumer('simplelight', 'Simple Light', 'electric.simplelight', 1, 'A debug light.'),
  consumer('flasher', 'Flasher Light', 'electric.flasherlight', 1, 'A flashing blue light.'),
  consumer('siren', 'Siren Light', 'electric.sirenlight', 1, 'A spinning siren light.'),
  consumer('searchlight', 'Search Light', 'searchlight', 10, 'A large aimable light.'),
  consumer('walllight', 'Industrial Wall Light', 'industrial.wall.light', 1, 'A small light.'),
  consumer('walllight_g', 'Green Industrial Wall Light', 'industrial.wall.light.green', 1, 'A small green light.'),
  consumer('walllight_r', 'Red Industrial Wall Light', 'industrial.wall.light.red', 1, 'A small red light.'),
  consumer('xmaslights', 'Deluxe Christmas Lights', 'xmas.lightstring.advanced', 5, 'Animated powered lights.'),
  consumer('neon_s', 'Small Neon Sign', 'sign.neon.125x125', 4, 'A small neon sign.'),
  consumer('neon_m', 'Medium Neon Sign', 'sign.neon.125x215', 6, 'A medium neon sign.'),
  consumer('neon_ma', 'Medium Animated Neon Sign', 'sign.neon.125x215.animated', 10, 'An animated medium neon sign.'),
  consumer('neon_l', 'Large Neon Sign', 'sign.neon.xl', 8, 'A large neon sign.'),
  consumer('neon_la', 'Large Animated Neon Sign', 'sign.neon.xl.animated', 15, 'An animated large neon sign.'),
  consumer('audioalarm', 'Audio Alarm', 'electric.audioalarm', 1, 'Sounds a loud alarm while powered.', false),
  consumer('heater', 'Electric Heater', 'electric.heater', 3, 'Warms its surroundings.'),
  consumer('igniter', 'Igniter', 'electric.igniter', 1, 'Lights furnaces, refineries and campfires within 1.5 m while powered.', false),
  consumer('cctv', 'CCTV Camera', 'cctv.camera', 3, 'Streams to a computer station while powered.', false),
  consumer('ptzcctv', 'PTZ CCTV Camera', 'ptz.cctv.camera', 3, 'Pan, tilt and zoom camera.', false),
  consumer('computer', 'Computer Station', 'computerstation', 5, 'Views CCTV cameras while powered.', false),
  consumer('elevator', 'Elevator', 'elevator', 5, 'A powered elevator floor.', false),
  consumer('carlift', 'Modular Car Lift', 'modularcarlift', 5, 'Lets you edit modular cars.', false),
  consumer('telephone', 'Telephone', 'telephone', 1, 'Calls other telephones on the island.'),
  {
    id: 'efurnace', name: 'Electric Furnace', icon: 'electric.furnace', cat: 'crafting', draw: 3, slots: 6, adaptor: true,
    info: 'Smelts ores without fuel while powered (3 rW). Turn On / Turn Off control it.',
    ports: [PIN, pin('on', 'Turn On'), pin('off', 'Turn Off'), ...ADAPTOR],
    params: [ADAPTOR_PARAM, { key: 'on', label: 'Turned on', type: 'bool', default: true }],
    press: 'toggle',
  },

  // ───────────── Defense
  {
    id: 'turret', name: 'Auto Turret', icon: 'autoturret', cat: 'defense', draw: 10, slots: 6,
    info: 'Needs 10 rW to run and 11 rW for its outputs. Targets unauthorized players within 30 m while it has ammo.',
    ports: [PIN, pout('target', 'Has Target'), pout('low', 'Low Ammo'), pout('none', 'No Ammo'), PASS],
    params: [{ key: 'range', label: 'Range (m)', type: 'float', default: 30, min: 1, max: 30 }],
    radius: (p) => Number(p.range ?? 30),
  },
  {
    id: 'sam', name: 'SAM Site', icon: 'samsite', cat: 'defense', draw: 25, slots: 6,
    info: 'Needs 25 rW to run and 26 rW for its outputs. Toggle "Aircraft nearby" to simulate a target.',
    ports: [PIN, pout('target', 'Has Target'), pout('low', 'Low Ammo'), pout('none', 'No Ammo'), PASS],
    params: [{ key: 'aircraft', label: 'Aircraft nearby', type: 'bool', default: false, simOnly: true }],
  },
  {
    id: 'tesla', name: 'Tesla Coil', icon: 'electric.teslacoil', cat: 'defense', draw: 1,
    info: 'Shocks nearby players. Damage per second equals input power, capped at 35.',
    ports: [PIN],
    radius: () => 3,
  },

  // ───────────── Water
  {
    id: 'waterpump', name: 'Water Pump', icon: 'waterpump', cat: 'water', draw: 5,
    info: 'Pumps 85 mL every 10 seconds from the water source while powered (5 rW).',
    ports: [PIN, fout('wout', 'Water Output')],
    params: [{ key: 'salt', label: 'Placed in salt water', type: 'bool', default: true }],
  },
  {
    id: 'purifier', name: 'Powered Water Purifier', icon: 'powered.water.purifier', cat: 'water', draw: 5,
    info: 'Converts salt water to fresh water while powered (5 rW).',
    ports: [PIN, fin('win', 'Water In'), fout('wout', 'Water Out')],
  },
  {
    id: 'waterbarrel', name: 'Water Barrel', icon: 'water.barrel', cat: 'water',
    info: 'Stores 20,000 mL. Chain it to other water containers.',
    ports: [fin('win', 'Water In'), fout('wout', 'Water Out')],
  },
  {
    id: 'catcher_s', name: 'Small Water Catcher', icon: 'water.catcher.small', cat: 'water',
    info: 'Collects fresh water from rain and dew. Stores 10,000 mL.',
    ports: [fin('win', 'Water In'), fout('wout', 'Water Out')],
  },
  {
    id: 'catcher_l', name: 'Large Water Catcher', icon: 'water.catcher.large', cat: 'water',
    info: 'Collects fresh water from rain and dew. Stores 50,000 mL.',
    ports: [fin('win', 'Water In'), fout('wout', 'Water Out')],
  },
  {
    id: 'fluidswitch', name: 'Fluid Switch & Pump', icon: 'fluid.switch', cat: 'water', press: 'toggle',
    info: 'Lets water through while on. Pump Power lets it push water upward.',
    ports: [fin('win', 'Water In'), pin('pump', 'Pump Power'), pin('toggle', 'Toggle'), fout('wout', 'Water Out')],
    params: [{ key: 'on', label: 'On', type: 'bool', default: true }],
  },
  {
    id: 'fluidsplitter', name: 'Fluid Splitter', icon: 'fluid.splitter', cat: 'water',
    info: 'Splits water evenly between connected outputs.',
    ports: [fin('win', 'Water In'), fout('o1', 'Water Out 1'), fout('o2', 'Water Out 2'), fout('o3', 'Water Out 3')],
  },
  {
    id: 'fluidcombiner', name: 'Fluid Combiner', icon: 'fluid.combiner', cat: 'water',
    info: 'Combines three water lines into one.',
    ports: [fin('a', 'Water In 1'), fin('b', 'Water In 2'), fin('c', 'Water In 3'), fout('wout', 'Water Out')],
  },
  {
    id: 'sprinkler', name: 'Sprinkler', icon: 'electric.sprinkler', cat: 'farming',
    info: 'Sprays water on planters within 3 m. Uses water twice as fast when the passthrough is used.',
    ports: [fin('win', 'Water In'), fout('wout', 'Passthrough')],
    radius: () => 3,
  },

  // ───────────── Farming
  planter('planter_s', 'Small Planter Box', 'planter.small', 3),
  planter('planter_l', 'Large Planter Box', 'planter.large', 9),
  planter('planter_bath', 'Bath Tub Planter', 'bathtub.planter', 3),
  planter('planter_cart', 'Minecart Planter', 'minecart.planter', 3),
  planter('planter_rail', 'Railroad Planter', 'rail.road.planter', 9),
  {
    id: 'composter', name: 'Composter', icon: 'composter', cat: 'farming', slots: 12, adaptor: true,
    info: 'Turns food, plant fibre and horse dung into fertilizer over time.',
    ports: [...ADAPTOR], params: [ADAPTOR_PARAM],
  },

  // ───────────── Industrial
  {
    id: 'conveyor', name: 'Industrial Conveyor', icon: 'industrial.conveyor', cat: 'industrial', draw: 1,
    info: 'Moves items from the containers on its input pipe to the containers on its output pipe. Set filters in the inspector.',
    ports: [PIN, pin('on', 'Turn On'), pin('off', 'Turn Off'), iin('iin', 'Industrial In'), PASS, iout('iout', 'Industrial Out')],
    params: [
      { key: 'on', label: 'Turned on', type: 'bool', default: true },
      { key: 'rate', label: 'Items per transfer', type: 'int', default: 60, min: 1, max: 1000, simOnly: true },
    ],
    press: 'toggle',
  },
  {
    id: 'isplitter', name: 'Industrial Splitter', icon: 'industrial.splitter', cat: 'industrial',
    info: 'Splits an industrial line into three.',
    ports: [iin('iin', 'Industrial In'), iout('o1', 'Industrial Out 1'), iout('o2', 'Industrial Out 2'), iout('o3', 'Industrial Out 3')],
  },
  {
    id: 'icombiner', name: 'Industrial Combiner', icon: 'industrial.combiner', cat: 'industrial',
    info: 'Combines three industrial lines into one.',
    ports: [iin('a', 'Industrial In 1'), iin('b', 'Industrial In 2'), iin('c', 'Industrial In 3'), iout('iout', 'Industrial Out')],
  },
  {
    id: 'crafter', name: 'Industrial Crafter', icon: 'industrial.crafter', cat: 'industrial', draw: 1, slots: 18,
    info: 'Place it within 3 m of a workbench. Crafts its blueprint templates from the items piped in, at that workbench’s level.',
    ports: [PIN, pin('on', 'Turn On'), pin('off', 'Turn Off'), pin('toggle', 'Toggle'), iin('iin', 'Industrial In'), PASS, iout('iout', 'Industrial Out')],
    params: [{ key: 'on', label: 'Turned on', type: 'bool', default: true }],
    press: 'toggle',
    radius: () => 3,
  },

  // ───────────── Storage
  container('box_s', 'Wood Storage Box', 'box.wooden', 12, 'A small storage box.'),
  container('box_l', 'Large Wood Box', 'box.wooden.large', 48, 'A large storage box.'),
  container('barrel_v', 'Storage Barrel Vertical', 'storage_barrel_b', 42, 'A tall storage barrel.'),
  container('barrel_h', 'Storage Barrel Horizontal', 'storage_barrel_c', 42, 'A wide storage barrel.'),
  container('coffin', 'Coffin', 'coffin.storage', 42, 'Spooky storage.'),
  container('fridge', 'Fridge', 'fridge', 30, 'Keeps food fresh.'),
  container('locker', 'Locker', 'locker', 36, 'Holds gear and attire.'),
  container('tc', 'Tool Cupboard', 'cupboard.tool', 24, 'Holds upkeep resources.'),
  container('dropbox', 'Drop Box', 'dropbox', 12, 'Anyone can drop items in; only owners take out.'),
  container('stash', 'Small Stash', 'stash.small', 6, 'A hidden stash.'),

  // ───────────── Crafting
  {
    id: 'wb1', name: 'Work Bench Level 1', icon: 'workbench1', cat: 'crafting',
    info: 'Lets players within 3 m craft level 1 items. Open it in the inspector to craft.',
    ports: [], radius: () => 3,
  },
  {
    id: 'wb2', name: 'Work Bench Level 2', icon: 'workbench2', cat: 'crafting',
    info: 'Lets players within 3 m craft level 1–2 items.',
    ports: [], radius: () => 3,
  },
  {
    id: 'wb3', name: 'Work Bench Level 3', icon: 'workbench3', cat: 'crafting',
    info: 'Lets players within 3 m craft every item.',
    ports: [], radius: () => 3,
  },
  {
    id: 'furnace', name: 'Furnace', icon: 'furnace', cat: 'crafting', slots: 6, adaptor: true, press: 'toggle',
    info: 'Burns wood to smelt ore. Wood leaves charcoal.',
    ports: [...ADAPTOR], params: [ADAPTOR_PARAM, { key: 'on', label: 'Lit', type: 'bool', default: false }],
  },
  {
    id: 'furnace_l', name: 'Large Furnace', icon: 'furnace.large', cat: 'crafting', slots: 18, adaptor: true, press: 'toggle',
    info: 'Smelts about five times faster than a small furnace.',
    ports: [...ADAPTOR], params: [ADAPTOR_PARAM, { key: 'on', label: 'Lit', type: 'bool', default: false }],
  },
  {
    id: 'refinery', name: 'Small Oil Refinery', icon: 'small.oil.refinery', cat: 'crafting', slots: 6, adaptor: true, press: 'toggle',
    info: 'Burns wood to turn Crude Oil into Low Grade Fuel (1 → 3).',
    ports: [...ADAPTOR], params: [ADAPTOR_PARAM, { key: 'on', label: 'Lit', type: 'bool', default: false }],
  },
  {
    id: 'recycler', name: 'Recycler', icon: 'recycler', cat: 'crafting', slots: 12, adaptor: true, press: 'toggle',
    info: 'Breaks items down into components, one every 5 seconds.',
    ports: [...ADAPTOR],
    params: [
      ADAPTOR_PARAM,
      { key: 'on', label: 'Running', type: 'bool', default: false },
      { key: 'rad', label: 'Radtown recycler (higher yields)', type: 'bool', default: false },
    ],
  },

  // ───────────── Simulator
  {
    id: 'player', name: 'Player', icon: 'hazmatsuit', cat: 'sim', slots: 30,
    info: 'Drag players around to trip sensors and turrets. Players near a workbench can craft.',
    ports: [],
    params: [
      { key: 'name', label: 'Name', type: 'text', default: 'Survivor' },
      { key: 'authed', label: 'Authorized on turrets / TC', type: 'bool', default: true },
    ],
  },
  {
    id: 'godbox', name: 'God Box', icon: 'sim.godbox', cat: 'sim', slots: 48, adaptor: true,
    info: 'Spawns the items you pick: endless, a fixed amount, or filling every slot.',
    ports: [...ADAPTOR], params: [ADAPTOR_PARAM],
  },
  {
    id: 'voidbox', name: 'Void Box', icon: 'sim.voidbox', cat: 'sim', slots: 12, adaptor: true,
    info: 'Deletes everything put into it and counts what it received.',
    ports: [...ADAPTOR], params: [ADAPTOR_PARAM],
  },
];

export const DEF: Record<string, Def> = Object.fromEntries(DEFS.map((d) => [d.id, d]));

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'power', label: 'Power' },
  { id: 'logic', label: 'Logic' },
  { id: 'sensors', label: 'Sensors' },
  { id: 'devices', label: 'Devices' },
  { id: 'defense', label: 'Defense' },
  { id: 'water', label: 'Water' },
  { id: 'farming', label: 'Farming' },
  { id: 'industrial', label: 'Industrial' },
  { id: 'storage', label: 'Storage' },
  { id: 'crafting', label: 'Crafting' },
  { id: 'sim', label: 'Simulator' },
];

export const BATTERY: Record<string, { out: number; cap: number }> = {
  battery_s: { out: 15, cap: 400 },
  battery_m: { out: 50, cap: 9000 },
  battery_l: { out: 100, cap: 24000 },
};
export const WATER_CAP: Record<string, number> = {
  waterbarrel: 20000, catcher_s: 10000, catcher_l: 50000, waterpump: 2000, purifier: 5000,
};
export const WB_TIER: Record<string, number> = { wb1: 1, wb2: 2, wb3: 3 };

export function portsOf(def: Def, params: Record<string, unknown>) {
  return def.ports.filter((p) => !p.when || params[p.when]);
}
export function defaultParams(def: Def) {
  const o: Record<string, unknown> = {};
  for (const p of def.params ?? []) o[p.key] = p.default;
  return o;
}

export const WIRE_COLORS: { id: string; label: string; hex: string }[] = [
  { id: 'default', label: 'Default', hex: '#8f9498' },
  { id: 'red', label: 'Red', hex: '#d0352b' },
  { id: 'green', label: 'Green', hex: '#4fb83a' },
  { id: 'blue', label: 'Blue', hex: '#2f6fd6' },
  { id: 'yellow', label: 'Yellow', hex: '#e8c51e' },
  { id: 'pink', label: 'Pink', hex: '#e36fb6' },
  { id: 'purple', label: 'Purple', hex: '#8a4fd0' },
  { id: 'orange', label: 'Orange', hex: '#ea7a1f' },
  { id: 'white', label: 'White', hex: '#e9e9e4' },
  { id: 'lightblue', label: 'Light Blue', hex: '#5cc6ea' },
];
export const colorHex = (id: string) => WIRE_COLORS.find((c) => c.id === id)?.hex ?? WIRE_COLORS[0].hex;
