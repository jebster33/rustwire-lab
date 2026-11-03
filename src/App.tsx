import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useStore, graphOf } from './store';
import { world, type Notice } from './sim/world';
import { step, buildCtx, STEP } from './sim/engine';
import Board from './ui/Board';
import Palette from './ui/Palette';
import Inspector from './ui/Inspector';
import SimPanel, { fmtTod } from './ui/SimPanel';
import { SaveDialog, OpenDialog, GalleryDialog, CalcDialog, HelpDialog, LoginButton } from './ui/Dialogs';
import { Ic } from './ui/icons';
import { cloud, local, type User } from './lib/cloud';
import { EXAMPLES } from './lib/examples';

function useSimLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastPaint = 0;
    const loop = (now: number) => {
      const s = useStore.getState();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (s.running) {
        acc += dt * s.speed;
        if (acc >= STEP) {
          const g = graphOf(s.nodes, s.edges);
          const ctx = buildCtx(world.current, g);
          let steps = 0;
          while (acc >= STEP && steps < 800) {
            step(world.current, g, STEP, ctx);
            acc -= STEP;
            steps++;
          }
          if (steps >= 800) acc = 0;
          if (now - lastPaint > 90) { s.bump(); lastPaint = now; }
        }
      } else acc = 0;
      if (world.current.destroy.length) s.removeIds(world.current.destroy.splice(0));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function Toasts({ extra }: { extra: Notice[] }) {
  const tick = useStore((s) => s.tick);
  const [shown, setShown] = useState<Notice[]>([]);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    const fresh = [...world.current.notices, ...extra].filter((n) => !seen.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => seen.current.add(n.id));
    setShown((s) => [...s, ...fresh].slice(-4));
    for (const n of fresh) setTimeout(() => setShown((s) => s.filter((x) => x.id !== n.id)), 4200);
  }, [tick, extra]);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {shown.map((n) => <div key={n.id} className={`toast ${n.kind}`}>{n.text}</div>)}
    </div>
  );
}

const SPEEDS = [1, 5, 20, 100];

function TopBar({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  useStore((s) => s.tick);
  const { running, speed, title, setRunning, setSpeed, setTitle, setDialog, undo, redo, past, future } = useStore();
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#2b353a" /><path d="M18 3 8 18h7l-2 11 11-16h-7z" fill="#f3b23a" /></svg>
        <span className="brand-word" style={{ color: 'inherit', fontWeight: 700 }}>Rustwire</span> <span>Lab</span>
      </div>
      <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Build name" maxLength={80} />
      <div className="sim-controls">
        <button className="btn icon" onClick={() => setRunning(!running)} aria-label={running ? 'Pause simulation' : 'Run simulation'} title={running ? 'Pause (Space)' : 'Run (Space)'}>
          {running ? <Ic.pause /> : <Ic.play />}
        </button>
        <div className="speed hide-sm" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
        <span className="clock hide-sm" title="In-game time">{fmtTod(world.current.tod)}</span>
      </div>
      <div className="spacer" />
      <button className="btn icon ghost hide-sm" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl+Z)"><Ic.undo /></button>
      <button className="btn icon ghost hide-sm" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Ic.redo /></button>
      <button className="btn ghost hide-sm" onClick={() => setDialog('gallery')}><Ic.globe />Gallery</button>
      <button className="btn ghost" onClick={() => setDialog('open')} aria-label="Open"><Ic.open /><span className="hide-sm">Open</span></button>
      <button className="btn primary" onClick={() => setDialog('save')}><Ic.save /><span className="hide-sm">Save</span></button>
      <LoginButton user={user} onLogout={onLogout} />
    </header>
  );
}

function TabBar() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const setDialog = useStore((s) => s.setDialog);
  const t = (p: 'items' | 'inspect' | 'sim') => setPanel(panel === p ? null : p);
  return (
    <nav className="tabbar" aria-label="Panels">
      <button aria-pressed={panel === 'items'} onClick={() => t('items')}><Ic.grid />Items</button>
      <button aria-pressed={panel === 'inspect'} onClick={() => t('inspect')}><Ic.info />Inspect</button>
      <button aria-pressed={panel === 'sim'} onClick={() => t('sim')}><Ic.sun />World</button>
      <button onClick={() => { setPanel(null); setDialog('gallery'); }}><Ic.globe />Gallery</button>
    </nav>
  );
}

let toastId = 1e6;

export default function App() {
  useSimLoop();
  const { dialog, setDialog, panel, setPanel, load } = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [extra, setExtra] = useState<Notice[]>([]);
  const toast = useCallback((text: string, kind: Notice['kind'] = 'info') => setExtra((x) => [...x.slice(-5), { id: toastId++, text, kind }]), []);

  const openCloud = useCallback(async (id: string) => {
    try {
      const r = await cloud.get(id);
      load(r.doc, r.canEdit ? { cloudId: r.id, visibility: r.visibility } : {}, r.title);
      history.replaceState(null, '', `/b/${id}`);
      if (!r.canEdit) toast(`Opened “${r.title}” by ${r.author}. Saving makes your own copy.`);
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  }, [load, toast]);

  // first load: share link, autosave, or the first example
  useEffect(() => {
    cloud.me().then(setUser);
    const m = location.pathname.match(/^\/b\/([\w-]{4,20})/);
    const params = new URLSearchParams(location.search);
    if (params.get('login') === 'failed') toast('Steam sign-in failed. Try again.', 'warn');
    if (m) { openCloud(m[1]); return; }
    const a = local.restore();
    if (a?.doc?.nodes?.length) load(a.doc, a.meta ?? {}, a.title);
    else load(EXAMPLES[0].doc(), {}, EXAMPLES[0].title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave to this device
  useEffect(() => {
    const t = setInterval(() => {
      const s = useStore.getState();
      local.autosave(s.title, s.serialize(), s.meta);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // open the inspector sheet on mobile when something gets selected
  const selCount = useStore((s) => s.nodes.filter((n) => n.selected).length + s.edges.filter((e) => e.selected).length);
  useEffect(() => {
    if (selCount && matchMedia('(max-width: 820px)').matches && panel !== 'items') setPanel('inspect');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selCount]);

  // keyboard shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateSelected(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); s.setDialog('save'); }
      else if (e.key === ' ' && !mod) { e.preventDefault(); s.setRunning(!s.running); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const logout = async () => { await cloud.logout(); setUser(null); toast('Signed out'); };

  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar user={user} onLogout={logout} />
        <div className="workspace">
          <aside className={`side left ${panel === 'items' ? 'sheet-open' : ''}`} aria-label="Deployables"><Palette /></aside>
          <Board />
          <aside className={`side right ${panel === 'inspect' || panel === 'sim' ? 'sheet-open' : ''}`} aria-label="Inspector">
            {panel === 'sim' ? <div className="panel-scroll" style={{ padding: 0 }}><SimPanel /></div> : <Inspector />}
          </aside>
        </div>
        <TabBar />
      </div>
      <Toasts extra={extra} />
      {dialog === 'save' && <SaveDialog user={user} onClose={() => setDialog(null)} toast={toast} />}
      {dialog === 'open' && <OpenDialog user={user} onClose={() => setDialog(null)} openCloud={openCloud} toast={toast} />}
      {dialog === 'gallery' && <GalleryDialog onClose={() => setDialog(null)} openCloud={openCloud} />}
      {dialog === 'calc' && <CalcDialog onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
    </ReactFlowProvider>
  );
}
