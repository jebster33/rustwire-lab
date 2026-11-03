import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { DEF, BATTERY, WATER_CAP, EXPLOSIVES, portsOf, type PortDef, type Side } from '../sim/defs';
import { portClick, startPickUp, swallow } from './drawTool';
import { armExplosive } from '../sim/engine';
import { world, type WNode } from '../sim/world';
import { useStore, useTick, CARD_W, type DepNode as DepNodeT } from '../store';
import { ItemIcon } from './icons';
import { stageOf, PLANT } from '../sim/plants';
import { itemName } from '../data/items';

const fmt = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toString());
export const fmtTime = (sec: number) => {
  if (!isFinite(sec)) return '∞';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
};

function portValue(n: WNode, p: PortDef) {
  return p.kind === 'power' ? (p.dir === 'in' ? n.pin[p.key] : n.pout[p.key]) ?? 0 : 0;
}
const POS: Record<Side, Position> = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };

function PortHandle({ n, p }: { n: WNode; p: PortDef }) {
  const v = portValue(n, p);
  const live = p.kind === 'power' && v > 0;
  const hid = `${p.dir === 'in' ? 'i' : 'o'}:${p.key}`;
  return (
    <Handle
      id={hid}
      type={p.dir === 'in' ? 'target' : 'source'}
      position={POS[p.side ?? 'left']}
      className={`h k-${p.kind} ${live ? 'live' : ''}`}
      title={`${p.label}${p.kind === 'power' ? `: ${v} rW` : ''}`}
      onClick={(e) => { if (portClick(n.id, hid)) e.stopPropagation(); }}
      onPointerDownCapture={(e) => { if (e.button === 0) startPickUp(n.id, hid, e); }}
      onMouseDownCapture={(e) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); } }}
      onTouchStartCapture={(e) => { if (swallow.current) e.stopPropagation(); }}
    />
  );
}

function PortRow({ n, p }: { n: WNode; p: PortDef }) {
  const v = portValue(n, p);
  return (
    <div className={`port ${p.dir} k-${p.kind}`}>
      <PortHandle n={n} p={p} />
      {p.dir === 'out' && p.kind === 'power' && <span className="pv">{v > 0 ? v : ''}</span>}
      <span className="pl">{p.label}</span>
      {p.dir === 'in' && p.kind === 'power' && <span className="pv">{v > 0 ? v : ''}</span>}
    </div>
  );
}

/** Ports along the top or bottom edge, placed on the 1 m grid. */
function EdgePorts({ n, ports, side }: { n: WNode; ports: PortDef[]; side: 'top' | 'bottom' }) {
  if (!ports.length) return null;
  const spacing = ports.length <= 2 ? 96 : 72;
  const start = Math.round((CARD_W - spacing * (ports.length - 1)) / 2 / 24) * 24;
  return (
    <div className={`edge-ports ${side}`}>
      {ports.map((p, i) => {
        const v = portValue(n, p);
        return (
          <div key={p.key} className={`eport k-${p.kind}`} style={{ left: start + spacing * i }}>
            <PortHandle n={n} p={p} />
            <span className="pl">{p.label}{p.kind === 'power' && v > 0 ? <b className="pv"> {v}</b> : null}</span>
          </div>
        );
      })}
    </div>
  );
}

function NameLabel({ n, def, selected }: { n: WNode; def: { name: string }; selected: boolean }) {
  const [edit, setEdit] = useState(false);
  const setParam = useStore((s) => s.setParam);
  const label = String(n.params._label ?? '');
  if (edit)
    return (
      <input
        className="name-edit nodrag"
        autoFocus
        defaultValue={label}
        placeholder={def.name}
        maxLength={48}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEdit(false); e.stopPropagation(); }}
        onBlur={(e) => { setParam(n.id, '_label', e.target.value.trim()); setEdit(false); }}
      />
    );
  return (
    <button className="dep-name" title={label ? `${label} (${def.name}). Click again to rename` : 'Click again to name this part'} onClick={() => { if (selected) setEdit(true); }}>
      {label || def.name}
    </button>
  );
}

function Body({ n }: { n: WNode }) {
  const S = n.st;
  const def = DEF[n.def];
  if (BATTERY[n.def]) {
    const b = BATTERY[n.def];
    const pct = ((S.charge ?? 0) / b.cap) * 100;
    const load = S.load ?? 0;
    const rate = (S.chargeRate ?? 0) - load;
    return (
      <div className="dep-body">
        <div className="meter"><i style={{ width: `${pct}%` }} /></div>
        <div className="dep-read">
          <b>{fmt(S.charge ?? 0)}</b> / {b.cap.toLocaleString()} rWm
          {rate < 0 && load > 0 ? `, ${fmtTime(((S.charge ?? 0) * 60) / load)} left` : ''}
          {rate > 0 ? `, full in ${fmtTime(((b.cap - (S.charge ?? 0)) * 60) / rate)}` : ''}
        </div>
      </div>
    );
  }
  if (n.def === 'counter') {
    const v = n.params.display ? n.pout.out ?? 0 : S.count ?? 0;
    return <div className="dep-body"><div className="digits">{String(v).padStart(3, '0')}</div></div>;
  }
  if (WATER_CAP[n.def] && n.def !== 'purifier') {
    const cap = WATER_CAP[n.def];
    return (
      <div className="dep-body">
        <div className="meter water"><i style={{ width: `${((S.water ?? 0) / cap) * 100}%` }} /></div>
        <div className="dep-read"><b>{fmt(S.water ?? 0)}</b> / {cap.toLocaleString()} mL {S.salt ? '(salt)' : ''}</div>
      </div>
    );
  }
  if (n.def.startsWith('planter')) {
    const plants = S.plants ?? [];
    return (
      <div className="dep-body">
        <div className="plantgrid">
          {plants.map((p: any, i: number) => {
            if (!p) return <div key={i} className="plantcell" />;
            const st = stageOf(p.age);
            return (
              <div key={i} className="plantcell" title={`${PLANT[p.type].name}, ${st.name}, ${p.genes}`}>
                <i style={{ width: `${Math.min(100, (st.i / 6) * 100 + st.progress * 16)}%` }} />
                <span>{st.name}</span>
              </div>
            );
          })}
        </div>
        <div className="chips">
          <span className={`chip ${S.water > 0 ? 'water' : 'bad'}`}>{S.water > 0 ? `${Math.round(S.water)} mL` : 'Dry'}</span>
          <span className={`chip ${S.light ? 'on' : 'bad'}`}>{S.light ? 'Lit' : 'Dark'}</span>
        </div>
      </div>
    );
  }
  if (def.slots && n.def !== 'player') {
    const items = n.inv.filter(Boolean).slice(0, 6);
    const extra: string[] = [];
    if (S.burning) extra.push('Burning');
    if (n.def === 'crafter' && S.cur) extra.push(`Crafting ${itemName(S.cur)}`);
    if (n.def === 'voidbox') {
      const total = Object.values<number>(S.voided ?? {}).reduce((a, b) => a + b, 0);
      extra.push(`${total.toLocaleString()} voided`);
    }
    if (n.def === 'sam') extra.push(S.target && n.on ? 'Target!' : n.on ? 'Scanning' : 'Off');
    if (n.def === 'recycler' && n.params.on) extra.push('Recycling');
    return (
      <div className="dep-body">
        {extra.length > 0 && <div className="chips">{extra.map((e) => <span key={e} className={`chip ${e === 'Target!' ? 'bad' : 'on'}`}>{e}</span>)}</div>}
        {items.length > 0 && (
          <div className="minislots">
            {items.map((s, i) => (
              <div className="minislot" key={i}><ItemIcon s={s!.s} size={26} /><small>{s!.n > 999 ? `${Math.floor(s!.n / 1000)}k` : s!.n}</small></div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
}

function readout(n: WNode): React.ReactNode {
  const d = DEF[n.def];
  const S = n.st;
  switch (n.def) {
    case 'solar': case 'wind': case 'testgen': case 'fuelgen': case 'rootcombiner': {
      const out = Object.values(n.pout).reduce((a, b) => a + b, 0);
      return <>Output <b>{out}</b> rW, load <b>{S.load ?? 0}</b></>;
    }
    case 'battery_s': case 'battery_m': case 'battery_l':
      return <>In <b>{n.pin.in ?? 0}</b>, out <b>{n.pout.out ?? 0}</b>, using <b>{S.load ?? 0}</b></>;
    case 'timer': case 'button':
      return (S.t ?? 0) > 0 ? <>Running, <b>{fmtTime(S.t)}</b></> : <>Idle</>;
    case 'hbhf': return <>Detecting <b>{S.detected ?? 0}</b></>;
    case 'laser': case 'pressurepad': return S.hit ? <b>Tripped</b> : <>Clear</>;
    case 'rfbroadcaster': case 'rfreceiver': case 'rftransmitter': case 'rfpager': return <>Freq <b>{n.params.freq}</b></>;
    case 'memorycell': return <>Stored <b>{S.bit ? '1' : '0'}</b></>;
    case 'rand': return <>State <b>{(S.bit ?? true) ? 'Pass' : 'Block'}</b></>;
    case 'branch': return <>Branch <b>{n.params.amount}</b> rW</>;
    case 'clock': return <>Alarm <b>{String(Math.floor(n.params.alarm)).padStart(2, '0')}:{String(Math.round((n.params.alarm % 1) * 60)).padStart(2, '0')}</b></>;
    case 'sprinkler': return S.wet > 0 ? <b>Spraying</b> : <>Dry</>;
    case 'purifier': return <>Salt in <b>{fmt(S.raw ?? 0)}</b>, fresh <b>{fmt(S.water ?? 0)}</b> mL</>;
    case 'waterpump': return n.on ? <b>Pumping</b> : <>Needs 5 rW</>;
    case 'conveyor': return n.on ? (S.moved ? <b>Moving items</b> : <>Running</>) : <>Off</>;
    case 'player': return null;
    case 'seismic': return (S.t ?? 0) > 0 ? <b>Vibration, level {S.level ?? 1}</b> : <>Still</>;
    case 'reactive': return S.down ? <b>Down</b> : <>Standing</>;
    case 'hopper': return n.on ? <b>Collecting</b> : <>Needs 1 rW</>;
    case 'turret': return !S.gun ? <>No gun loaded</> : n.on ? (S.target ? <b>Target!</b> : <>Scanning</>) : <>Needs 10 rW</>;
    case 'crafter': return !S.tier ? <>Not on a workbench</> : n.on ? <>Workbench {S.tier}</> : <>Off</>;
    case 'pile': return <>{n.inv.filter(Boolean).length} stacks</>;
    case 'explosive': {
      const e = EXPLOSIVES[String(n.params.type)];
      if (S.fuse != null) return <b>Fuse lit, {Math.ceil(S.fuse)}s</b>;
      return <>{e?.name ?? 'Explosive'}</>;
    }
    default:
      if (d.draw != null) return n.on ? <b>On</b> : <>Needs {d.draw} rW</>;
      return null;
  }
}

function DepNodeView({ id, data, selected }: NodeProps<DepNodeT>) {
  useTick();
  const n = world.current.nodes[id];
  const setParam = useStore((s) => s.setParam);
  const poke = useStore((s) => s.poke);
  if (!n) return null;
  const def = DEF[data.def];
  const ports = portsOf(def, n.params);
  const r = readout(n);

  const press = () => {
    if (def.press === 'toggle') setParam(id, 'on', !n.params.on);
    if (n.def === 'explosive') { armExplosive(n); poke(); return; }
    if (n.def === 'reactive') { n.st.down = true; n.st.t = 1; poke(); return; }
    if (def.press === 'press') { n.st.t = Number(n.params.duration) || 0.25; poke(); }
  };
  const hold = (v: boolean) => { n.st.held = v; poke(); };

  const left = ports.filter((p) => p.side === 'left');
  const right = ports.filter((p) => p.side === 'right');
  const top = ports.filter((p) => p.side === 'top');
  const bottom = ports.filter((p) => p.side === 'bottom');
  const rows = Math.max(left.length, right.length);
  const icon = n.def === 'explosive' ? String(n.params.type) : def.icon;

  return (
    <GridCard className={`dep c-${def.cat} ${n.on ? 'is-on' : ''} ${n.st.warn ? 'has-warn' : ''} ${top.length ? 'has-top' : ''} ${bottom.length ? 'has-bottom' : ''}`}>
      <span className="stripe" />
      <EdgePorts n={n} ports={top} side="top" />
      <div className="dep-head">
        <div className="dep-icon">
          <ItemIcon s={icon} size={40} key={icon} />
          {(def.draw != null || def.cat === 'power') && <span className="lamp" />}
        </div>
        <div className="dep-titles">
          <NameLabel n={n} def={def} selected={!!selected} />
          {r && <div className="dep-read">{r}</div>}
        </div>
      </div>
      {rows > 0 && (
        <div className="dep-ports" style={{ height: rows * 24 }}>
          <div className="ports-col">{left.map((p) => <PortRow key={p.key} n={n} p={p} />)}</div>
          <div className="ports-col">{right.map((p) => <PortRow key={p.key} n={n} p={p} />)}</div>
        </div>
      )}
      {n.st.warn && <div className="dep-warn" title={n.st.warn}>{n.st.warn}</div>}
      <Body n={n} />
      {def.press && (
        <button
          className="dep-press nodrag"
          aria-pressed={def.press === 'toggle' ? !!n.params.on : !!(n.st.t > 0 || n.st.held || n.st.fuse != null || (n.def === 'reactive' && n.st.down))}
          onClick={def.press !== 'hold' ? press : undefined}
          onPointerDown={def.press === 'hold' ? () => hold(true) : undefined}
          onPointerUp={def.press === 'hold' ? () => hold(false) : undefined}
          onPointerLeave={def.press === 'hold' ? () => n.st.held && hold(false) : undefined}
        >
          {n.def === 'explosive'
            ? n.st.fuse != null ? 'Fuse lit' : EXPLOSIVES[String(n.params.type)]?.fuse ? 'Light fuse' : 'Fire'
            : n.def === 'reactive' ? (n.st.down ? 'Knocked down' : 'Shoot target')
            : def.press === 'toggle' ? (n.params.on ? 'Turn off' : 'Turn on') : def.press === 'press' ? 'Press' : 'Hold to transmit'}
        </button>
      )}
      <EdgePorts n={n} ports={bottom} side="bottom" />
    </GridCard>
  );
}

/** Card whose height is rounded up to whole grid squares, so bottom ports land on the grid. */
function GridCard({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = el.style.minHeight;
    el.style.minHeight = '0px';
    const natural = el.offsetHeight;
    el.style.minHeight = prev;
    const want = Math.ceil(natural / 24) * 24;
    if (want !== minH) setMinH(want);
  });
  return (
    <div ref={ref} className={className} style={{ width: CARD_W, minHeight: minH || undefined }}>
      {children}
    </div>
  );
}

export default memo(DepNodeView);

function PlayerNodeView({ id }: NodeProps<DepNodeT>) {
  useTick();
  const n = world.current.nodes[id];
  if (!n) return null;
  return (
    <div className={`player-token ${n.params.authed ? '' : 'hostile'}`} title={n.params.authed ? 'Authorized' : n.params.hostile ? 'Hostile' : 'Not authorized'}>
      <div className="player-disc"><ItemIcon s="hazmatsuit" size={34} /></div>
      <div className="player-name">{n.params.name || 'Player'}</div>
    </div>
  );
}
export const PlayerNode = memo(PlayerNodeView);
