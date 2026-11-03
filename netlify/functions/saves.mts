import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { readSession, sha256, randomId, json } from '../lib/session.mts';

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
type Meta = Pick<SaveRecord, 'id' | 'title' | 'visibility' | 'author' | 'updated' | 'icons' | 'count'>;

const MAX_BYTES = 3_000_000;
const store = () => getStore({ name: 'saves', consistency: 'strong' });
const metaOf = (r: SaveRecord): Meta => ({ id: r.id, title: r.title, visibility: r.visibility, author: r.author, updated: r.updated, icons: r.icons, count: r.count });

function clean(body: any) {
  const title = String(body?.title ?? 'Untitled base').slice(0, 80).trim() || 'Untitled base';
  const visibility = body?.visibility === 'public' ? 'public' : 'private';
  const author = String(body?.author ?? '').slice(0, 40).trim();
  const doc = body?.doc;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.nodes)) throw new Error('Missing build data');
  const icons: string[] = Array.isArray(body?.icons) ? body.icons.slice(0, 6).map((s: unknown) => String(s).slice(0, 60)) : [];
  return { title, visibility, author, doc, icons, count: doc.nodes.length as number };
}

async function writeIndexes(r: SaveRecord, prev?: SaveRecord) {
  const s = store();
  if (r.visibility === 'public') await s.setJSON(`pub/${r.id}`, metaOf(r));
  else if (prev?.visibility === 'public') await s.delete(`pub/${r.id}`);
  if (r.ownerSteam) await s.setJSON(`own/${r.ownerSteam}/${r.id}`, metaOf(r));
}

export default async (req: Request, context: Context) => {
  const s = store();
  const id = context.params.id;
  const user = await readSession(context);

  if (req.method === 'POST' && !id) {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'This build is too large to save online (3 MB max).' }, 413);
    let body;
    try { body = clean(JSON.parse(text)); } catch (e) { return json({ error: (e as Error).message || 'Invalid save' }, 400); }
    const newId = randomId(10);
    const editKey = randomId(28);
    const now = Date.now();
    const rec: SaveRecord = {
      id: newId, ...body, author: body.author || user?.name || 'Anonymous',
      ownerSteam: user?.sid, editHash: await sha256(editKey), created: now, updated: now,
    };
    await s.setJSON(`s/${newId}`, rec, { onlyIfNew: true });
    await writeIndexes(rec);
    return json({ id: newId, editKey, meta: metaOf(rec) }, 201);
  }

  if (!id) return json({ error: 'Not found' }, 404);
  const rec = (await s.get(`s/${id}`, { type: 'json' })) as SaveRecord | null;
  if (!rec) return json({ error: 'This build no longer exists.' }, 404);

  const key = req.headers.get('x-edit-key');
  const canEdit = (!!key && (await sha256(key)) === rec.editHash) || (!!user && !!rec.ownerSteam && user.sid === rec.ownerSteam);

  if (req.method === 'GET') {
    const { editHash: _h, ownerSteam, ...pub } = rec;
    void _h;
    return json({ ...pub, canEdit, mine: !!user && user.sid === ownerSteam });
  }
  if (!canEdit) return json({ error: 'Only the creator can change this build. Fork it to save your own copy.' }, 403);

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'This build is too large to save online (3 MB max).' }, 413);
    let body;
    try { body = clean(JSON.parse(text)); } catch (e) { return json({ error: (e as Error).message || 'Invalid save' }, 400); }
    const next: SaveRecord = { ...rec, ...body, author: body.author || rec.author, updated: Date.now() };
    if (!next.ownerSteam && user) next.ownerSteam = user.sid;
    await s.setJSON(`s/${id}`, next);
    await writeIndexes(next, rec);
    return json({ id, meta: metaOf(next) });
  }
  if (req.method === 'DELETE') {
    await s.delete(`s/${id}`);
    await s.delete(`pub/${id}`);
    if (rec.ownerSteam) await s.delete(`own/${rec.ownerSteam}/${id}`);
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed' }, 405);
};

export const config: Config = { path: ['/api/saves', '/api/saves/:id'], method: ['GET', 'POST', 'PUT', 'DELETE'] };
