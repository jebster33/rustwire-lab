import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { sign, readSession, setSession, clearSession, json } from '../lib/session.mts';

const STEAM = 'https://steamcommunity.com/openid/login';

async function profile(sid: string) {
  const fallback = { name: `Steam ${sid.slice(-5)}`, avatar: '' };
  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${sid}/?xml=1`, { signal: AbortSignal.timeout(5000) });
    const xml = await res.text();
    const pick = (tag: string) => xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`))?.[1] ?? xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`))?.[1];
    return { name: (pick('steamID') ?? fallback.name).slice(0, 40), avatar: pick('avatarMedium') ?? '' };
  } catch {
    return fallback;
  }
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/api/me') {
    return json({ user: await readSession(context) });
  }
  if (path === '/api/auth/logout') {
    clearSession(context);
    return json({ ok: true });
  }
  if (path === '/api/auth/steam') {
    const back = url.searchParams.get('back') ?? '/';
    const returnTo = new URL('/api/auth/steam/callback', url.origin);
    returnTo.searchParams.set('back', back.startsWith('/') ? back : '/');
    const p = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo.toString(),
      'openid.realm': url.origin,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
    return Response.redirect(`${STEAM}?${p}`, 302);
  }
  if (path === '/api/auth/steam/callback') {
    const back = url.searchParams.get('back') ?? '/';
    const params = new URLSearchParams(url.search);
    const claimed = params.get('openid.claimed_id') ?? '';
    const m = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
    const returnTo = params.get('openid.return_to') ?? '';
    if (!m || params.get('openid.op_endpoint') !== STEAM || !returnTo.startsWith(`${url.origin}/api/auth/steam/callback`)) {
      return Response.redirect(new URL('/?login=failed', url.origin).toString(), 302);
    }
    params.set('openid.mode', 'check_authentication');
    params.delete('back');
    const verify = await fetch(STEAM, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await verify.text();
    if (!/is_valid\s*:\s*true/.test(text)) return Response.redirect(new URL('/?login=failed', url.origin).toString(), 302);
    const sid = m[1];
    const p = await profile(sid);
    await getStore({ name: 'users' }).setJSON(sid, { sid, ...p, seen: Date.now() });
    setSession(context, await sign({ sid, name: p.name, avatar: p.avatar }));
    return new Response(null, { status: 302, headers: { location: new URL(back.startsWith('/') ? back : '/', url.origin).toString() } });
  }
  return json({ error: 'Not found' }, 404);
};

export const config: Config = { path: ['/api/me', '/api/auth/steam', '/api/auth/steam/callback', '/api/auth/logout'] };
