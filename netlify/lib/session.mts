import type { Context } from '@netlify/functions';

export type SessionUser = { sid: string; name: string; avatar: string; exp: number };
const COOKIE = 'rw_session';

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64url');

async function hmac(data: string) {
  const secret = Netlify.env.get('SESSION_SECRET');
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sign(user: Omit<SessionUser, 'exp'>, days = 30) {
  const payload = b64url(enc.encode(JSON.stringify({ ...user, exp: Date.now() + days * 864e5 })));
  return `${payload}.${await hmac(payload)}`;
}

export async function readSession(context: Context): Promise<SessionUser | null> {
  const raw = context.cookies.get(COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  try {
    if ((await hmac(payload)) !== sig) return null;
    const u = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionUser;
    return u.exp > Date.now() ? u : null;
  } catch {
    return null;
  }
}

export function setSession(context: Context, value: string) {
  context.cookies.set({ name: COOKIE, value, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: new Date(Date.now() + 30 * 864e5) });
}
export function clearSession(context: Context) {
  context.cookies.delete({ name: COOKIE, path: '/' });
}

export async function sha256(s: string) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
export function randomId(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

/** Steam IDs with admin rights. Checked server-side against the signed session only. */
const DEFAULT_ADMINS = ['76561199605311033'];
export function isAdmin(sid?: string | null) {
  if (!sid) return false;
  const extra = (Netlify.env.get('ADMIN_STEAMIDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ADMINS, ...extra].includes(sid);
}
