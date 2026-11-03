import type { Plant } from './world';

export const PLANT_TYPES: { id: string; name: string; seed: string; clone: string; product: string; base: number }[] = [
  { id: 'hemp', name: 'Hemp', seed: 'seed.hemp', clone: 'clone.hemp', product: 'cloth', base: 10 },
  { id: 'corn', name: 'Corn', seed: 'seed.corn', clone: 'clone.corn', product: 'corn', base: 2 },
  { id: 'potato', name: 'Potato', seed: 'seed.potato', clone: 'clone.potato', product: 'potato', base: 3 },
  { id: 'pumpkin', name: 'Pumpkin', seed: 'seed.pumpkin', clone: 'clone.pumpkin', product: 'pumpkin', base: 1 },
  { id: 'red.berry', name: 'Red Berry', seed: 'seed.red.berry', clone: 'clone.red.berry', product: 'red.berry', base: 3 },
  { id: 'blue.berry', name: 'Blue Berry', seed: 'seed.blue.berry', clone: 'clone.blue.berry', product: 'blue.berry', base: 3 },
  { id: 'yellow.berry', name: 'Yellow Berry', seed: 'seed.yellow.berry', clone: 'clone.yellow.berry', product: 'yellow.berry', base: 3 },
  { id: 'green.berry', name: 'Green Berry', seed: 'seed.green.berry', clone: 'clone.green.berry', product: 'green.berry', base: 3 },
  { id: 'white.berry', name: 'White Berry', seed: 'seed.white.berry', clone: 'clone.white.berry', product: 'white.berry', base: 3 },
  { id: 'black.berry', name: 'Black Berry', seed: 'seed.black.berry', clone: 'clone.black.berry', product: 'black.berry', base: 3 },
];
export const PLANT: Record<string, (typeof PLANT_TYPES)[number]> = Object.fromEntries(PLANT_TYPES.map((p) => [p.id, p]));
export const plantFromItem = (s: string) => PLANT_TYPES.find((p) => p.seed === s || p.clone === s);

// Stage lengths in sim seconds at perfect conditions.
export const STAGES = [
  { name: 'Seed', len: 150 },
  { name: 'Seedling', len: 300 },
  { name: 'Sapling', len: 300 },
  { name: 'Crossbreed', len: 300 },
  { name: 'Mature', len: 600 },
  { name: 'Fruiting', len: 600 },
  { name: 'Ripe', len: 1200 },
  { name: 'Dying', len: Infinity },
];
export function stageOf(age: number) {
  let t = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (age < t + STAGES[i].len) return { i, name: STAGES[i].name, progress: (age - t) / STAGES[i].len };
    t += STAGES[i].len;
  }
  return { i: STAGES.length - 1, name: 'Dying', progress: 1 };
}
export const stageStart = (i: number) => STAGES.slice(0, i).reduce((a, s) => a + s.len, 0);

export const GENE_WEIGHT: Record<string, number> = { G: 0.6, Y: 0.6, H: 0.6, W: 1, X: 1 };
export const GENE_INFO: Record<string, string> = {
  G: 'Growth: grows faster',
  Y: 'Yield: more produce',
  H: 'Hardiness: tolerates bad conditions',
  W: 'Water: uses more water (bad)',
  X: 'Empty: does nothing (bad)',
};

export function randomGenes() {
  const pool = 'GGYYHHWWWXXX';
  let g = '';
  for (let i = 0; i < 6; i++) g += pool[Math.floor(Math.random() * pool.length)];
  return g;
}
export const geneCount = (g: string, c: string) => [...g].filter((x) => x === c).length;

/**
 * Rust crossbreeding: for each of the 6 slots, sum the weights of each gene among neighbours.
 * The heaviest gene wins if its total weight beats the plant's own gene weight (> 1 overall), ties pick randomly.
 */
export function crossbreed(self: Plant, neighbours: Plant[]) {
  if (!neighbours.length) return self.genes;
  let out = '';
  for (let i = 0; i < 6; i++) {
    const w: Record<string, number> = {};
    for (const n of neighbours) w[n.genes[i]] = (w[n.genes[i]] ?? 0) + GENE_WEIGHT[n.genes[i]];
    let best = self.genes[i];
    let bestW = 1; // must beat 1 to replace
    const cands: string[] = [];
    for (const [g, v] of Object.entries(w)) {
      if (v > bestW + 1e-9) { bestW = v; cands.length = 0; cands.push(g); }
      else if (Math.abs(v - bestW) < 1e-9 && v > 1) cands.push(g);
    }
    if (cands.length) best = cands[Math.floor(Math.random() * cands.length)];
    out += best;
  }
  return out;
}

/** Neighbour indices for a planter layout (3 wide grid). */
export function neighboursOf(i: number, count: number) {
  const cols = 3;
  const r = Math.floor(i / cols), c = i % cols;
  const res: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (cc < 0 || cc >= cols || rr < 0) continue;
      const j = rr * cols + cc;
      if (j < count) res.push(j);
    }
  return res;
}

export function harvestYield(p: Plant) {
  const t = PLANT[p.type];
  const y = geneCount(p.genes, 'Y');
  return Math.max(1, Math.round(t.base * (1 + 0.15 * y) * (0.5 + 0.5 * p.health)));
}
