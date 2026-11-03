import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { readSession, json } from '../lib/session.mts';

export default async (req: Request, context: Context) => {
  const s = getStore({ name: 'saves', consistency: 'strong' });
  const url = new URL(req.url);
  const mine = url.pathname.endsWith('/mine');
  let prefix = 'pub/';
  if (mine) {
    const user = await readSession(context);
    if (!user) return json({ error: 'Sign in with Steam to see your builds.' }, 401);
    prefix = `own/${user.sid}/`;
  }
  const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
  const { blobs } = await s.list({ prefix });
  const metas = (await Promise.all(blobs.slice(0, 400).map((b) => s.get(b.key, { type: 'json' })))).filter(Boolean) as any[];
  const items = metas
    .filter((m) => !q || m.title.toLowerCase().includes(q) || (m.author ?? '').toLowerCase().includes(q))
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 120);
  return json({ items });
};

export const config: Config = { path: ['/api/gallery', '/api/mine'], method: 'GET' };
