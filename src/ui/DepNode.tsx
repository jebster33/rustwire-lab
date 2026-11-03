import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { DEF, BATTERY, WATER_CAP, EXPLOSIVES, portsOf, type PortDef } from '../sim/defs';
import { armExplosive } from '../sim/engine';
import { world, type WNode } from '../sim/world';
import { useStore, useTick, type DepNode as DepNodeT } from '../store';
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

function PortRow({ n, p }: { n: WNode; p: PortDef }) {
  const v = p.kind === 'power' ? (p.dir === 'in' ? n.pin[p.key] : n.pout[p.key]) ?? 0 : 0;
  const live = p.kind === 'power' && v > 0;
  return (
    <div className={`port ${p.dir} k-${p.kind}`}>
      <Handle
        id={`${p.dir === 'in' ? 'i' : 'o'}:${p.key}`}
        type={p.dir === 'in' ? 'target' : 'source'}
        position={p.dir === 'in' ? Position.Left : Position.Right}
        className={`h k-${p.kind} ${live ? 'live' : ''}`}
        title={p.label}
      />
      {p.dir === 'out' && p.kind === 'power' && <span className="pv">{v > 0 ? v : ''}</span>}
      <span>{p.label}</span>
      {p.dir === 'in' && p.kind === 'power' && <span className="pv">{v > 0 ? v : ''}</span>}
    </div>
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
    if (n.def === 'crafter') extra.push(S.tier ? `Workbench ${S.tier}` : 'No workbench nearby');
    if (n.def === 'crafter' && S.cur) extra.push(`Crafting ${itemName(S.cur)}`);
    if (n.def === 'voidbox') {
      const total = Object.values<number>(S.voided ?? {}).reduce((a, b) => a + b, 0);
      extra.push(`${total.toLocaleString()} voided`);
    }
    if (n.def === 'turret' || n.def === 'sam') extra.push(S.target && n.on ? 'Target!' : n.on ? 'Scanning' : 'Off');
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
    case 'seismic': return (S.t ?? 0) > 0 ? <b>Vibration!</b> : <>Still</>;
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

function DepNodeView({ id, data }: NodeProps<DepNodeT>) {
  useTick();
  const n = world.current.nodes[id];
  const setParam = useStore((s) => s.setParam);
  const poke = useStore((s) => s.poke);
  if (!n) return null;
  const def = DEF[data.def];
  const ports = portsOf(def, n.params);
  const ins = ports.filter((p) => p.dir === 'in');
  const outs = ports.filter((p) => p.dir === 'out');
  const r = readout(n);

  const press = () => {
    if (def.press === 'toggle') setParam(id, 'on', !n.params.on);
    if (n.def === 'explosive') { armExplosive(n); poke(); return; }
    if (def.press === 'press') { n.st.t = Number(n.params.duration) || 5; poke(); }
  };
  const hold = (v: boolean) => { n.st.held = v; poke(); };

  return (
    <div className={`dep c-${def.cat} ${n.on ? 'is-on' : ''}`}>
      <div className="dep-head">
        <div className="dep-icon">
          <ItemIcon s={n.def === 'explosive' ? String(n.params.type) : def.icon} size={40} key={n.def === 'explosive' ? String(n.params.type) : def.icon} />
          {(def.draw != null || def.cat === 'power') && <span className="lamp" />}
        </div>
        <div>
          <div className="dep-name">{def.name}</div>
          {r && <div className="dep-read">{r}</div>}
        </div>
      </div>
      <Body n={n} />
      {def.press && (
        <button
          className="dep-press nodrag"
          aria-pressed={def.press === 'toggle' ? !!n.params.on : !!(n.st.t > 0 || n.st.held || n.st.fuse != null)}
          onClick={def.press !== 'hold' ? press : undefined}
          onPointerDown={def.press === 'hold' ? () => hold(true) : undefined}
          onPointerUp={def.press === 'hold' ? () => hold(false) : undefined}
          onPointerLeave={def.press === 'hold' ? () => n.st.held && hold(false) : undefined}
        >
          {n.def === 'explosive'
            ? n.st.fuse != null ? 'Fuse lit' : EXPLOSIVES[String(n.params.type)]?.fuse ? 'Light fuse' : 'Fire'
            : def.press === 'toggle' ? (n.params.on ? 'Turn off' : 'Turn on') : def.press === 'press' ? 'Press' : 'Hold to transmit'}
        </button>
      )}
      {ports.length > 0 && (
        <div className="dep-ports">
          <div className="ports-col">{ins.map((p) => <PortRow key={p.key} n={n} p={p} />)}</div>
          <div className="ports-col">{outs.map((p) => <PortRow key={p.key} n={n} p={p} />)}</div>
        </div>
      )}
    </div>
  );
}

export default memo(DepNodeView);

function PlayerNodeView({ id }: NodeProps<DepNodeT>) {
  useTick();
  const n = world.current.nodes[id];
  if (!n) return null;
  return (
    <div className={`player-token ${n.params.authed ? '' : 'hostile'}`} title={n.params.authed ? 'Authorized' : 'Not authorized'}>
      <div className="player-disc"><ItemIcon s="hazmatsuit" size={34} /></div>
      <div className="player-name">{n.params.name || 'Player'}</div>
    </div>
  );
}
export const PlayerNode = memo(PlayerNodeView);
