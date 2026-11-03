import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useStore, graphOf } from './store';
import { world, type Notice } from './sim/world';
import { step, buildCtx, STEP } from './sim/engine';
import Board, { cursor } from './ui/Board';
import Palette from './ui/Palette';
import Inspector from './ui/Inspector';
import SimPanel, { fmtTod } from './ui/SimPanel';
import { SaveDialog, OpenDialog, GalleryDialog, CalcDialog, HelpDialog, BackgroundDialog, ProfileDialog, AdminDialog, AccountMenu } from './ui/Dialogs';
import { Ic } from './ui/icons';
import { cloud, local, downloadJSON, type User } from './lib/cloud';

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
      const w = world.current;
      if (w.destroy.length) s.removeIds(w.destroy.splice(0));
      if (w.spawn.length) for (const sp of w.spawn.splice(0)) s.spawnPile(sp.x, sp.y, sp.inv);
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
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

function FileMenu({ onQuickSave }: { onQuickSave: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { setDialog, newBuild, serialize, title, dirty } = useStore();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [open]);
  const go = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">File</button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={go(() => { if (!dirty || confirm('Start a new build? Unsaved changes are lost (Undo can bring them back).')) newBuild(); })}><Ic.plus />New build</button>
          <button role="menuitem" onClick={go(() => setDialog('open'))}><Ic.open />Open / load…</button>
          <button role="menuitem" onClick={go(() => setDialog('modules'))}><Ic.grid />Insert module…</button>
          <button role="menuitem" onClick={go(() => setDialog('gallery'))}><Ic.globe />Gallery and examples</button>
          <hr />
          <button role="menuitem" onClick={go(onQuickSave)}><Ic.save />Save<span className="kbd">{mod}+S</span></button>
          <button role="menuitem" onClick={go(() => setDialog('saveas'))}><Ic.copy />Save as…</button>
          <button role="menuitem" onClick={go(() => downloadJSON(title || 'rustwire-build', serialize()))}>Export file</button>
          <hr />
          <button role="menuitem" onClick={go(() => setDialog('bg'))}>Board background…</button>
          <button role="menuitem" onClick={go(() => setDialog('calc'))}><Ic.calc />Recipe calculator</button>
          <button role="menuitem" onClick={go(() => setDialog('help'))}><Ic.help />How it works</button>
        </div>
      )}
    </div>
  );
}

function TopBar({ user, admin, onLogout, onQuickSave, onProfile }: { user: User | null; admin: boolean; onLogout: () => void; onQuickSave: () => void; onProfile: (sid: string) => void }) {
  useStore((s) => s.tick);
  const { running, speed, title, setRunning, setSpeed, setTitle, setDialog, undo, redo, past, future, drawMode, setDrawMode, straight, setStraight } = useStore();
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#403c36" /><path d="M18 3 8 18h7l-2 11 11-16h-7z" fill="#ffb627" /></svg>
        <span className="brand-word" style={{ color: 'inherit' }}>Rustwire</span> <span>Lab</span>
      </div>
      <FileMenu onQuickSave={onQuickSave} />
      <input className="title-input" value={title} placeholder="Untitled build" onChange={(e) => setTitle(e.target.value)} aria-label="Build name" maxLength={80} />
      <div className="sim-controls">
        <button className="btn icon" onClick={() => setRunning(!running)} aria-label={running ? 'Pause simulation' : 'Run simulation'} title={running ? 'Pause (Space)' : 'Run (Space)'}>
          {running ? <Ic.pause /> : <Ic.play />}
        </button>
        <div className="speed hide-sm" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
        <span className="clock hide-sm" title="In-game time">{fmtTod(world.current.tod)}</span>
      </div>
      <div className="toolgroup hide-sm" role="group" aria-label="Cable tools">
        <button className="btn" aria-pressed={drawMode} onClick={() => setDrawMode(!drawMode)} title="Wire tool (W): click ports and corners to lay a cable"><Ic.bolt />Wire tool</button>
        <button className="btn" aria-pressed={straight} onClick={() => setStraight(!straight)} title="New cables use straight lines with sharp corners">Straight</button>
      </div>
      <div className="spacer" />
      <button className="btn icon ghost hide-sm" onClick={undo} disabled={!past.length} aria-label="Undo" title={`Undo (${mod}+Z)`}><Ic.undo /></button>
      <button className="btn icon ghost hide-sm" onClick={redo} disabled={!future.length} aria-label="Redo" title={`Redo (${mod}+Shift+Z)`}><Ic.redo /></button>
      <button className="btn ghost hide-sm" onClick={() => setDialog('gallery')}><Ic.globe />Gallery</button>
      <button className="btn primary" onClick={onQuickSave}><Ic.save /><span className="hide-sm">Save</span></button>
      <AccountMenu user={user} admin={admin} onLogout={onLogout} onProfile={() => user && onProfile(user.sid)} onAdmin={() => setDialog('admin')} onMine={() => setDialog('online')} />
    </header>
  );
}

function TabBar() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const drawMode = useStore((s) => s.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  const t = (p: 'items' | 'inspect' | 'sim') => setPanel(panel === p ? null : p);
  return (
    <nav className="tabbar" aria-label="Panels">
      <button aria-pressed={panel === 'items'} onClick={() => t('items')}><Ic.grid />Items</button>
      <button aria-pressed={panel === 'inspect'} onClick={() => t('inspect')}><Ic.info />Inspect</button>
      <button aria-pressed={drawMode} onClick={() => setDrawMode(!drawMode)}><Ic.bolt />Wire tool</button>
      <button aria-pressed={panel === 'sim'} onClick={() => t('sim')}><Ic.sun />World</button>
    </nav>
  );
}

let toastId = 1e6;

function Shortcuts({ toast }: { toast: (t: string) => void }) {
  const { screenToFlowPosition } = useReactFlow();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useStore.getState();
      const m = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (m && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (m && key === 'y') { e.preventDefault(); s.redo(); }
      else if (m && key === 'd') { e.preventDefault(); s.duplicateSelected(); }
      else if (m && key === 'c') { const n = s.copySelected(); if (n) toast(`Copied ${n} part${n > 1 ? 's' : ''}`); }
      else if (m && key === 'v') { e.preventDefault(); s.paste(cursor.current ?? undefined); }
      else if (m && key === 's') { e.preventDefault(); document.dispatchEvent(new CustomEvent('rw-save')); }
      else if (!m && key === 'w') s.setDrawMode(!s.drawMode);
      else if (e.key === ' ' && !m) { e.preventDefault(); s.setRunning(!s.running); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [toast, screenToFlowPosition]);
  return null;
}

export default function App() {
  useSimLoop();
  const { dialog, setDialog, panel, setPanel, load, insertDoc } = useStore();
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const [extra, setExtra] = useState<Notice[]>([]);
  const toast = useCallback((text: string, kind: Notice['kind'] = 'info') => setExtra((x) => [...x.slice(-5), { id: toastId++, text, kind }]), []);

  const openCloud = useCallback(async (id: string, insert = false) => {
    try {
      const r = await cloud.get(id);
      if (insert) {
        insertDoc(r.doc);
        toast(`Inserted ${r.title}`);
        return;
      }
      load(r.doc, r.canEdit ? { cloudId: r.id, visibility: r.visibility } : {}, r.title);
      history.replaceState(null, '', `/b/${id}`);
      if (!r.canEdit) toast(`Opened “${r.title}” by ${r.author}. Saving makes your own copy.`);
    } catch (e) {
      toast((e as Error).message, 'warn');
    }
  }, [load, insertDoc, toast]);

  const quickSave = useCallback(async () => {
    const s = useStore.getState();
    if (!s.title.trim()) { setDialog('save'); return; }
    if (s.meta.cloudId) {
      try { await cloud.update(s.meta.cloudId, { title: s.title, visibility: s.meta.visibility ?? 'private', doc: s.serialize() }); s.markSaved(); toast('Saved online'); return; } catch { /* fall through */ }
    }
    if (s.meta.localId) {
      local.save({ id: s.meta.localId, title: s.title, updated: Date.now(), doc: s.serialize(), cloudId: s.meta.cloudId });
      s.markSaved();
      toast('Saved on this device');
      return;
    }
    setDialog('save');
  }, [setDialog, toast]);
  useEffect(() => {
    const h = () => quickSave();
    document.addEventListener('rw-save', h);
    return () => document.removeEventListener('rw-save', h);
  }, [quickSave]);

  // first load: share link, profile link, or the last session on this device
  useEffect(() => {
    cloud.me().then((r) => { setUser(r.user); setAdmin(!!r.admin); });
    const params = new URLSearchParams(location.search);
    if (params.get('login') === 'failed') toast('Steam sign-in failed. Try again.', 'warn');
    const b = location.pathname.match(/^\/b\/([\w-]{4,20})/);
    const u = location.pathname.match(/^\/u\/(\d{17})/);
    if (u) setProfile(u[1]);
    if (b) { openCloud(b[1]); return; }
    const a = local.restore();
    if (a?.doc?.nodes?.length) load(a.doc, a.meta ?? {}, a.title);
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

  const logout = async () => { await cloud.logout(); setUser(null); setAdmin(false); toast('Signed out'); };
  const openProfile = (sid: string) => { setDialog(null); setProfile(sid); };

  return (
    <ReactFlowProvider>
      <Shortcuts toast={toast} />
      <div className="app">
        <TopBar user={user} admin={admin} onLogout={logout} onQuickSave={quickSave} onProfile={openProfile} />
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
      {(dialog === 'save' || dialog === 'saveas') && <SaveDialog user={user} asNew={dialog === 'saveas'} onClose={() => setDialog(null)} toast={toast} />}
      {(dialog === 'open' || dialog === 'online' || dialog === 'modules') && (
        <OpenDialog user={user} initialTab={dialog === 'open' ? 'device' : dialog} onClose={() => setDialog(null)} openCloud={openCloud} toast={toast} />
      )}
      {dialog === 'gallery' && <GalleryDialog admin={admin} onClose={() => setDialog(null)} openCloud={openCloud} openProfile={openProfile} toast={toast} />}
      {dialog === 'calc' && <CalcDialog onClose={() => setDialog(null)} toast={toast} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'bg' && <BackgroundDialog onClose={() => setDialog(null)} />}
      {dialog === 'admin' && admin && <AdminDialog onClose={() => setDialog(null)} openCloud={openCloud} openProfile={openProfile} toast={toast} />}
      {profile && <ProfileDialog sid={profile} admin={admin} onClose={() => { setProfile(null); if (location.pathname.startsWith('/u/')) history.replaceState(null, '', '/'); }} openCloud={openCloud} toast={toast} />}
    </ReactFlowProvider>
  );
}
