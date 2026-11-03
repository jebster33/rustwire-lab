import { useStore, useTick } from '../store';
import { world } from '../sim/world';
import { DEF } from '../sim/defs';
import { sunFactor } from '../sim/engine';
import { WIRE_COLORS } from '../sim/defs';

export const fmtTod = (t: number) => `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`;

export default function SimPanel() {
  useTick();
  const poke = useStore((s) => s.poke);
  const nodes = useStore((s) => s.nodes);
  const wireColor = useStore((s) => s.wireColor);
  const setWireColor = useStore((s) => s.setWireColor);
  const setDialog = useStore((s) => s.setDialog);
  const w = world.current;
  let gen = 0, used = 0, stored = 0;
  for (const n of Object.values(w.nodes)) {
    const d = DEF[n.def];
    if (['solar', 'wind', 'fuelgen', 'testgen'].includes(n.def)) gen += Object.values(n.pout).reduce((a, b) => a + b, 0);
    if (n.on && d.draw && d.cat !== 'logic') used += d.draw;
    if (n.st.charge) stored += n.st.charge;
  }
  return (
    <>
      <div className="panel-head"><h2>World</h2></div>
      <div className="section">
        <div className="field">
          <label htmlFor="tod" className="lv"><span>Time of day</span><b>{fmtTod(w.tod)}</b><small>sun {Math.round(sunFactor(w.tod) * 100)}%</small></label>
          <input id="tod" type="range" min={0} max={23.99} step={0.05} value={w.tod} onChange={(e) => { w.tod = Number(e.target.value); poke(); }} />
        </div>
        <label className="check"><input type="checkbox" checked={w.lockTime} onChange={(e) => { w.lockTime = e.target.checked; poke(); }} />Freeze time of day</label>
        <div className="field">
          <label htmlFor="wind" className="lv"><span>Wind</span><b>{Math.round(w.wind * 100)}%</b></label>
          <input id="wind" type="range" min={0} max={1} step={0.01} value={w.wind} onChange={(e) => { w.wind = Number(e.target.value); poke(); }} />
        </div>
        <label className="check"><input type="checkbox" checked={w.rain} onChange={(e) => { w.rain = e.target.checked; poke(); }} />Raining (water catchers fill faster)</label>
      </div>
      <div className="section">
        <h3>Board</h3>
        <dl className="stats">
          <dt>Deployables</dt><dd>{nodes.length}</dd>
          <dt>Generated</dt><dd>{gen} rW</dd>
          <dt>Used by devices</dt><dd>{used} rW</dd>
          <dt>Stored in batteries</dt><dd>{Math.round(stored).toLocaleString()} rWm</dd>
          <dt>Sim time</dt><dd>{Math.floor(w.time / 60)}m {Math.floor(w.time % 60)}s</dd>
        </dl>
      </div>
      <div className="section">
        <h3>New cable colour</h3>
        <div className="colors">
          {WIRE_COLORS.map((c) => (
            <button key={c.id} className="swatch" style={{ background: c.hex }} title={c.label} aria-label={c.label} aria-pressed={wireColor === c.id} onClick={() => setWireColor(c.id)} />
          ))}
        </div>
      </div>
      <div className="section">
        <h3>Controls</h3>
        <ul className="tips">
          <li>Drag from an output dot to an input dot to wire. One cable per port, like in-game.</li>
          <li>Double-click a cable to add a bend; select it to recolour.</li>
          <li>Drag a player near sensors, turrets and workbenches.</li>
          <li><span className="kbd">Del</span> removes, <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> undoes, <span className="kbd">Ctrl</span>+<span className="kbd">D</span> duplicates, <span className="kbd">Space</span> pauses.</li>
        </ul>
        <div className="btnrow" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setDialog('calc')}>Recipe calculator</button>
          <button className="btn" onClick={() => setDialog('help')}>How it works</button>
        </div>
      </div>
    </>
  );
}
