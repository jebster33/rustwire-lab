import type { SaveDoc } from '../store';
import { world } from '../sim/world';
import { DEF } from '../sim/defs';

export type User = { sid: string; name: string; avatar: string };
export type Meta = { id: string; title: string; visibility: 'public' | 'private'; author: string; updated: number; icons: string[]; count: number; owner?: string };
export type Profile = { sid: string; name: string; avatar: string };

const KEYS = 'rw.editKeys';
const LOCAL = 'rw.saves';
const AUTOSAVE = 'rw.autosave';

function readJSON<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export const editKeyFor = (id: string) => readJSON<Record<string, string>>(KEYS, {})[id];
export const rememberKey = (id: string, key: string) => writeJSON(KEYS, { ...readJSON<Record<string, string>>(KEYS, {}), [id]: key });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new Error('Could not reach the save server. Check your connection and try again.');
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new Error('Online saves are only available on the deployed site.');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const previewIcons = () => {
  const counts = new Map<string, number>();
  for (const n of Object.values(world.current.nodes)) counts.set(DEF[n.def].icon, (counts.get(DEF[n.def].icon) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s]) => s);
};

export const cloud = {
  me: () => api<{ user: User | null; admin: boolean }>('/api/me').catch(() => ({ user: null, admin: false })),
  logout: () => api('/api/auth/logout', { method: 'POST' }).catch(() => null),
  loginUrl: () => `/api/auth/steam?back=${encodeURIComponent(location.pathname + location.search)}`,
  create: (body: { title: string; visibility: string; author?: string; doc: SaveDoc }) =>
    api<{ id: string; editKey: string; meta: Meta }>('/api/saves', { method: 'POST', body: JSON.stringify({ ...body, icons: previewIcons() }) }),
  update: (id: string, body: { title: string; visibility: string; author?: string; doc: SaveDoc }) =>
    api<{ id: string; meta: Meta }>(`/api/saves/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, icons: previewIcons() }),
      headers: editKeyFor(id) ? { 'x-edit-key': editKeyFor(id) } : {},
    }),
  get: (id: string) =>
    api<Meta & { doc: SaveDoc; canEdit: boolean; mine: boolean; canDelete: boolean }>(`/api/saves/${id}`, { headers: editKeyFor(id) ? { 'x-edit-key': editKeyFor(id) } : {} }),
  patch: (id: string, body: { title?: string; visibility?: string }) =>
    api<{ id: string; meta: Meta }>(`/api/saves/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: editKeyFor(id) ? { 'x-edit-key': editKeyFor(id) } : {} }),
  profile: (sid: string) => api<{ profile: Profile; items: Meta[]; self: boolean }>(`/api/profile/${sid}`),
  adminList: (q = '') => api<{ items: Meta[] }>(`/api/admin/saves?q=${encodeURIComponent(q)}`).then((r) => r.items),
  remove: (id: string) => api(`/api/saves/${id}`, { method: 'DELETE', headers: editKeyFor(id) ? { 'x-edit-key': editKeyFor(id) } : {} }),
  gallery: (q = '') => api<{ items: Meta[] }>(`/api/gallery?q=${encodeURIComponent(q)}`).then((r) => r.items),
  mine: () => api<{ items: Meta[] }>('/api/mine').then((r) => r.items),
};

export type LocalSave = { id: string; title: string; updated: number; doc: SaveDoc; cloudId?: string };
export const local = {
  list: () => Object.values(readJSON<Record<string, LocalSave>>(LOCAL, {})).sort((a, b) => b.updated - a.updated),
  save: (s: LocalSave) => writeJSON(LOCAL, { ...readJSON<Record<string, LocalSave>>(LOCAL, {}), [s.id]: s }),
  remove: (id: string) => {
    const all = readJSON<Record<string, LocalSave>>(LOCAL, {});
    delete all[id];
    writeJSON(LOCAL, all);
  },
  autosave: (title: string, doc: SaveDoc, meta: unknown) => writeJSON(AUTOSAVE, { title, doc, meta, t: Date.now() }),
  restore: () => readJSON<{ title: string; doc: SaveDoc; meta: any } | null>(AUTOSAVE, null),
  /** builds this device owns online (has an edit key for) */
  ownedIds: () => Object.keys(readJSON<Record<string, string>>(KEYS, {})),
};

export function downloadJSON(title: string, doc: SaveDoc) {
  const blob = new Blob([JSON.stringify({ title, ...doc })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w-]+/g, '_') || 'rustwire'}.rustwire.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
