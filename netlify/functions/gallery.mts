import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { readSession, json, isAdmin } from '../lib/session.mts';

async function listMetas(prefix: string, q: string) {
  const s = getStore({ name: 'saves', consistency: 'strong' });
  const { blobs } = await s.list({ prefix });
  const metas = (await Promise.all(blobs.slice(0, 500).map((b) => s.get(b.key, { type: 'json' })))).filter(Boolean) as any[];
  return metas
    .filter((m) => !q || m.title.toLowerCase().includes(q) || (m.author ?? '').toLowerCase().includes(q))
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 200);
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
  const user = await readSession(context);
  const path = url.pathname;

  if (path === '/api/mine') {
    if (!user) return json({ error: 'Sign in with Steam to see your builds.' }, 401);
    return json({ items: await listMetas(`own/${user.sid}/`, q) });
  }
  if (path === '/api/admin/saves') {
    if (!isAdmin(user?.sid)) return json({ error: 'Admins only.' }, 403);
    return json({ items: await listMetas('all/', q) });
  }
  if (path.startsWith('/api/profile/')) {
    const sid = context.params.sid;
    if (!/^\d{17}$/.test(sid ?? '')) return json({ error: 'Unknown profile.' }, 404);
    const profile = await getStore({ name: 'users' }).get(sid!, { type: 'json' });
    if (!profile) return json({ error: 'This player hasn’t signed in to Rustwire Lab yet.' }, 404);
    const self = user?.sid === sid || isAdmin(user?.sid);
    const items = (await listMetas(`own/${sid}/`, q)).filter((m) => self || m.visibility === 'public');
    const { sid: _s, seen: _seen, ...rest } = profile as any;
    void _s; void _seen;
    return json({ profile: { sid, ...rest }, items, self: user?.sid === sid });
  }
  return json({ items: await listMetas('pub/', q) });
};

export const config: Config = { path: ['/api/gallery', '/api/mine', '/api/admin/saves', '/api/profile/:sid'], method: 'GET' };
