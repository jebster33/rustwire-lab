import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { world } from '../sim/world';
import { importRustrician, exportRustrician } from '../lib/rustrician';
import { exportPng, exportGif, download } from '../lib/exportImage';
import { nanoid } from 'nanoid';
import { useStore, type SaveDoc } from '../store';
import { cloud, local, rememberKey, downloadJSON, type Meta, type User, type LocalSave, type Profile } from '../lib/cloud';
import { EXAMPLES, MODULES } from '../lib/examples';
import { Ic, ItemIcon, SteamLogo } from './icons';
import { ITEMS, itemName } from '../data/items';
import { BlueprintPicker } from './Inventory';
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


// ───────── save
export function SaveDialog({ user, asNew, onClose, toast }: { user: User | null; asNew?: boolean; onClose: () => void; toast: (t: string) => void }) {
  const { title, meta, serialize, setTitle, setMeta, markSaved } = useStore();
  const [name, setName] = useState(title);
  const [vis, setVis] = useState<'private' | 'public'>(meta.visibility ?? 'private');
  const [author, setAuthor] = useState(() => { try { return localStorage.getItem('rw.author') ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [link, setLink] = useState(meta.cloudId && !asNew ? shareUrl(meta.cloudId) : '');
  const named = name.trim().length > 0;

  const saveLocal = () => {
    if (!named) return setErr('Give the build a name first.');
    const id = !asNew && meta.localId ? meta.localId : nanoid(8);
    const ok = local.save({ id, title: name.trim(), updated: Date.now(), doc: serialize(), cloudId: asNew ? undefined : meta.cloudId });
    setTitle(name.trim());
    setMeta({ ...(asNew ? {} : meta), localId: id });
    markSaved();
    toast(ok ? 'Saved on this device' : 'This browser blocked local storage. Download the file instead.');
    if (ok) onClose();
  };
  const saveCloud = async () => {
    if (!named) return setErr('Give the build a name first.');
    setBusy(true);
    setErr('');
    try {
      try { localStorage.setItem('rw.author', author); } catch { /* ignore */ }
      const body = { title: name.trim(), visibility: vis, author: author || undefined, doc: serialize() };
      let id = asNew ? undefined : meta.cloudId;
      if (id) {
        await cloud.update(id, body);
      } else {
        const r = await cloud.create(body);
        id = r.id;
        rememberKey(r.id, r.editKey);
      }
      setTitle(name.trim());
      setMeta({ ...meta, cloudId: id, visibility: vis });
      markSaved();
      history.replaceState(null, '', `/b/${id}`);
      setLink(shareUrl(id!));
      toast(vis === 'public' ? 'Published to the gallery' : 'Saved online');
    } catch (e) {
      const msg = (e as Error).message;
      if (/Only the creator/.test(msg)) setErr('This build belongs to someone else. Use File, Save as to keep your own copy.');
      else setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={asNew ? 'Save as' : 'Save build'} onClose={onClose}>
      <div className="field">
        <label htmlFor="sv-name">Name</label>
        <input id="sv-name" className="input" value={name} autoFocus maxLength={80} placeholder="Name this build" onChange={(e) => { setName(e.target.value); setErr(''); }} />
      </div>
      <div className="field">
        <label>Who can see it online</label>
        <div className="seg">
          <button aria-pressed={vis === 'private'} onClick={() => setVis('private')}>Private link</button>
          <button aria-pressed={vis === 'public'} onClick={() => setVis('public')}>Public gallery</button>
        </div>
        <p className="help">
          {vis === 'private' ? 'Only people with the link can open it.' : 'Listed in the gallery and on your profile for everyone to browse and copy.'}{' '}
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
        <button className="btn primary" disabled={busy} onClick={saveCloud}><Ic.globe />{meta.cloudId && !asNew ? 'Update online save' : 'Save online'}</button>
        <button className="btn" onClick={saveLocal}><Ic.save />Save on this device</button>
        <button className="btn ghost" onClick={() => downloadJSON(name.trim() || 'rustwire-build', serialize())}>Download file</button>
      </div>
    </Shell>
  );
}

// ───────── cards
function MetaCard({ m, onOpen, extra, onAuthor }: { m: Meta; onOpen: () => void; extra?: React.ReactNode; onAuthor?: (sid: string) => void }) {
  return (
    <div className="card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="icons">{(m.icons ?? []).map((s) => <ItemIcon key={s} s={s} size={26} />)}</div>
      <h4>{m.title}</h4>
      <small>
        {m.owner && onAuthor ? (
          <button className="linkish" onClick={(e) => { e.stopPropagation(); onAuthor(m.owner!); }}>{m.author}</button>
        ) : m.author}
        {`, ${m.count} parts, ${ago(m.updated)}`}
      </small>
      {extra && <div className="card-actions" onClick={(e) => e.stopPropagation()}>{extra}</div>}
    </div>
  );
}

function ExampleCards({ list, onPick, action }: { list: typeof EXAMPLES; onPick: (d: SaveDoc, title: string) => void; action: string }) {
  return (
    <div className="cards">
      {list.map((ex) => (
        <div key={ex.id} className="card" role="button" tabIndex={0} onClick={() => onPick(ex.doc(), ex.title)} onKeyDown={(e) => e.key === 'Enter' && onPick(ex.doc(), ex.title)}>
          <div className="icons">{ex.icons.map((s) => <ItemIcon key={s} s={s} size={26} />)}</div>
          <h4>{ex.title}</h4>
          <small>{ex.blurb}</small>
          <small className="card-cta">{action}</small>
        </div>
      ))}
    </div>
  );
}

// ───────── open / load / modules
export function OpenDialog({ user, initialTab = 'device', onClose, openCloud, toast }: { user: User | null; initialTab?: 'device' | 'online' | 'modules'; onClose: () => void; openCloud: (id: string, insert?: boolean) => void; toast: (t: string) => void }) {
  const load = useStore((s) => s.load);
  const insertDoc = useStore((s) => s.insertDoc);
  const [tab, setTab] = useState(initialTab);
  const [locals, setLocals] = useState<LocalSave[]>(() => local.list());
  const [mine, setMine] = useState<Meta[] | null>(null);
  const [err, setErr] = useState('');

  const refreshMine = () => {
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
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'online') refreshMine(); }, [tab, user]);

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
  const insert = (doc: SaveDoc, title: string) => { insertDoc(doc); toast(`Inserted ${title}`); onClose(); };
  const remove = async (m: Meta) => {
    if (!confirm(`Delete “${m.title}” online? This can’t be undone.`)) return;
    try { await cloud.remove(m.id); toast('Deleted'); refreshMine(); } catch (e) { toast((e as Error).message); }
  };
  const flip = async (m: Meta) => {
    try { await cloud.patch(m.id, { visibility: m.visibility === 'public' ? 'private' : 'public' }); refreshMine(); } catch (e) { toast((e as Error).message); }
  };

  return (
    <Shell title="Open" onClose={onClose} wide>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button aria-pressed={tab === 'device'} onClick={() => setTab('device')}>On this device</button>
        <button aria-pressed={tab === 'online'} onClick={() => setTab('online')}>My online builds</button>
        <button aria-pressed={tab === 'modules'} onClick={() => setTab('modules')}>Modules</button>
      </div>
      {tab === 'device' && (
        <>
          <div className="btnrow" style={{ marginBottom: 12 }}>
            <label className="btn"><Ic.open />Load file<input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
          </div>
          {!locals.length && <p className="muted">Nothing saved on this device yet. Use File, Save, then “Save on this device”.</p>}
          <div className="cards">
            {locals.map((s) => (
              <div key={s.id} className="card" role="button" tabIndex={0} onClick={() => { load(s.doc, { localId: s.id, cloudId: s.cloudId }, s.title); history.replaceState(null, '', s.cloudId ? `/b/${s.cloudId}` : '/'); onClose(); }}>
                <h4>{s.title}</h4>
                <small>{s.doc.nodes.length} parts, {ago(s.updated)}</small>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost" onClick={() => insert(s.doc, s.title)}><Ic.plus />Insert into board</button>
                  <button className="btn ghost" onClick={() => { local.remove(s.id); setLocals(local.list()); }}><Ic.trash />Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'online' && (
        <>
          {!user && <p className="help" style={{ marginBottom: 10 }}>Showing builds saved from this device. <a href={cloud.loginUrl()} style={{ color: 'var(--chalk)' }}>Sign in with Steam</a> to see builds from your other devices too.</p>}
          {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
          {mine === null ? <p className="muted">Loading…</p> : !mine.length ? <p className="muted">No online builds yet.</p> : (
            <div className="cards">
              {mine.map((m) => (
                <MetaCard
                  key={m.id}
                  m={m}
                  onOpen={() => { openCloud(m.id); onClose(); }}
                  extra={
                    <>
                      <button className="btn ghost" onClick={() => flip(m)}>{m.visibility === 'public' ? 'Public: make private' : 'Private: publish'}</button>
                      <button className="btn ghost" onClick={() => { openCloud(m.id, true); onClose(); }}><Ic.plus />Insert</button>
                      <button className="btn ghost" onClick={() => remove(m)}><Ic.trash />Delete</button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'modules' && (
        <>
          <p className="help" style={{ marginTop: 0, marginBottom: 12 }}>Modules are added to the build you have open. Saved builds can also be inserted from “On this device”.</p>
          <ExampleCards list={MODULES} onPick={insert} action="Insert into board" />
        </>
      )}
    </Shell>
  );
}

// ───────── gallery (examples + community)
export function GalleryDialog({ admin, onClose, openCloud, openProfile, toast }: { admin: boolean; onClose: () => void; openCloud: (id: string) => void; openProfile: (sid: string) => void; toast: (t: string) => void }) {
  const load = useStore((s) => s.load);
  const [tab, setTab] = useState<'examples' | 'community'>('examples');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Meta[] | null>(null);
  const [err, setErr] = useState('');
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (tab !== 'community') return;
    const t = setTimeout(() => {
      setErr('');
      cloud.gallery(q).then(setItems).catch((e) => { setErr((e as Error).message); setItems([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, tab, rev]);
  const unpublish = async (m: Meta) => { try { await cloud.patch(m.id, { visibility: 'private' }); toast('Removed from the gallery'); setRev((r) => r + 1); } catch (e) { toast((e as Error).message); } };
  const del = async (m: Meta) => { if (!confirm(`Delete “${m.title}” by ${m.author}?`)) return; try { await cloud.remove(m.id); toast('Deleted'); setRev((r) => r + 1); } catch (e) { toast((e as Error).message); } };
  return (
    <Shell title="Gallery" onClose={onClose} wide>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button aria-pressed={tab === 'examples'} onClick={() => setTab('examples')}>Examples</button>
        <button aria-pressed={tab === 'community'} onClick={() => setTab('community')}>Community builds</button>
      </div>
      {tab === 'examples' ? (
        <ExampleCards list={EXAMPLES} onPick={(d, t) => { load(d, {}, t); history.replaceState(null, '', '/'); onClose(); }} action="Open" />
      ) : (
        <>
          <input className="search" placeholder="Search builds or authors" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} autoFocus />
          {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
          {items === null ? <p className="muted">Loading…</p> : !items.length && !err ? <p className="muted">No public builds{q ? ` match “${q}”` : ' yet. Publish one from File, Save'}.</p> : (
            <div className="cards">
              {items.map((m) => (
                <MetaCard
                  key={m.id}
                  m={m}
                  onOpen={() => { openCloud(m.id); onClose(); }}
                  onAuthor={(sid) => openProfile(sid)}
                  extra={admin ? (<><button className="btn ghost" onClick={() => unpublish(m)}>Unpublish</button><button className="btn ghost" onClick={() => del(m)}><Ic.trash />Delete</button></>) : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

// ───────── profiles
export function ProfileDialog({ sid, admin, onClose, openCloud, toast }: { sid: string; admin: boolean; onClose: () => void; openCloud: (id: string) => void; toast: (t: string) => void }) {
  const [data, setData] = useState<{ profile: Profile; items: Meta[]; self: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [rev, setRev] = useState(0);
  useEffect(() => { cloud.profile(sid).then(setData).catch((e) => setErr((e as Error).message)); }, [sid, rev]);
  const canManage = !!data && (data.self || admin);
  const flip = async (m: Meta) => { try { await cloud.patch(m.id, { visibility: m.visibility === 'public' ? 'private' : 'public' }); setRev((r) => r + 1); } catch (e) { toast((e as Error).message); } };
  const del = async (m: Meta) => { if (!confirm(`Delete “${m.title}”? This can’t be undone.`)) return; try { await cloud.remove(m.id); toast('Deleted'); setRev((r) => r + 1); } catch (e) { toast((e as Error).message); } };
  const pub = data?.items.filter((m) => m.visibility === 'public').length ?? 0;
  return (
    <Shell title={data ? (data.self ? 'My profile' : data.profile.name) : 'Profile'} onClose={onClose} wide>
      {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
      {!data && !err && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="profile-head">
            {data.profile.avatar ? <img src={data.profile.avatar} alt="" className="profile-avatar" /> : <span className="profile-avatar"><SteamLogo /></span>}
            <div>
              <h3>{data.profile.name}</h3>
              <p className="muted">{pub} public build{pub === 1 ? '' : 's'}{data.self ? `, ${data.items.length - pub} private` : ''}</p>
              <div className="btnrow" style={{ marginTop: 6 }}>
                <a className="btn ghost" href={`https://steamcommunity.com/profiles/${data.profile.sid}`} target="_blank" rel="noreferrer"><SteamLogo />Steam profile</a>
                <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/u/${data.profile.sid}`); toast('Profile link copied'); }}><Ic.link />Copy profile link</button>
              </div>
            </div>
          </div>
          {!data.items.length ? <p className="muted">{data.self ? 'Builds you save online while signed in show up here.' : 'No public builds yet.'}</p> : (
            <div className="cards">
              {data.items.map((m) => (
                <MetaCard
                  key={m.id}
                  m={m}
                  onOpen={() => { openCloud(m.id); onClose(); }}
                  extra={canManage ? (<><button className="btn ghost" onClick={() => flip(m)}>{m.visibility === 'public' ? 'Public: make private' : 'Private: publish'}</button><button className="btn ghost" onClick={() => del(m)}><Ic.trash />Delete</button></>) : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

// ───────── admin
export function AdminDialog({ onClose, openCloud, openProfile, toast }: { onClose: () => void; openCloud: (id: string) => void; openProfile: (sid: string) => void; toast: (t: string) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Meta[] | null>(null);
  const [err, setErr] = useState('');
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => cloud.adminList(q).then(setItems).catch((e) => { setErr((e as Error).message); setItems([]); }), 250);
    return () => clearTimeout(t);
  }, [q, rev]);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); setRev((r) => r + 1); } catch (e) { toast((e as Error).message); } };
  return (
    <Shell title="Admin" onClose={onClose} wide>
      <p className="help" style={{ marginTop: 0, marginBottom: 10 }}>Every online build saved since admin mode was added. Only your Steam account can see this.</p>
      <input className="search" placeholder="Search all builds" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
      {items === null ? <p className="muted">Loading…</p> : !items.length ? <p className="muted">No builds found.</p> : (
        <div className="cards">
          {items.map((m) => (
            <MetaCard
              key={m.id}
              m={m}
              onOpen={() => { openCloud(m.id); onClose(); }}
              onAuthor={openProfile}
              extra={
                <>
                  <span className="chip">{m.visibility === 'public' ? 'Public' : 'Private'}</span>
                  {m.visibility === 'public' && <button className="btn ghost" onClick={() => act(() => cloud.patch(m.id, { visibility: 'private' }), 'Unpublished')}>Unpublish</button>}
                  <button className="btn ghost" onClick={() => confirm(`Delete “${m.title}”?`) && act(() => cloud.remove(m.id), 'Deleted')}><Ic.trash />Delete</button>
                </>
              }
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

// ───────── recipe calculator with console commands
type Line = { s: string; n: number };
function craftPlan(lines: Line[]) {
  const crafts = new Map<string, number>(); // item -> number of crafts
  const raw = new Map<string, number>();
  let time = 0;
  const order: string[] = [];
  const need = (it: string, amount: number, depth: number) => {
    const rec = ITEMS[it]?.c;
    if (!rec || depth > 6 || ITEMS[it]?.g === 'resources') { raw.set(it, (raw.get(it) ?? 0) + amount); return; }
    const times = Math.ceil(amount / rec.y);
    crafts.set(it, (crafts.get(it) ?? 0) + times);
    time += times * rec.t;
    for (const [ing, a] of rec.i) need(ing, a * times, depth + 1);
    if (!order.includes(it)) order.push(it);
  };
  for (const l of lines) need(l.s, l.n, 0);
  // components first, finished items last
  const steps = [...order].map((s) => ({ s, crafts: crafts.get(s)!, makes: crafts.get(s)! * ITEMS[s].c!.y }));
  return { steps, raw: [...raw.entries()].sort((a, b) => b[1] - a[1]), time };
}
const CMD_KEY = 'rw.commands';
type SavedCmd = { name: string; text: string };
const readCmds = (): SavedCmd[] => { try { return JSON.parse(localStorage.getItem(CMD_KEY) ?? '[]'); } catch { return []; } };

export function CalcDialog({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState(false);
  const [bindKey, setBindKey] = useState('');
  const [cmds, setCmds] = useState<SavedCmd[]>(readCmds);
  const plan = useMemo(() => craftPlan(lines), [lines]);
  const missingIds = plan.steps.filter((st) => !ITEMS[st.s].id);
  const commandLines = plan.steps.filter((st) => ITEMS[st.s].id).map((st) => `craft.add ${ITEMS[st.s].id} ${st.crafts}`);
  const text = bindKey.trim()
    ? `bind ${bindKey.trim()} "${commandLines.join(';')}"`
    : commandLines.join('\n');
  const saveCmd = () => {
    const name = prompt('Name this command', lines.map((l) => `${l.n} ${itemName(l.s)}`).join(', ').slice(0, 60));
    if (!name) return;
    const next = [{ name, text }, ...cmds].slice(0, 30);
    setCmds(next);
    try { localStorage.setItem(CMD_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    toast('Command saved');
  };
  return (
    <Shell title="Recipe calculator" onClose={onClose} wide>
      <div className="calc-layout">
        <div>
          <h3 className="calc-h">Items to craft</h3>
          <div className="list">
            {lines.map((l, i) => {
              const rec = ITEMS[l.s].c!;
              return (
                <div className={`li tiered tier-${rec.wb}`} key={i}>
                  <ItemIcon s={l.s} size={30} />
                  <div className="grow"><div className="name">{itemName(l.s)}</div><small>{rec.wb ? `Workbench ${rec.wb}` : 'No workbench'}, makes {rec.y} per craft</small></div>
                  <input className="input" style={{ width: 80 }} type="number" min={1} value={l.n} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, n: Math.max(1, Number(e.target.value)) } : x)))} aria-label="Amount" />
                  <button className="btn icon ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Ic.x /></button>
                </div>
              );
            })}
          </div>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setPick(true)}><Ic.plus />Add blueprint</button>
          {plan.raw.length > 0 && (
            <>
              <h3 className="calc-h">Raw resources</h3>
              <table className="calc-table"><tbody>
                {plan.raw.map(([s, a]) => <tr key={s}><td><ItemIcon s={s} size={24} />{itemName(s)}</td><td>{Math.ceil(a).toLocaleString()}</td></tr>)}
              </tbody></table>
              <p className="help">About {fmtTime(plan.time)} of crafting without workbench speed bonuses.</p>
            </>
          )}
        </div>
        <div>
          <h3 className="calc-h">Crafting order</h3>
          {!plan.steps.length ? <p className="muted">Add items to see what to craft and in which order.</p> : (
            <ol className="calc-steps">
              {plan.steps.map((st) => <li key={st.s}><ItemIcon s={st.s} size={22} />{itemName(st.s)} <span className="muted">×{st.makes}{st.crafts !== st.makes ? ` (${st.crafts} crafts)` : ''}</span></li>)}
            </ol>
          )}
          {plan.steps.length > 0 && (
            <>
              <h3 className="calc-h">Console command</h3>
              <div className="field">
                <label htmlFor="bind">Bind to a key (optional)</label>
                <input id="bind" className="input" style={{ width: 120 }} placeholder="e.g. f6" value={bindKey} maxLength={12} onChange={(e) => setBindKey(e.target.value)} />
              </div>
              <textarea className="input cmd-box" readOnly value={text} rows={Math.min(8, commandLines.length + 1)} onFocus={(e) => e.target.select()} />
              <p className="help">Paste into the F1 console. Amounts are numbers of crafts, like the craft menu.{missingIds.length ? ` No item ID for ${missingIds.map((x) => itemName(x.s)).join(', ')}, so craft those by hand.` : ''}</p>
              <div className="btnrow" style={{ marginTop: 6 }}>
                <button className="btn" onClick={() => { navigator.clipboard?.writeText(text); toast('Command copied'); }}><Ic.copy />Copy</button>
                <button className="btn" onClick={saveCmd}><Ic.save />Save command</button>
              </div>
            </>
          )}
          {cmds.length > 0 && (
            <>
              <h3 className="calc-h">Saved commands</h3>
              <div className="list">
                {cmds.map((c, i) => (
                  <div className="li" key={i}>
                    <div className="grow"><div className="name">{c.name}</div><small className="mono-ish">{c.text.slice(0, 60)}{c.text.length > 60 ? '…' : ''}</small></div>
                    <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(c.text); toast('Command copied'); }}><Ic.copy /></button>
                    <button className="btn ghost" aria-label="Delete command" onClick={() => { const next = cmds.filter((_, j) => j !== i); setCmds(next); try { localStorage.setItem(CMD_KEY, JSON.stringify(next)); } catch { /* ignore */ } }}><Ic.trash /></button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {pick && <BlueprintPicker title="Add to calculator" onClose={() => setPick(false)} onPick={(s, n) => { setLines([...lines, { s, n }]); setPick(false); }} />}
    </Shell>
  );
}

// ───────── background image
export function BackgroundDialog({ onClose }: { onClose: () => void }) {
  const bg = useStore((s) => s.bg);
  const setBg = useStore((s) => s.setBg);
  const [url, setUrl] = useState(bg?.url.startsWith('data:') ? '' : bg?.url ?? '');
  const [err, setErr] = useState('');
  const cur = bg ?? { url: '', x: 0, y: 0, w: 1200, opacity: 0.6 };
  const upd = (p: Partial<NonNullable<typeof bg>>) => setBg({ ...cur, ...p });
  const upload = (f: File) => {
    if (f.size > 2_000_000) return setErr('Pick an image under 2 MB so the build can still be saved online.');
    const r = new FileReader();
    r.onload = () => { setErr(''); upd({ url: String(r.result) }); };
    r.readAsDataURL(f);
  };
  return (
    <Shell title="Board background" onClose={onClose}>
      <p className="help" style={{ marginTop: 0 }}>Put a screenshot or base plan under your build. It moves and zooms with the board and is saved with the build.</p>
      <div className="field">
        <label htmlFor="bg-url">Image link</label>
        <div className="linkbox">
          <input id="bg-url" className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" onClick={() => url.trim() && upd({ url: url.trim() })}>Use link</button>
        </div>
      </div>
      <div className="btnrow" style={{ marginBottom: 12 }}>
        <label className="btn"><Ic.open />Upload image<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        {bg && <button className="btn danger" onClick={() => setBg(null)}><Ic.trash />Remove background</button>}
      </div>
      {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
      {bg && (
        <>
          <div className="field"><label className="lv"><span>Opacity</span><b>{Math.round(cur.opacity * 100)}%</b></label><input type="range" min={0.05} max={1} step={0.05} value={cur.opacity} onChange={(e) => upd({ opacity: Number(e.target.value) })} /></div>
          <div className="field"><label className="lv"><span>Width on the board</span><b>{Math.round(cur.w / 24)} m</b></label><input type="range" min={240} max={9600} step={24} value={cur.w} onChange={(e) => upd({ w: Number(e.target.value) })} /></div>
          <div className="field"><label className="lv"><span>Left / right</span><b>{Math.round(cur.x / 24)} m</b></label><input type="range" min={-4800} max={4800} step={24} value={cur.x} onChange={(e) => upd({ x: Number(e.target.value) })} /></div>
          <div className="field"><label className="lv"><span>Up / down</span><b>{Math.round(cur.y / 24)} m</b></label><input type="range" min={-4800} max={4800} step={24} value={cur.y} onChange={(e) => upd({ y: Number(e.target.value) })} /></div>
        </>
      )}
    </Shell>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Shell title="How Rustwire Lab works" onClose={onClose} wide>
      <ul className="tips" style={{ display: 'grid', gap: 8, fontSize: 14 }}>
        <li><b>Power</b> flows from generators and batteries along wires. Since the 2024 electricity update, branches, splitters, switches, buttons, timers and logic gates use no power. Lights, sensors and devices still do.</li>
        <li><b>Root combiners</b> only take power straight from generators, solar panels, batteries, splitters, pressure pads, reactive targets or other combiners. They short out (Max Depth) beyond 16 components from the source and never recombine their own power.</li>
        <li><b>Splitters</b> share power between used outputs; leftover goes to Output 1, then 2 (16 rW → 6/5/5). <b>OR / AND</b> pass the higher input, ties take Input 1.</li>
        <li><b>Batteries</b> charge at 80% from up to 4× their output, drain by what is used downstream, and can’t charge from their own output.</li>
        <li><b>Known Rust bugs</b> are simulated (turn off under World): constant power on a memory cell’s Toggle flips it every update, a memory cell looping into itself through fewer than 8 parts short-circuits, and reactive targets can ghost-pulse counters.</li>
        <li><b>Wire tool</b> (W): click a port, click the board to place corners, click the other port to finish. Turn on straight cables for sharp right-angle runs. Drag a cable end off a port to move or unplug it.</li>
        <li><b>Attachments</b>: industrial crafters attach to workbenches (max 2), storage monitors snap to large boxes and tool cupboards, hoppers attach to containers.</li>
        <li><b>Players</b> are the hazmat tokens: drag them into HBHF range, across lasers, onto pressure pads or into turret range.</li>
        <li><b>Shortcuts</b>: Ctrl+C / Ctrl+V copy and paste parts, Ctrl+Z undo, Ctrl+S save, Space pause, W wire tool, Del remove.</li>
        <li>Item data, recipes and IDs come from RustLabs; icons load from the RustClash wiki. Rustwire Lab is a fan tool, not affiliated with Facepunch.</li>
      </ul>
    </Shell>
  );
}

// ───────── account menu
export function AccountMenu({ user, admin, onLogout, onProfile, onAdmin, onMine }: { user: User | null; admin: boolean; onLogout: () => void; onProfile: () => void; onAdmin: () => void; onMine: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [open]);
  if (!user) return <a className="btn steam" href={cloud.loginUrl()}><SteamLogo /><span className="hide-sm">Sign in</span></a>;
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        {user.avatar ? <img className="avatar" src={user.avatar} alt="" /> : <SteamLogo />}
        <span className="hide-sm">{user.name}</span>
      </button>
      {open && (
        <div className="menu right" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); onProfile(); }}>My profile</button>
          <button role="menuitem" onClick={() => { setOpen(false); onMine(); }}>My online builds</button>
          {admin && <button role="menuitem" onClick={() => { setOpen(false); onAdmin(); }}>Admin</button>}
          <hr />
          <button role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

// ───────── Rustrician import / export
export function RustricianDialog({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const { load, insertDoc, serialize, title } = useStore();
  const [tab, setTab] = useState<'import' | 'export'>('import');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const exp = useMemo(() => (tab === 'export' ? exportRustrician(serialize(), world.current, title) : null), [tab, serialize, title]);
  const run = (mode: 'replace' | 'insert') => {
    setErr('');
    try {
      const r = importRustrician(text);
      if (!r.imported) throw new Error('No parts in that circuit could be imported.');
      if (mode === 'replace') { load(r.doc, {}, r.title); history.replaceState(null, '', '/'); }
      else insertDoc(r.doc);
      const sk = Object.entries(r.skipped);
      toast(`Imported ${r.imported} parts and ${r.wires} wires${sk.length ? `. Skipped: ${sk.map(([k, v]) => `${v}× ${k}`).join(', ')}` : ''}${r.droppedWires ? `, ${r.droppedWires} wires couldn’t be matched` : ''}`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const skipped = exp ? Object.entries(exp.skipped) : [];
  return (
    <Shell title="Rustrician" onClose={onClose} wide>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button aria-pressed={tab === 'import'} onClick={() => setTab('import')}>Import from Rustrician</button>
        <button aria-pressed={tab === 'export'} onClick={() => setTab('export')}>Export to Rustrician</button>
      </div>
      {tab === 'import' ? (
        <>
          <p className="help" style={{ marginTop: 0 }}>In Rustrician use Export (XML), then paste it here or load the file. Parts, wires, settings and text labels come across; layouts are spread out to fit our bigger cards.</p>
          <div className="btnrow" style={{ margin: '8px 0' }}>
            <label className="btn"><Ic.open />Load .xml file<input type="file" accept=".xml,text/xml,.txt" hidden onChange={(e) => e.target.files?.[0]?.text().then(setText)} /></label>
          </div>
          <textarea className="input cmd-box" rows={10} placeholder="<mxGraphModel>…" value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} />
          {err && <p className="help" style={{ color: 'var(--alarm)' }}>{err}</p>}
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!text.trim()} onClick={() => run('replace')}>Open as new build</button>
            <button className="btn" disabled={!text.trim()} onClick={() => run('insert')}><Ic.plus />Insert into this build</button>
          </div>
        </>
      ) : exp && (
        <>
          <p className="help" style={{ marginTop: 0 }}>Copy this and use Import in Rustrician. {exp.exported} parts{skipped.length ? `; Rustrician has no ${skipped.map(([k]) => k).join(', ')}, so those are left out` : ''}.</p>
          <textarea className="input cmd-box" rows={12} readOnly value={exp.xml} onFocus={(e) => e.target.select()} />
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => { navigator.clipboard?.writeText(exp.xml).then(() => toast('Rustrician XML copied'), () => toast('Copy blocked by the browser: use Download instead')); }}><Ic.copy />Copy XML</button>
            <button className="btn" onClick={() => download(new Blob([exp.xml], { type: 'text/xml' }), `${(title || 'rustwire-build').replace(/[^\w-]+/g, '_')}.rustrician.xml`)}>Download .xml</button>
          </div>
        </>
      )}
    </Shell>
  );
}

// ───────── PNG / GIF export
export function ImageDialog({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const rf = useReactFlow();
  const title = useStore((s) => s.title);
  const [scale, setScale] = useState(2);
  const [grid, setGrid] = useState(true);
  const [secs, setSecs] = useState(4);
  const [busy, setBusy] = useState<string | null>(null);
  const name = (title || 'rustwire-build').replace(/[^\w-]+/g, '_');
  const bounds = () => {
    const ns = rf.getNodes();
    if (!ns.length) throw new Error('Add something to the board first.');
    return rf.getNodesBounds(ns);
  };
  const png = async () => {
    setBusy('Rendering…');
    try { const r = await exportPng(bounds(), scale, grid, name); toast(`Saved ${r.w}×${r.h} PNG`); onClose(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };
  const gif = async () => {
    if (!useStore.getState().running) useStore.getState().setRunning(true);
    setBusy('Recording 0%');
    try {
      const r = await exportGif(bounds(), { seconds: secs, fps: 8, maxSide: 1400, grid, name, onProgress: (f) => setBusy(`Recording ${Math.round(f * 100)}%`) });
      toast(`Saved ${r.w}×${r.h} GIF, ${r.frames} frames`);
      onClose();
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };
  return (
    <Shell title="Export image" onClose={onClose}>
      <p className="help" style={{ marginTop: 0 }}>Exports the whole layout, not just what’s on screen.</p>
      <label className="check"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />Include the grid</label>
      <h3 className="calc-h">PNG</h3>
      <div className="field">
        <label>Resolution</label>
        <div className="seg">
          {[1, 2, 3, 4].map((s) => <button key={s} aria-pressed={scale === s} onClick={() => setScale(s)}>{s}×</button>)}
        </div>
      </div>
      <button className="btn primary" disabled={!!busy} onClick={png}>Export PNG</button>
      <h3 className="calc-h">Animated GIF</h3>
      <p className="help" style={{ marginTop: 0 }}>Records the running simulation, so you can show power and water flowing.</p>
      <div className="field">
        <label className="lv"><span>Length</span><b>{secs} s</b></label>
        <input type="range" min={1} max={10} step={1} value={secs} onChange={(e) => setSecs(Number(e.target.value))} />
      </div>
      <button className="btn" disabled={!!busy} onClick={gif}>Record GIF</button>
      {busy && <p className="help">{busy}</p>}
    </Shell>
  );
}
