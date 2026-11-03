// Builds src/data/items.json from the abbmarand/rustitems dataset (scraped from RustLabs).
// Usage: node scripts/build-data.mjs <path-to>/rustitems/data/itemsbyshortname.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-data.mjs <itemsbyshortname.json>');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(src, 'utf8'));

const SMALL = new Set(['and', 'or', 'of', 'the', 'a', 'to', 'in', 'on', 'with']);
const titleCase = (slug) =>
  slug
    .split('-')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\bRf\b/g, 'RF')
    .replace(/\bHbhf\b/g, 'HBHF')
    .replace(/\bXor\b/g, 'XOR')
    .replace(/\bAnd Switch\b/g, 'AND Switch')
    .replace(/\bOr Switch\b/g, 'OR Switch')
    .replace(/\bCctv\b/g, 'CCTV')
    .replace(/\bPtz\b/g, 'PTZ')
    .replace(/\bSam\b/g, 'SAM')
    .replace(/\bHqm\b/g, 'HQM')
    .replace(/\bMp5a4\b/g, 'MP5A4')
    .replace(/\bM249\b/g, 'M249')
    .replace(/\bL96\b/g, 'L96')
    .replace(/\bM39\b/g, 'M39')
    .replace(/\bLr 300\b/g, 'LR-300')
    .replace(/\bSks\b/g, 'SKS');

const firstSentence = (s = '') => {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,220}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 220)).trim();
};

const out = {};
for (const [short, v] of Object.entries(raw)) {
  const it = { n: titleCase(v.name || short), g: v.group || 'misc', d: firstSentence(v.description), id: v.identifier };
  const cd = v.craftData;
  if (cd && cd.recipie && cd.recipie.craftCost && cd.recipie.craftCost.length) {
    it.c = {
      y: cd.yield || 1,
      wb: cd.workbench || 0,
      t: (cd.craftTime && cd.craftTime.craftTime && (cd.craftTime.craftTime.short ?? cd.craftTime.craftTime.long)) || 0,
      i: cd.recipie.craftCost.map((c) => [c.name, c.amount]),
    };
  }
  const rd = v.recycleData;
  if (rd && rd.recycleYieldsafe && rd.recycleYieldsafe.length) {
    it.r = rd.recycleYieldsafe.map((c) => [c.name, c.amount]);
    if (rd.recycleYieldrad) it.rr = rd.recycleYieldrad.map((c) => [c.name, c.amount]);
  }
  out[short] = it;
}

// Newer items missing from the scraped dataset
out['hopper'] = out['hopper'] ?? { n: 'Hopper', g: 'electrical', d: 'Sucks up dropped items around it while powered and puts them in the container it is attached to.', c: { y: 1, wb: 1, t: 10, i: [['metal.fragments', 200]] } };

// Simulator-only entries that aren't in the dataset
out['sim.godbox'] = { n: 'God Box', g: 'sim', d: 'Simulator-only container that spawns the items you choose.' };
out['sim.pile'] = { n: 'Dropped Items', g: 'sim', d: 'A pile of items lying on the ground.' };
out['sim.voidbox'] = { n: 'Void Box', g: 'sim', d: 'Simulator-only container that deletes anything put in it.' };

mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/data/items.json', import.meta.url), JSON.stringify(out));
console.log('items:', Object.keys(out).length);
