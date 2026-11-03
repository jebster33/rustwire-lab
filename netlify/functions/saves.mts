import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { readSession, sha256, randomId, json, isAdmin } from '../lib/session.mts';

type SaveRecord = {
  id: string;
  title: string;
  visibility: 'public' | 'private';
  author: string;
  ownerSteam?: string;
  editHash: string;
  created: number;
  updated: number;
  icons: string[];
  count: number;
  doc: unknown;
};
type Meta = Pick<SaveRecord, 'id' | 'title' | 'visibility' | 'author' | 'updated' | 'icons' | 'count'> & { owner?: string };

const MAX_BYTES = 3_000_000;
const store = () => getStore({ name: 'saves', consistency: 'strong' });
const metaOf = (r: SaveRecord): Meta => ({ id: r.id, title: r.title, visibility: r.visibility, author: r.author, updated: r.updated, icons: r.icons, count: r.count, owner: r.ownerSteam });

function clean(body: any, partial = false) {
  const out: Record<string, unknown> = {};
  if (!partial || body?.title !== undefined) out.title = String(body?.title ?? '').slice(0, 80).trim() || 'Untitled';
  if (!partial || body?.visibility !== undefined) out.visibility = body?.visibility === 'public' ? 'public' : 'private';
  if (!partial || body?.author !== undefined) out.author = String(body?.author ?? '').slice(0, 40).trim();
  if (!partial || body?.doc !== undefined) {
    const doc = body?.doc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) throw new Error('Missing build data');
    out.doc = doc;
    out.count = doc.nodes.length;
    out.icons = Array.isArray(body?.icons) ? body.icons.slice(0, 6).map((s: unknown) => String(s).slice(0, 60)) : [];
  }
  return out as Partial<SaveRecord>;
}

async function writeIndexes(r: SaveRecord) {
  const s = store();
  const m = metaOf(r);
  await s.setJSON(`all/${r.id}`, m);
  if (r.visibility === 'public') await s.setJSON(`pub/${r.id}`, m);
  else await s.delete(`pub/${r.id}`);
  if (r.ownerSteam) await s.setJSON(`own/${r.ownerSteam}/${r.id}`, m);
}
async function dropIndexes(r: SaveRecord) {
  const s = store();
  await s.delete(`all/${r.id}`);
  await s.delete(`pub/${r.id}`);
  if (r.ownerSteam) await s.delete(`own/${r.ownerSteam}/${r.id}`);
}

export default async (req: Request, context: Context) => {
  const s = store();
  const id = context.params.id;
  const user = await readSession(context);
  const admin = isAdmin(user?.sid);

  if (req.method === 'POST' && !id) {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'This build is too large to save online (3 MB max).' }, 413);
    let body;
    try { body = clean(JSON.parse(text)); } catch (e) { return json({ error: (e as Error).message || 'Invalid save' }, 400); }
    const newId = randomId(10);
    const editKey = randomId(28);
    const now = Date.now();
    const rec = {
      id: newId, ...body, author: body.author || user?.name || 'Anonymous',
      ownerSteam: user?.sid, editHash: await sha256(editKey), created: now, updated: now,
    } as SaveRecord;
    await s.setJSON(`s/${newId}`, rec, { onlyIfNew: true });
    await writeIndexes(rec);
    return json({ id: newId, editKey, meta: metaOf(rec) }, 201);
  }

  if (!id) return json({ error: 'Not found' }, 404);
  const rec = (await s.get(`s/${id}`, { type: 'json' })) as SaveRecord | null;
  if (!rec) return json({ error: 'This build no longer exists.' }, 404);

  const key = req.headers.get('x-edit-key');
  const owner = !!user && !!rec.ownerSteam && user.sid === rec.ownerSteam;
  const canEdit = (!!key && (await sha256(key)) === rec.editHash) || owner;

  if (req.method === 'GET') {
    const { editHash: _h, ownerSteam, ...pub } = rec;
    void _h;
    return json({ ...pub, owner: ownerSteam, canEdit, mine: owner, canDelete: canEdit || admin });
  }
  if (req.method === 'DELETE') {
    if (!canEdit && !admin) return json({ error: 'Only the creator can delete this build.' }, 403);
    await s.delete(`s/${id}`);
    await dropIndexes(rec);
    return json({ ok: true });
  }
  if (req.method === 'PATCH') {
    // visibility / title changes; admins may unpublish anything
    if (!canEdit && !admin) return json({ error: 'Only the creator can change this build.' }, 403);
    let body;
    try { body = clean(await req.json(), true); } catch (e) { return json({ error: (e as Error).message || 'Invalid change' }, 400); }
    const patch = canEdit ? { title: body.title, visibility: body.visibility } : { visibility: body.visibility };
    const next = { ...rec, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updated: Date.now() } as SaveRecord;
    await s.setJSON(`s/${id}`, next);
    await writeIndexes(next);
    return json({ id, meta: metaOf(next) });
  }
  if (!canEdit) return json({ error: 'Only the creator can change this build. Save it as your own copy instead.' }, 403);

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'This build is too large to save online (3 MB max).' }, 413);
    let body;
    try { body = clean(JSON.parse(text)); } catch (e) { return json({ error: (e as Error).message || 'Invalid save' }, 400); }
    const next = { ...rec, ...body, author: body.author || rec.author, updated: Date.now() } as SaveRecord;
    if (!next.ownerSteam && user) next.ownerSteam = user.sid;
    await s.setJSON(`s/${id}`, next);
    await writeIndexes(next);
    return json({ id, meta: metaOf(next) });
  }
  return json({ error: 'Method not allowed' }, 405);
};

export const config: Config = { path: ['/api/saves', '/api/saves/:id'], method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] };
