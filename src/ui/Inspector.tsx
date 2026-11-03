import { useState } from 'react';
import { useStore, useTick } from '../store';
import { DEF, BATTERY, WATER_CAP, WB_TIER, WIRE_COLORS, portsOf, type ParamDef } from '../sim/defs';
import { world, addItem, countItem, takeItem, notify, type WNode, type Plant } from '../sim/world';
import { type Filter } from '../sim/engine';
import { ITEMS, itemName, rawCost, stackSize } from '../data/items';
import { PLANT_TYPES, PLANT, stageOf, randomGenes, GENE_INFO, harvestYield, stageStart } from '../sim/plants';
import { ItemIcon, Ic } from './icons';
import { InventoryGrid, HandBar, ItemPicker, BlueprintPicker, filterFor, ME } from './Inventory';
import { WIRE_COLORS as NOTE_COLORS } from '../sim/defs';
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
  if (p.type === 'select')
    return (
      <div className="field">
        <label htmlFor={`${n.id}-${p.key}`}>{p.label}{tag}</label>
        <select id={`${n.id}-${p.key}`} className="select" value={String(v)} onChange={(e) => setParam(n.id, p.key, e.target.value)}>
          {(p.options ?? []).map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      </div>
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
          filter={filter ?? filterFor(n.id)}
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
        <BlueprintPicker
          title="Set blueprint template"
          maxTier={tier || 3}
          withAmount={false}
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
  const to = { inv: world.current.me, def: 'me', params: { name: 'My inventory' } } as unknown as WNode;

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
        <p className="help">Neighbouring plants crossbreed when they leave the Crossbreed stage. G, Y and H are good genes; W and X are bad. Harvests and clones go to My inventory.</p>
      </div>
    </>
  );
}

function CraftQueue() {
  useTick();
  const poke = useStore((s) => s.poke);
  const queue = world.current.queue;
  if (!queue.length) return null;
  return (
    <div className="section">
      <h3>Crafting queue<span className="spacer" /><button className="btn ghost" onClick={() => { world.current.queue = []; poke(); }}>Clear</button></h3>
      <div className="list">
        {queue.map((c, i) => (
          <div className="li" key={i}>
            <ItemIcon s={c.s} size={28} />
            <div className="grow"><div className="name">{itemName(c.s)} ×{c.n}</div><small>{i === 0 ? `${fmtTime(c.left)} until the next one` : 'Waiting'}</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttachButtons({ n }: { n: WNode }) {
  const nodes = useStore((s) => s.nodes);
  const attach = useStore((s) => s.attach);
  const kinds = Object.values(DEF).filter((d) => d.attach?.includes(n.def));
  if (!kinds.length) return null;
  return (
    <div className="section">
      <h3>Attachments</h3>
      <div className="btnrow">
        {kinds.map((d) => {
          const have = nodes.filter((x) => x.parentId === n.id && x.data.def === d.id).length;
          const max = d.maxPerHost ?? 1;
          return (
            <button key={d.id} className="btn" disabled={have >= max} onClick={() => attach(d.id, n.id)}>
              <ItemIcon s={d.icon} size={20} />Attach {d.name}{max > 1 ? ` (${have}/${max})` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkbenchPanel({ n }: { n: WNode }) {
  useTick();
  const poke = useStore((s) => s.poke);
  const tier = WB_TIER[n.def];
  const [open, setOpen] = useState(false);
  const me = world.current.me;

  const craft = (s: string, amount: number) => {
    const rec = ITEMS[s].c!;
    const times = Math.ceil(amount / rec.y);
    const missing = rec.i.filter(([ing, a]) => countItem(me, ing) < a * times);
    if (missing.length) {
      notify(world.current, `Missing ${missing.map(([ing, a]) => `${a * times - countItem(me, ing)} ${itemName(ing)}`).join(', ')} in My inventory`, 'warn');
      poke();
      return;
    }
    for (const [ing, a] of rec.i) takeItem(me, ing, a * times);
    world.current.queue.push({ s, n: times * rec.y, t: rec.t, left: rec.t, per: rec.y });
    setOpen(false);
    poke();
  };

  return (
    <div className="section">
      <h3>Craft at this bench</h3>
      <p className="help" style={{ marginTop: 0, marginBottom: 10 }}>Crafts from My inventory. Level {tier} bench: items up to workbench {tier}.</p>
      <button className="btn primary" onClick={() => setOpen(true)}><Ic.plus />Add blueprint</button>
      {open && <BlueprintPicker title={`Craft at workbench ${tier}`} maxTier={tier} have={me} onClose={() => setOpen(false)} onPick={craft} />}
    </div>
  );
}

function MyInventory({ other }: { other?: string }) {
  return (
    <>
      <div className="inv-label" style={{ marginTop: 12, display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>My inventory</span>
        <MyGive />
      </div>
      <InventoryGrid nodeId={ME} from={0} to={24} other={other} />
      <div className="inv-label">Belt</div>
      <InventoryGrid nodeId={ME} from={24} to={30} zone other={other} />
    </>
  );
}
function MyGive() {
  const [open, setOpen] = useState(false);
  const poke = useStore((s) => s.poke);
  return (
    <>
      <button className="btn ghost" style={{ height: 28 }} onClick={() => setOpen(true)}><Ic.plus />Give me items</button>
      {open && <ItemPicker title="Add to My inventory" onClose={() => setOpen(false)} onPick={(s, a) => { addItem(world.current.me, s, a); setOpen(false); poke(); }} />}
    </>
  );
}

function LootPanel({ n }: { n: WNode }) {
  useTick();
  const def = DEF[n.def];
  if (!def.slots || n.def === 'crafter') return null;
  return (
    <div className="section">
      <h3>Contents<span className="spacer" /><AddItemButton n={n} /></h3>
      {n.def === 'turret' && <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>Put a gun in and ammo it can fire.</p>}
      <InventoryGrid nodeId={n.id} other={ME} />
      {n.def === 'voidbox' && (
        <dl className="stats" style={{ marginTop: 8 }}>
          {Object.entries<number>(n.st.voided ?? {}).map(([s, c]) => <FragmentRow key={s} a={itemName(s)} b={c.toLocaleString()} />)}
        </dl>
      )}
      <MyInventory other={n.id} />
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
        <div className="seg" style={{ marginBottom: 10 }}>
          <button aria-pressed={edge.data.style !== 'straight'} onClick={() => { checkpoint(); setEdge(id, { style: 'curve' }); }}>Curved</button>
          <button aria-pressed={edge.data.style === 'straight'} onClick={() => { checkpoint(); setEdge(id, { style: 'straight' }); }}>Straight</button>
        </div>
        <p className="help">Double-click the {name.toLowerCase()} to add a bend. Drag bends to route it; double-click a bend to remove it. Drag either end off its port to move or unplug it.</p>
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
  const setParam = useStore((s) => s.setParam);
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
          <h2>{n.def === 'player' ? n.params.name : n.params._label || def.name}</h2>
          {n.params._label && n.def !== 'player' && <p style={{ marginTop: 2 }}>{def.name}</p>}
          <p>{def.info}</p>
        </div>
      </div>
      <Stats n={n} />
      <div className="section">
        <h3>Settings</h3>
        {n.def !== 'player' && (
          <div className="field">
            <label htmlFor={`${n.id}-label`}>Name on the board</label>
            <input id={`${n.id}-label`} className="input" placeholder={def.name} value={String(n.params._label ?? '')} maxLength={48} onChange={(e) => setParam(n.id, '_label', e.target.value)} />
          </div>
        )}
        {params.map((p) => <ParamField key={p.key} n={n} p={p} />)}
      </div>
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
      {WB_TIER[n.def] && <CraftQueue />}
      <AttachButtons n={n} />
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
  const noteSel = useStore((s) => s.nodes.find((n) => n.id === ids[0])?.type === 'note');
  const eids = selEdges ? selEdges.split(',') : [];
  return (
    <div className="panel-scroll" style={{ padding: 0 }}>
      {ids.length === 1 && noteSel ? (
        <NotePanel id={ids[0]} key={ids[0]} />
      ) : ids.length === 1 ? (
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

function NotePanel({ id }: { id: string }) {
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const setNote = useStore((s) => s.setNote);
  const removeSelected = useStore((s) => s.removeSelected);
  if (!node) return null;
  const d = node.data as { kind: 'box' | 'text'; text: string; color: string; size?: number };
  return (
    <>
      <div className="insp-head"><div><h2>{d.kind === 'box' ? 'Outline box' : 'Text label'}</h2><p>{d.kind === 'box' ? 'Drag the corners to resize. Click its title to rename it.' : 'Double-click the text on the board to edit it.'}</p></div></div>
      <div className="section">
        <div className="field">
          <label htmlFor="note-text">{d.kind === 'box' ? 'Title' : 'Text'}</label>
          <input id="note-text" className="input" value={d.text} onChange={(e) => setNote(id, { text: e.target.value })} />
        </div>
        {d.kind === 'text' && (
          <div className="field">
            <label htmlFor="note-size">Size</label>
            <input id="note-size" type="range" min={12} max={96} step={2} value={d.size ?? 24} onChange={(e) => setNote(id, { size: Number(e.target.value) })} />
          </div>
        )}
        <div className="field">
          <label>Colour</label>
          <div className="colors">
            {NOTE_COLORS.map((c) => <button key={c.id} className="swatch" style={{ background: c.hex }} aria-label={c.label} aria-pressed={d.color === c.hex} onClick={() => setNote(id, { color: c.hex })} />)}
          </div>
        </div>
      </div>
      <div className="section"><button className="btn danger" onClick={removeSelected}><Ic.trash />Remove</button></div>
    </>
  );
}
