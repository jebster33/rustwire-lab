import raw from './items.json';

export type Recipe = { y: number; wb: number; t: number; i: [string, number][] };
export type ItemInfo = {
  n: string;
  id?: number;
  g: string;
  d: string;
  c?: Recipe;
  r?: [string, number][];
  rr?: [string, number][];
};

export const ITEMS = raw as unknown as Record<string, ItemInfo>;
export const ITEM_KEYS = Object.keys(ITEMS).sort((a, b) => ITEMS[a].n.localeCompare(ITEMS[b].n));

export const itemName = (s: string) => ITEMS[s]?.n ?? s;

const ICON_OVERRIDE: Record<string, string> = {
  'sim.godbox': 'box.wooden.large',
  'sim.voidbox': 'box.wooden',
  'sim.pile': 'box.wooden',
};
export const iconUrl = (s: string) =>
  `https://wiki.rustclash.com/img/items180/${ICON_OVERRIDE[s] ?? s}.png`;

// Vanilla stack sizes. The dataset has none, so these are by item type with overrides.
const STACK: Record<string, number> = {
  wood: 1000, stones: 1000, 'metal.fragments': 1000, 'metal.ore': 1000, 'sulfur.ore': 1000,
  'hq.metal.ore': 1000, sulfur: 1000, charcoal: 1000, scrap: 1000, cloth: 1000, leather: 1000,
  'metal.refined': 100, lowgradefuel: 500, 'crude.oil': 500, gunpowder: 1000, explosives: 100,
  'bone.fragments': 1000, 'fat.animal': 1000, paper: 1000, plantfiber: 1000, fertilizer: 1000,
  horsedung: 100, techparts: 50, gears: 20, metalpipe: 20, metalspring: 20, sheetmetal: 20,
  tarp: 20, rope: 50, sewingkit: 20, roadsigns: 20, metalblade: 20, propanetank: 5,
  semibody: 10, smgbody: 10, riflebody: 10, 'targeting.computer': 5, 'cctv.camera': 5,
  corn: 20, potato: 20, pumpkin: 20, 'red.berry': 20, 'blue.berry': 20, 'yellow.berry': 20,
  'green.berry': 20, 'white.berry': 20, 'black.berry': 20, water: 20000, 'water.salt': 20000,
  'ammo.rifle': 128, 'ammo.pistol': 128, 'ammo.shotgun': 64, 'ammo.rocket.basic': 3,
  'ammo.rifle.hv': 128, 'ammo.rifle.incendiary': 128, 'ammo.rifle.explosive': 128,
  'ammo.pistol.hv': 128, 'ammo.pistol.fire': 128, 'ammo.shotgun.slug': 64, 'ammo.shotgun.fire': 64,
  'ammo.handmade.shell': 64, 'battery.small': 10, researchpaper: 1000,
};
export function stackSize(s: string): number {
  if (STACK[s]) return STACK[s];
  if (s.startsWith('seed.') || s.startsWith('clone.')) return 50;
  const g = ITEMS[s]?.g;
  switch (g) {
    case 'resources': return 1000;
    case 'components': return 20;
    case 'ammo': return 128;
    case 'food': return 20;
    case 'medical': return 10;
    case 'construction': return 10;
    case 'electrical': return 10;
    case 'items': return 1;
    case 'misc': return 10;
    default: return 1;
  }
}

/** Raw resource breakdown for crafting `amount` of an item, recursing into craftable components. */
export function rawCost(item: string, amount: number, deep = true) {
  const totals = new Map<string, number>();
  let time = 0;
  const walk = (it: string, n: number, depth: number) => {
    const rec = ITEMS[it]?.c;
    const isBase = !rec || depth > 6 || (depth > 0 && !deep) || ITEMS[it]?.g === 'resources';
    if (isBase || depth > 0 && ITEMS[it]?.g === 'components' && !deep) {
      totals.set(it, (totals.get(it) ?? 0) + n);
      return;
    }
    const crafts = Math.ceil(n / rec!.y);
    time += crafts * rec!.t;
    for (const [ing, a] of rec!.i) walk(ing, a * crafts, depth + 1);
  };
  walk(item, amount, 0);
  return { totals: [...totals.entries()].sort((a, b) => b[1] - a[1]), time };
}

export const GROUP_LABEL: Record<string, string> = {
  weapons: 'Weapons', construction: 'Construction', items: 'Items', resources: 'Resources',
  attire: 'Attire', tools: 'Tools', medical: 'Medical', food: 'Food', ammo: 'Ammo', traps: 'Traps',
  misc: 'Misc', components: 'Components', electrical: 'Electrical', fun: 'Fun', sim: 'Simulator',
};
