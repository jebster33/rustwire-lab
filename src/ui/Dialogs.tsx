import { useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import { useStore } from '../store';
import { cloud, local, rememberKey, downloadJSON, type Meta, type User, type LocalSave } from '../lib/cloud';
import { EXAMPLES } from '../lib/examples';
import { Ic, ItemIcon, SteamLogo } from './icons';
import { ITEMS, itemName, rawCost } from '../data/items';
import { ItemPicker } from './Inventory';
import { fmtTime } from './DepNode';

function Shell({ title, onClose, children, foot, wide }: { title: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close"><Ic.x /></button>
        </div>
        <div className="dialog-body">{children}</div>
        {foot && <div className="dialog-foot">{foot}</div>}
      </div>
    </div>
  );
}

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

export const shareUrl = (id: string) => `${location.origin}/b/${id}`;

export function SaveDialog({ user, onClose, toast }: { user: User | null; onClose: () => void; toast: (t: string) => void }) {
  const { title, meta, serialize, setTitle, setMeta } = useStore();
  const [name, setName] = useState(title);
  const [vis, setVis] = useState<'private' | 'public'>(meta.visibility ?? 'private');
  const [author, setAuthor] = useState(() => localStorage.getItem('rw.author') ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState(meta.cloudId ? shareUrl(meta.cloudId) : '');

  const saveLocal = () => {
    const id = meta.localId ?? nanoid(8);
    const ok = local.save({ id, title: name, updated: Date.now(), doc: serialize(), cloudId: meta.cloudId });
    setTitle(name);
    setMeta({ ...meta, localId: id });
    toast(ok ? 'Saved on this device' : 'This browser blocked local storage. Download the file instead.');
  };
  const saveCloud = async (fork = false) => {
    setBusy(true);
    setErr('');
    try {
      try { localStorage.setItem('rw.author', author); } catch { /* ignore */ }
      const body = { title: name, visibility: vis, author: author || undefined, doc: serialize() };
      let id = meta.cloudId;
      if (id && !fork) {
        await cloud.update(id, body);
      } else {
        const r = await cloud.create(body);
        id = r.id;
        rememberKey(r.id, r.editKey);
      }
      setTitle(name);
      setMeta({ ...meta, cloudId: id, visibility: vis });
      history.replaceState(null, '', `/b/${id}`);
      setLink(shareUrl(id!));
      toast(vis === 'public' ? 'Published to the gallery' : 'Saved online');
    } catch (e) {
      const msg = (e as Error).message;
      if (/Only the creator/.test(msg)) setErr('This build belongs to someone else. Use "Save as my copy" to keep your own version.');
      else setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Save build" onClose={onClose}>
      <div className="field">
        <label htmlFor="sv-name">Name</label>
        <input id="sv-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Who can see it online</label>
        <div className="seg">
          <button aria-pressed={vis === 'private'} onClick={() => setVis('private')}>Private link</button>
          <button aria-pressed={vis === 'public'} onClick={() => setVis('public')}>Public gallery</button>
        </div>
        <p className="help">
          {vis === 'private' ? 'Only people with the link can open it.' : 'Listed in the gallery for everyone to browse and fork.'}{' '}
          {user ? `Linked to your Steam account (${user.name}).` : 'Edit rights stay on this device. Sign in with Steam to reach your builds from any device.'}
        </p>
      </div>
      {!user && (
        <div className="field">
          <label htmlFor="sv-author">Author name (optional)</label>
          <input id="sv-author" className="input" value={author} maxLength={40} onChange={(e) => setAuthor(e.target.value)} />
        </div>
      )}
      {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
      {link && (
        <div className="field">
          <label>Share link</label>
          <div className="linkbox">
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(link); toast('Link copied'); }}><Ic.link />Copy</button>
          </div>
        </div>
      )}
      <div className="btnrow" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={busy} onClick={() => saveCloud(false)}><Ic.globe />{meta.cloudId ? 'Update online save' : 'Save online'}</button>
        {meta.cloudId && <button className="btn" disabled={busy} onClick={() => saveCloud(true)}><Ic.fork />Save as my copy</button>}
        <button className="btn" onClick={saveLocal}><Ic.save />Save on this device</button>
        <button className="btn ghost" onClick={() => downloadJSON(name, serialize())}>Download file</button>
      </div>
    </Shell>
  );
}

function MetaCard({ m, onOpen, extra }: { m: Meta; onOpen: () => void; extra?: React.ReactNode }) {
  return (
    <div className="card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="icons">{(m.icons ?? []).map((s) => <ItemIcon key={s} s={s} size={26} />)}</div>
      <h4>{m.title}</h4>
      <small>{m.author}, {m.count} parts, {ago(m.updated)}</small>
      {extra}
    </div>
  );
}

export function OpenDialog({ user, onClose, openCloud, toast }: { user: User | null; onClose: () => void; openCloud: (id: string) => void; toast: (t: string) => void }) {
  const load = useStore((s) => s.load);
  const [tab, setTab] = useState<'examples' | 'device' | 'online'>('examples');
  const [locals, setLocals] = useState<LocalSave[]>(() => local.list());
  const [mine, setMine] = useState<Meta[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (tab !== 'online') return;
    setErr('');
    const owned = local.ownedIds();
    Promise.all([
      user ? cloud.mine().catch(() => [] as Meta[]) : Promise.resolve([] as Meta[]),
      Promise.all(owned.slice(0, 40).map((id) => cloud.get(id).then((r) => ({ ...r, doc: undefined }) as unknown as Meta).catch(() => null))),
    ])
      .then(([a, b]) => {
        const map = new Map<string, Meta>();
        for (const m of [...a, ...(b.filter(Boolean) as Meta[])]) map.set(m.id, m);
        setMine([...map.values()].sort((x, y) => y.updated - x.updated));
      })
      .catch((e) => setErr((e as Error).message));
  }, [tab, user]);

  const importFile = (f: File) => {
    f.text().then((t) => {
      try {
        const d = JSON.parse(t);
        if (!Array.isArray(d.nodes)) throw new Error();
        load(d, {}, d.title ?? f.name.replace(/\.rustwire\.json$|\.json$/, ''));
        history.replaceState(null, '', '/');
        onClose();
      } catch {
        toast('That file is not a Rustwire build.');
      }
    });
  };

  return (
    <Shell title="Open a build" onClose={onClose} wide>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button aria-pressed={tab === 'examples'} onClick={() => setTab('examples')}>Examples</button>
        <button aria-pressed={tab === 'device'} onClick={() => setTab('device')}>On this device</button>
        <button aria-pressed={tab === 'online'} onClick={() => setTab('online')}>My online builds</button>
      </div>
      {tab === 'examples' && (
        <div className="cards">
          {EXAMPLES.map((ex) => (
            <div key={ex.id} className="card" role="button" tabIndex={0} onClick={() => { load(ex.doc(), {}, ex.title); history.replaceState(null, '', '/'); onClose(); }}>
              <div className="icons">{ex.icons.map((s) => <ItemIcon key={s} s={s} size={26} />)}</div>
              <h4>{ex.title}</h4>
              <small>{ex.blurb}</small>
            </div>
          ))}
        </div>
      )}
      {tab === 'device' && (
        <>
          <div className="btnrow" style={{ marginBottom: 12 }}>
            <label className="btn"><Ic.open />Import file<input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
          </div>
          {!locals.length && <p className="muted">Nothing saved on this device yet. Use Save, then “Save on this device”.</p>}
          <div className="cards">
            {locals.map((s) => (
              <div key={s.id} className="card" role="button" tabIndex={0} onClick={() => { load(s.doc, { localId: s.id, cloudId: s.cloudId }, s.title); history.replaceState(null, '', s.cloudId ? `/b/${s.cloudId}` : '/'); onClose(); }}>
                <h4>{s.title}</h4>
                <small>{s.doc.nodes.length} parts, {ago(s.updated)}</small>
                <button className="btn ghost" style={{ justifySelf: 'start' }} onClick={(e) => { e.stopPropagation(); local.remove(s.id); setLocals(local.list()); }}><Ic.trash />Delete</button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'online' && (
        <>
          {!user && <p className="help" style={{ marginBottom: 10 }}>Showing builds saved from this device. <a href={cloud.loginUrl()} style={{ color: 'var(--amber)' }}>Sign in with Steam</a> to see builds from your other devices too.</p>}
          {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
          {mine === null ? <p className="muted">Loading…</p> : !mine.length ? <p className="muted">No online builds yet.</p> : (
            <div className="cards">
              {mine.map((m) => (
                <MetaCard key={m.id} m={m} onOpen={() => { openCloud(m.id); onClose(); }} extra={<small>{m.visibility === 'public' ? 'Public' : 'Private link'}</small>} />
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

export function GalleryDialog({ onClose, openCloud }: { onClose: () => void; openCloud: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Meta[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setErr('');
      cloud.gallery(q).then(setItems).catch((e) => { setErr((e as Error).message); setItems([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Shell title="Public gallery" onClose={onClose} wide>
      <input className="search" placeholder="Search builds or authors" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
      {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
      {items === null ? <p className="muted">Loading…</p> : !items.length && !err ? <p className="muted">No public builds{q ? ` match “${q}”` : ' yet. Publish one from Save'}.</p> : (
        <div className="cards">{items.map((m) => <MetaCard key={m.id} m={m} onOpen={() => { openCloud(m.id); onClose(); }} />)}</div>
      )}
    </Shell>
  );
}

export function CalcDialog({ onClose }: { onClose: () => void }) {
  const [item, setItem] = useState<string>('electric.battery.rechargable.large');
  const [amount, setAmount] = useState(1);
  const [deep, setDeep] = useState(true);
  const [pick, setPick] = useState(false);
  const res = useMemo(() => rawCost(item, amount, deep), [item, amount, deep]);
  const rec = ITEMS[item]?.c;
  return (
    <Shell title="Recipe calculator" onClose={onClose}>
      <div className="li" style={{ marginBottom: 12 }}>
        <ItemIcon s={item} size={40} />
        <div className="grow">
          <div className="name">{itemName(item)}</div>
          <small>{rec ? `Workbench ${rec.wb || 'none'}, makes ${rec.y} per craft, ${rec.t}s each` : 'Not craftable'}</small>
        </div>
        <button className="btn" onClick={() => setPick(true)}>Change</button>
      </div>
      <div className="field">
        <label htmlFor="calc-n">Amount</label>
        <input id="calc-n" className="input" type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} />
      </div>
      <label className="check"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />Break components down to raw resources</label>
      {rec ? (
        <>
          <table className="calc-table">
            <tbody>
              {res.totals.map(([s, a]) => (
                <tr key={s}><td><ItemIcon s={s} size={24} className="" />{itemName(s)}</td><td>{Math.ceil(a).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="help">Total crafting time about {fmtTime(res.time)} (no workbench speed bonus).</p>
        </>
      ) : <p className="muted">This item has no crafting recipe.</p>}
      {pick && <ItemPicker title="Pick an item" withAmount={false} filter={(s) => !!ITEMS[s].c} onClose={() => setPick(false)} onPick={(s) => { setItem(s); setPick(false); }} />}
    </Shell>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Shell title="How Rustwire Lab works" onClose={onClose}>
      <ul className="tips" style={{ display: 'grid', gap: 8, fontSize: 14 }}>
        <li><b>Power</b> flows from generators and batteries along wires. Each part takes its consumption (usually 1 rW) off what it passes through, just like in-game. Batteries charge at 80% efficiency and drain by what is actually used downstream.</li>
        <li><b>Logic</b> parts react to the moment an input switches on (rising edge): memory cells, counters, timers, RAND switches and Switch On/Off inputs.</li>
        <li><b>Players</b> are the hazmat tokens. Drag them into HBHF range, across laser beams, onto pressure pads or into turret range. Unauthorized players get shot.</li>
        <li><b>Water</b> moves along hoses from pumps, catchers and barrels at up to 100 mL/s. Sprinklers water planters within 3 m.</li>
        <li><b>Industrial</b> conveyors pull from containers on their input pipe and push to the ones on their output pipe, once per second, through splitters and combiners.</li>
        <li><b>Crafting</b>: workbenches let a nearby player craft from their inventory. Industrial crafters next to a bench craft their templates from piped-in items.</li>
        <li><b>Scale</b>: one grid square is one metre. Ranges are measured from the edge of each part.</li>
        <li>Item data, recipes and recycle yields come from RustLabs; icons are loaded from the RustClash wiki. Rustwire Lab is a fan tool, not affiliated with Facepunch.</li>
      </ul>
    </Shell>
  );
}

export function LoginButton({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  if (user)
    return (
      <button className="btn ghost" onClick={onLogout} title="Sign out">
        {user.avatar ? <img className="avatar" src={user.avatar} alt="" /> : <SteamLogo />}
        <span className="hide-sm">{user.name}</span>
      </button>
    );
  return (
    <a className="btn steam" href={cloud.loginUrl()}><SteamLogo /><span className="hide-sm">Sign in</span></a>
  );
}
