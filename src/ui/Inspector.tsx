import { useMemo, useState } from 'react';
import { useStore, useTick } from '../store';
import { DEF, BATTERY, WATER_CAP, WB_TIER, WIRE_COLORS, portsOf, type ParamDef } from '../sim/defs';
import { world, addItem, countItem, takeItem, type WNode, type Plant } from '../sim/world';
import { rectDist, type Filter } from '../sim/engine';
import { graphOf } from '../store';
import { ITEMS, itemName, rawCost, stackSize } from '../data/items';
import { PLANT_TYPES, PLANT, stageOf, randomGenes, GENE_INFO, harvestYield, stageStart } from '../sim/plants';
import { ItemIcon, Ic } from './icons';
import { InventoryGrid, HandBar, ItemPicker } from './Inventory';
import { fmtTime } from './DepNode';
import SimPanel from './SimPanel';

function ParamField({ n, p }: { n: WNode; p: ParamDef }) {
  const setParam = useStore((s) => s.setParam);
  const v = n.params[p.key];
  const tag = p.simOnly ? <span className="sim-tag" title="Simulator-only setting">sim</span> : null;
  if (p.type === 'bool')
    return (
      <label className="check">
        <input type="checkbox" checked={!!v} onChange={(e) => setParam(n.id, p.key, e.target.checked)} />
        {p.label}{tag}
      </label>
    );
  if (p.type === 'text')
    return (
      <div className="field">
        <label>{p.label}</label>
        <input className="input" value={String(v ?? '')} onChange={(e) => setParam(n.id, p.key, e.target.value)} />
      </div>
    );
  const id = `${n.id}-${p.key}`;
  const range = p.max != null && p.max - (p.min ?? 0) <= 360;
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}{tag}</label>
      <div className="row">
        {range && (
          <input type="range" min={p.min} max={p.max} step={p.step ?? (p.type === 'int' ? 1 : 0.25)} value={Number(v)} onChange={(e) => setParam(n.id, p.key, Number(e.target.value))} aria-label={p.label} />
        )}
        <input
          id={id}
          className="input"
          style={{ width: range ? 84 : '100%' }}
          type="number"
          min={p.min}
          max={p.max}
          step={p.step ?? (p.type === 'int' ? 1 : 0.25)}
          value={Number(v)}
          onChange={(e) => {
            let x = Number(e.target.value);
            if (p.min != null) x = Math.max(p.min, x);
            if (p.max != null) x = Math.min(p.max, x);
            setParam(n.id, p.key, p.type === 'int' ? Math.round(x) : x);
          }}
        />
      </div>
    </div>
  );
}

function Stats({ n }: { n: WNode }) {
  const def = DEF[n.def];
  const rows: [string, React.ReactNode][] = [];
  const S = n.st;
  const ports = portsOf(def, n.params);
  for (const p of ports.filter((x) => x.kind === 'power')) {
    const v = p.dir === 'in' ? n.pin[p.key] : n.pout[p.key];
    rows.push([p.label, `${v ?? 0} rW`]);
  }
  if (def.draw != null) rows.push(['Consumption', `${def.draw} rW`]);
  if (BATTERY[n.def]) {
    const b = BATTERY[n.def];
    rows.push(['Stored', `${Math.round(S.charge ?? 0).toLocaleString()} / ${b.cap.toLocaleString()} rWm`]);
    rows.push(['Charging', `${Math.round((S.chargeRate ?? 0) * 10) / 10} rW`]);
    rows.push(['In use', `${S.load ?? 0} rW`]);
    if ((S.load ?? 0) > 0) rows.push(['Runs out in', fmtTime(((S.charge ?? 0) * 60) / S.load)]);
  }
  if (['solar', 'wind', 'fuelgen', 'testgen', 'rootcombiner'].includes(n.def)) rows.push(['In use', `${S.load ?? 0} rW`]);
  if (n.def === 'fuelgen') rows.push(['Fuel left', fmtTime(countItem(n.inv, 'lowgradefuel') * 15)]);
  if (WATER_CAP[n.def]) rows.push(['Water', `${Math.round(S.water ?? 0).toLocaleString()} / ${WATER_CAP[n.def].toLocaleString()} mL`]);
  if (n.def === 'hbhf') rows.push(['Players detected', S.detected ?? 0]);
  if (n.def === 'counter') rows.push(['Count', S.count ?? 0]);
  if (n.def === 'timer' || n.def === 'button') rows.push(['Time left', (S.t ?? 0) > 0 ? fmtTime(S.t) : '—']);
  if (n.def === 'turret' || n.def === 'sam') rows.push(['Ammo', S.ammo ?? 0], ['Target', S.target ? 'Yes' : 'No']);
  if (n.def === 'storagemonitor') rows.push(['Watching', S.target ? DEF[world.current.nodes[S.target]?.def]?.name ?? '—' : 'Nothing within 3 m']);
  if (n.def === 'crafter') rows.push(['Workbench', S.tier ? `Level ${S.tier}` : 'None within 3 m'], ['Crafted', S.made ?? 0]);
  if (!rows.length) return null;
  return (
    <div className="section">
      <h3>Live</h3>
      <dl className="stats">{rows.map(([a, b]) => <FragmentRow key={a} a={a} b={b} />)}</dl>
    </div>
  );
}
const FragmentRow = ({ a, b }: { a: string; b: React.ReactNode }) => (<><dt>{a}</dt><dd>{b}</dd></>);

function AddItemButton({ n, label = 'Add item', filter }: { n: WNode; label?: string; filter?: (s: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const poke = useStore((s) => s.poke);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><Ic.plus />{label}</button>
      {open && (
        <ItemPicker
          title={`${label}, ${DEF[n.def].name}`}
          filter={filter}
          onClose={() => setOpen(false)}
          onPick={(s, a) => { addItem(n.inv, s, a); poke(); setOpen(false); }}
        />
      )}
    </>
  );
}

function GodBox({ n }: { n: WNode }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const [open, setOpen] = useState(false);
  const entries: { s: string; mode: string; n: number }[] = (n.st.entries ??= []);
  const apply = () => {
    for (const e of entries) if (e.mode === 'amount') addItem(n.inv, e.s, e.n);
    poke();
  };
  return (
    <div className="section">
      <h3>Spawns<span className="spacer" /><button className="btn" onClick={() => setOpen(true)}><Ic.plus />Item</button></h3>
      <div className="list">
        {entries.map((e, i) => (
          <div className="li" key={i}>
            <ItemIcon s={e.s} size={30} />
            <div className="grow">
              <div className="name">{itemName(e.s)}</div>
              <div className="row" style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <select className="select" value={e.mode} onChange={(ev) => { e.mode = ev.target.value; poke(); }} aria-label="Spawn mode">
                  <option value="infinite">Endless</option>
                  <option value="amount">Amount</option>
                  <option value="fill">Fill slots</option>
                </select>
                {e.mode === 'amount' && (
                  <input className="input" type="number" min={1} style={{ width: 90 }} value={e.n} onChange={(ev) => { e.n = Math.max(1, Number(ev.target.value)); poke(); }} aria-label="Amount" />
                )}
              </div>
            </div>
            <button className="btn icon ghost" aria-label="Remove" onClick={() => { entries.splice(i, 1); poke(); }}><Ic.x /></button>
          </div>
        ))}
      </div>
      {!entries.length && <p className="help">Pick items to spawn. Endless keeps a full stack topped up, Fill slots fills every free slot, Amount adds a set number when you press Spawn.</p>}
      <div className="btnrow" style={{ marginTop: 8 }}>
        <button className="btn" onClick={apply} disabled={!entries.some((e) => e.mode === 'amount')}>Spawn amounts</button>
        <button className="btn" onClick={() => { n.inv.fill(null); poke(); }}>Empty box</button>
      </div>
      {open && (
        <ItemPicker
          title="Add to God Box"
          onClose={() => setOpen(false)}
          onPick={(s, a) => { entries.push({ s, mode: 'infinite', n: a }); setOpen(false); poke(); }}
          withAmount={false}
        />
      )}
    </div>
  );
}

function ConveyorFilters({ n }: { n: WNode }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const [open, setOpen] = useState(false);
  const filters: Filter[] = (n.st.filters ??= []);
  return (
    <div className="section">
      <h3>Filter<span className="spacer" /><button className="btn" onClick={() => setOpen(true)}><Ic.plus />Item</button></h3>
      {!filters.length && <p className="help">No filter: every item moves. Add items to only move those. Min keeps that many in the source, Max stops filling the destination at that many.</p>}
      <div className="list">
        {filters.map((f, i) => (
          <div className="li" key={i}>
            <ItemIcon s={f.s} size={30} />
            <div className="grow">
              <div className="name">{itemName(f.s)}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input className="input" type="number" min={0} placeholder="Min" value={f.min ?? ''} onChange={(e) => { f.min = e.target.value ? Number(e.target.value) : undefined; poke(); }} aria-label="Minimum in source" />
                <input className="input" type="number" min={0} placeholder="Max" value={f.max ?? ''} onChange={(e) => { f.max = e.target.value ? Number(e.target.value) : undefined; poke(); }} aria-label="Maximum in destination" />
              </div>
            </div>
            <button className="btn icon ghost" aria-label="Remove filter" onClick={() => { filters.splice(i, 1); poke(); }}><Ic.x /></button>
          </div>
        ))}
      </div>
      {open && <ItemPicker title="Filter item" withAmount={false} onClose={() => setOpen(false)} onPick={(s) => { filters.push({ s }); setOpen(false); poke(); }} />}
    </div>
  );
}

function CrafterPanel({ n }: { n: WNode }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const [slot, setSlot] = useState<number | null>(null);
  const templates: (string | null)[] = (n.st.templates ??= [null, null, null, null, null, null]);
  const tier = n.st.tier ?? 0;
  return (
    <>
      <div className="section">
        <h3>Blueprint templates</h3>
        <div className="list">
          {templates.map((t, i) => {
            const rec = t ? ITEMS[t]?.c : null;
            return (
              <div className="li" key={i}>
                {t ? <ItemIcon s={t} size={30} /> : <span style={{ width: 30 }} />}
                <div className="grow">
                  <div className="name">{t ? itemName(t) : 'Empty template'}</div>
                  {rec && (
                    <small>
                      {rec.i.map(([s, q]) => `${q} ${itemName(s)}`).join(', ')}, {rec.t}s
                      {rec.wb > tier ? `, needs workbench ${rec.wb}` : ''}
                    </small>
                  )}
                </div>
                <button className="btn" onClick={() => setSlot(i)}>{t ? 'Change' : 'Set'}</button>
                {t && <button className="btn icon ghost" aria-label="Clear template" onClick={() => { templates[i] = null; poke(); }}><Ic.x /></button>}
              </div>
            );
          })}
        </div>
        {n.st.cur && (
          <>
            <p className="help">Crafting {itemName(n.st.cur)}</p>
            <div className="meter olive"><i style={{ width: `${Math.min(100, ((n.st.prog ?? 0) / Math.max(1, ITEMS[n.st.cur]?.c?.t ?? 1)) * 100)}%` }} /></div>
          </>
        )}
      </div>
      <div className="section">
        <h3>Ingredients in<span className="spacer" /><AddItemButton n={n} /></h3>
        <InventoryGrid nodeId={n.id} from={0} to={12} />
        <div className="inv-label">Output</div>
        <InventoryGrid nodeId={n.id} from={12} to={18} zone />
      </div>
      {slot != null && (
        <ItemPicker
          title="Pick a blueprint"
          withAmount={false}
          filter={(s) => !!ITEMS[s].c}
          onClose={() => setSlot(null)}
          onPick={(s) => { templates[slot] = s; setSlot(null); poke(); }}
        />
      )}
    </>
  );
}

function GeneEditor({ genes, onChange }: { genes: string; onChange: (g: string) => void }) {
  const cycle = 'GYHWX';
  return (
    <span className="genes">
      {[...genes].map((g, i) => (
        <button
          key={i}
          className={`gene ${g}`}
          title={GENE_INFO[g]}
          onClick={() => onChange(genes.slice(0, i) + cycle[(cycle.indexOf(g) + 1) % 5] + genes.slice(i + 1))}
        >
          {g}
        </button>
      ))}
    </span>
  );
}

function PlanterPanel({ n }: { n: WNode }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const [type, setType] = useState('hemp');
  const [genes, setGenes] = useState('GGGYYY');
  const plants: (Plant | null)[] = n.st.plants ?? [];
  const playerId = useStore((s) => s.lootPlayer) ?? Object.values(world.current.nodes).find((x) => x.def === 'player')?.id;
  const target = playerId ? world.current.nodes[playerId] : n;
  const to = target ?? n;

  const plant = (i: number) => { plants[i] = { type, genes, age: 0, health: 1 }; poke(); };
  const harvest = (i: number) => {
    const p = plants[i]!;
    const t = PLANT[p.type];
    addItem(to.inv, t.product, harvestYield(p));
    addItem(to.inv, t.seed, p.type === 'hemp' ? 2 : 1);
    plants[i] = null;
    poke();
  };
  const clone = (i: number) => {
    const p = plants[i]!;
    addItem(to.inv, PLANT[p.type].clone, 1, p.genes);
    poke();
  };
  return (
    <>
      <div className="section">
        <h3>Plants</h3>
        <div className="list">
          {plants.map((p, i) => {
            if (!p)
              return (
                <div className="li" key={i}>
                  <div className="grow muted">Empty slot {i + 1}</div>
                  <button className="btn" onClick={() => plant(i)}>Plant {PLANT[type].name}</button>
                </div>
              );
            const st = stageOf(p.age);
            return (
              <div className="li plant-row" key={i}>
                <ItemIcon s={PLANT[p.type].clone} size={30} />
                <div className="grow">
                  <div className="name">{PLANT[p.type].name} <span className="muted">{st.name}</span></div>
                  <GeneEditor genes={p.genes} onChange={(g) => { p.genes = g; poke(); }} />
                  <div className="meter" style={{ marginTop: 4 }}><i style={{ width: `${p.health * 100}%`, background: p.health > 0.5 ? 'var(--ok)' : 'var(--alarm)' }} /></div>
                </div>
                <div className="btnrow">
                  {st.i >= 4 && st.i <= 6 && <button className="btn" onClick={() => clone(i)}>Clone</button>}
                  {st.name === 'Ripe' && <button className="btn primary" onClick={() => harvest(i)}>Harvest</button>}
                  {st.i < 6 && <button className="btn" title="Skip to next stage" onClick={() => { p.age = stageStart(st.i + 1); poke(); }}>Grow</button>}
                  <button className="btn icon ghost" aria-label="Remove plant" onClick={() => { plants[i] = null; poke(); }}><Ic.x /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="section">
        <h3>New plant</h3>
        <div className="field">
          <label htmlFor="ptype">Seed / clone</label>
          <select id="ptype" className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {PLANT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Genes (tap to change)</label>
          <div className="row"><GeneEditor genes={genes} onChange={setGenes} /><button className="btn ghost" onClick={() => setGenes(randomGenes())}>Random seed</button></div>
        </div>
        <label className="check">
          <input type="checkbox" checked={!!n.st.auto} onChange={(e) => { n.st.auto = e.target.checked; poke(); }} />
          Auto-harvest into planter storage<span className="sim-tag">sim</span>
        </label>
        <p className="help">Neighbouring plants crossbreed when they leave the Crossbreed stage. G, Y and H are good genes; W and X are bad. Harvests and clones go to {to.def === 'player' ? to.params.name : 'the planter'}.</p>
      </div>
    </>
  );
}

function WorkbenchPanel({ n }: { n: WNode }) {
  useTick();
  const nodes = useStore((s) => s.nodes);
  const poke = useStore((s) => s.poke);
  const tier = WB_TIER[n.def];
  const [q, setQ] = useState('');
  const [amount, setAmount] = useState(1);
  const g = graphOf(nodes, []);
  const near = Object.values(world.current.nodes).filter((p) => p.def === 'player' && rectDist(g.rects[n.id], g.rects[p.id]) <= 3);
  const [pid, setPid] = useState<string | null>(null);
  const player = near.find((p) => p.id === pid) ?? near[0];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return Object.keys(ITEMS).filter((k) => ITEMS[k].c && ITEMS[k].c!.wb <= tier && (!t || ITEMS[k].n.toLowerCase().includes(t))).sort((a, b) => ITEMS[a].n.localeCompare(ITEMS[b].n)).slice(0, 80);
  }, [q, tier]);

  const craft = (s: string) => {
    if (!player) return;
    const rec = ITEMS[s].c!;
    const times = Math.ceil(amount / rec.y);
    for (const [ing, a] of rec.i) if (countItem(player.inv, ing) < a * times) return;
    for (const [ing, a] of rec.i) takeItem(player.inv, ing, a * times);
    const queue = (player.st.queue ??= []);
    queue.push({ s, n: times * rec.y, t: rec.t, left: rec.t, per: rec.y });
    poke();
  };

  return (
    <div className="section">
      <h3>Craft at this bench</h3>
      {!near.length && <p className="help">Drag a player within 3 m of the bench to craft from their inventory.</p>}
      {near.length > 1 && (
        <div className="field">
          <label>Crafting player</label>
          <select className="select" value={player?.id} onChange={(e) => setPid(e.target.value)}>
            {near.map((p) => <option key={p.id} value={p.id}>{p.params.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input className="search" placeholder={`Search level ${tier} recipes`} value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input" style={{ width: 70 }} type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} aria-label="Amount to craft" />
      </div>
      <div className="list">
        {list.map((s) => {
          const rec = ITEMS[s].c!;
          const times = Math.ceil(amount / rec.y);
          const ok = !!player && rec.i.every(([ing, a]) => countItem(player.inv, ing) >= a * times);
          return (
            <div className="li" key={s}>
              <ItemIcon s={s} size={30} />
              <div className="grow">
                <div className="name">{itemName(s)}{rec.wb ? `, WB${rec.wb}` : ''}</div>
                <small>{rec.i.map(([ing, a]) => `${a * times} ${itemName(ing)}`).join(', ')}, {fmtTime(rec.t * times)}</small>
              </div>
              <button className="btn" disabled={!ok} onClick={() => craft(s)}>Craft</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayerPanel({ n }: { n: WNode }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const queue: { s: string; n: number; left: number; t: number }[] = n.st.queue ?? [];
  return (
    <>
      <div className="section">
        <h3>Inventory<span className="spacer" /><AddItemButton n={n} label="Give item" /></h3>
        <InventoryGrid nodeId={n.id} from={0} to={24} />
        <div className="inv-label">Belt</div>
        <InventoryGrid nodeId={n.id} from={24} to={30} zone />
        <HandBar />
      </div>
      {queue.length > 0 && (
        <div className="section">
          <h3>Crafting queue<span className="spacer" /><button className="btn ghost" onClick={() => { n.st.queue = []; poke(); }}>Clear</button></h3>
          <div className="list">
            {queue.map((c, i) => (
              <div className="li" key={i}>
                <ItemIcon s={c.s} size={28} />
                <div className="grow"><div className="name">{itemName(c.s)} ×{c.n}</div><small>{i === 0 ? `${fmtTime(c.left)} for next` : 'Waiting'}</small></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function LootPanel({ n }: { n: WNode }) {
  useTick();
  const players = Object.values(world.current.nodes).filter((p) => p.def === 'player');
  const loot = useStore((s) => s.lootPlayer);
  const setLoot = useStore((s) => s.setLootPlayer);
  const pl = players.find((p) => p.id === loot) ?? players[0];
  const def = DEF[n.def];
  if (!def.slots || n.def === 'player' || n.def === 'crafter') return null;
  const split = n.def === 'recycler' ? 6 : null;
  return (
    <div className="section">
      <h3>Contents<span className="spacer" /><AddItemButton n={n} /></h3>
      {split ? (
        <>
          <div className="inv-label">Input</div>
          <InventoryGrid nodeId={n.id} from={0} to={6} other={pl?.id} />
          <div className="inv-label">Output</div>
          <InventoryGrid nodeId={n.id} from={6} to={12} zone other={pl?.id} />
        </>
      ) : (
        <InventoryGrid nodeId={n.id} other={pl?.id} />
      )}
      {n.def === 'voidbox' && (
        <dl className="stats" style={{ marginTop: 8 }}>
          {Object.entries<number>(n.st.voided ?? {}).map(([s, c]) => <FragmentRow key={s} a={itemName(s)} b={c.toLocaleString()} />)}
        </dl>
      )}
      {pl && (
        <>
          <div className="inv-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
            {players.length > 1 ? (
              <select className="select" style={{ height: 28 }} value={pl.id} onChange={(e) => setLoot(e.target.value)} aria-label="Player inventory">
                {players.map((p) => <option key={p.id} value={p.id}>{p.params.name}’s inventory</option>)}
              </select>
            ) : <span>{pl.params.name}’s inventory</span>}
          </div>
          <InventoryGrid nodeId={pl.id} from={0} to={30} other={n.id} />
        </>
      )}
      <HandBar />
    </div>
  );
}

function EdgePanel({ id }: { id: string }) {
  const edge = useStore((s) => s.edges.find((e) => e.id === id));
  const setEdge = useStore((s) => s.setEdge);
  const setWireColor = useStore((s) => s.setWireColor);
  const removeSelected = useStore((s) => s.removeSelected);
  const checkpoint = useStore((s) => s.checkpoint);
  useTick();
  if (!edge?.data) return null;
  const kind = edge.data.kind;
  const name = kind === 'power' ? 'Wire' : kind === 'fluid' ? 'Hose' : 'Industrial pipe';
  const flow = world.current.flow[id] ?? 0;
  const tool = kind === 'power' ? 'wiretool' : kind === 'fluid' ? 'hosetool' : 'pipetool';
  return (
    <>
      <div className="insp-head">
        <div className="dep-icon"><ItemIcon s={tool} size={48} /></div>
        <div>
          <h2>{name}</h2>
          <p>
            {kind === 'power' && (flow > 0 ? `Carrying ${flow} rW` : 'Not powered')}
            {kind === 'fluid' && (flow > 0 ? `Flowing ${Math.round(flow * 10) / 10} mL/s` : 'No water flowing')}
            {kind === 'item' && 'Moves items between industrial parts'}
          </p>
        </div>
      </div>
      <div className="section">
        <h3>Colour</h3>
        <div className="colors">
          {WIRE_COLORS.map((c) => (
            <button
              key={c.id}
              className="swatch"
              style={{ background: c.hex }}
              aria-label={c.label}
              title={c.label}
              aria-pressed={edge.data!.color === c.id}
              onClick={() => { checkpoint(); setEdge(id, { color: c.id }); setWireColor(c.id); }}
            />
          ))}
        </div>
      </div>
      <div className="section">
        <h3>Shape</h3>
        <p className="help">Double-click the {name.toLowerCase()} to add a bend. Drag bends to route it; double-click a bend to remove it.</p>
        <div className="btnrow" style={{ marginTop: 8 }}>
          <button className="btn" disabled={!edge.data.points.length} onClick={() => { checkpoint(); setEdge(id, { points: [] }); }}>Remove bends</button>
          <button className="btn danger" onClick={removeSelected}><Ic.trash />Remove {name.toLowerCase()}</button>
        </div>
      </div>
    </>
  );
}

function NodePanel({ id }: { id: string }) {
  useTick();
  const removeSelected = useStore((s) => s.removeSelected);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const poke = useStore((s) => s.poke);
  const n = world.current.nodes[id];
  if (!n) return null;
  const def = DEF[n.def];
  const params = (def.params ?? []).filter((p) => p.key !== 'plants' && !(BATTERY[n.def] && p.key === 'charge'));
  const rec = ITEMS[def.icon]?.c;
  return (
    <>
      <div className="insp-head">
        <div className="dep-icon"><ItemIcon s={def.icon} size={48} /></div>
        <div>
          <h2>{n.def === 'player' ? n.params.name : def.name}</h2>
          <p>{def.info}</p>
        </div>
      </div>
      <Stats n={n} />
      {params.length > 0 && (
        <div className="section">
          <h3>Settings</h3>
          {params.map((p) => <ParamField key={p.key} n={n} p={p} />)}
        </div>
      )}
      {BATTERY[n.def] && (
        <div className="section">
          <h3>Charge</h3>
          <div className="btnrow">
            <button className="btn" onClick={() => { n.st.charge = BATTERY[n.def].cap; poke(); }}>Fill</button>
            <button className="btn" onClick={() => { n.st.charge = BATTERY[n.def].cap / 2; poke(); }}>Half</button>
            <button className="btn" onClick={() => { n.st.charge = 0; n.st.discharging = false; poke(); }}>Empty</button>
          </div>
        </div>
      )}
      {n.def === 'counter' && (
        <div className="section"><button className="btn" onClick={() => { n.st.count = 0; poke(); }}>Reset count</button></div>
      )}
      {n.def === 'memorycell' && (
        <div className="section"><button className="btn" onClick={() => { n.st.bit = !n.st.bit; poke(); }}>Flip stored bit</button></div>
      )}
      {n.def === 'godbox' && <GodBox n={n} />}
      {n.def === 'conveyor' && <ConveyorFilters n={n} />}
      {n.def === 'crafter' && <CrafterPanel n={n} />}
      {n.def.startsWith('planter') && <PlanterPanel n={n} />}
      {WB_TIER[n.def] && <WorkbenchPanel n={n} />}
      {n.def === 'player' && <PlayerPanel n={n} />}
      <LootPanel n={n} />
      {def.tips && (
        <div className="section"><h3>Notes</h3><ul className="tips">{def.tips.map((t) => <li key={t}>{t}</li>)}</ul></div>
      )}
      {rec && (
        <div className="section">
          <h3>Crafting cost</h3>
          <div className="chips">
            {rec.i.map(([s, a]) => <span className="chip" key={s}>{a} {itemName(s)}</span>)}
            <span className="chip">{rec.wb ? `Workbench ${rec.wb}` : 'No workbench'}</span>
          </div>
          <p className="help">Raw: {rawCost(def.icon, 1).totals.map(([s, a]) => `${a} ${itemName(s)}`).join(', ')}</p>
        </div>
      )}
      <div className="section">
        <div className="btnrow">
          <button className="btn" onClick={duplicateSelected}><Ic.copy />Duplicate</button>
          <button className="btn danger" onClick={removeSelected}><Ic.trash />Remove</button>
        </div>
      </div>
    </>
  );
}

export default function Inspector() {
  const selNodes = useStore((s) => s.nodes.filter((n) => n.selected).map((n) => n.id).join(','));
  const selEdges = useStore((s) => s.edges.filter((e) => e.selected).map((e) => e.id).join(','));
  const ids = selNodes ? selNodes.split(',') : [];
  const eids = selEdges ? selEdges.split(',') : [];
  return (
    <div className="panel-scroll" style={{ padding: 0 }}>
      {ids.length === 1 ? (
        <NodePanel id={ids[0]} key={ids[0]} />
      ) : ids.length > 1 ? (
        <MultiPanel ids={ids} />
      ) : eids.length === 1 ? (
        <EdgePanel id={eids[0]} />
      ) : (
        <SimPanel />
      )}
    </div>
  );
}

function MultiPanel({ ids }: { ids: string[] }) {
  const removeSelected = useStore((s) => s.removeSelected);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  useTick();
  let draw = 0, gen = 0;
  for (const id of ids) {
    const n = world.current.nodes[id];
    if (!n) continue;
    if (n.on && DEF[n.def].draw) draw += DEF[n.def].draw!;
    if (DEF[n.def].cat === 'power') gen += Object.values(n.pout).reduce((a, b) => a + b, 0);
  }
  const cost = new Map<string, number>();
  for (const id of ids) {
    const n = world.current.nodes[id];
    const c = n && ITEMS[DEF[n.def].icon]?.c;
    if (c) for (const [s, a] of c.i) cost.set(s, (cost.get(s) ?? 0) + a);
  }
  return (
    <>
      <div className="insp-head"><div><h2>{ids.length} selected</h2><p>Drag to move them together.</p></div></div>
      <div className="section">
        <dl className="stats">
          <FragmentRow a="Power produced" b={`${gen} rW`} />
          <FragmentRow a="Power used by active parts" b={`${draw} rW`} />
        </dl>
      </div>
      {cost.size > 0 && (
        <div className="section">
          <h3>Total crafting cost</h3>
          <div className="chips">{[...cost.entries()].map(([s, a]) => <span className="chip" key={s}>{a.toLocaleString()} {itemName(s)}</span>)}</div>
        </div>
      )}
      <div className="section">
        <div className="btnrow">
          <button className="btn" onClick={duplicateSelected}><Ic.copy />Duplicate</button>
          <button className="btn danger" onClick={removeSelected}><Ic.trash />Remove</button>
        </div>
      </div>
    </>
  );
}

export { stackSize };
