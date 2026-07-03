import { createHash, randomBytes } from 'node:crypto';
import { createError, deleteCookie, getCookie, setCookie } from 'h3';
import db from '../db';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function cleanupExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export function createSession(event: any, userId: number) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;

  db.prepare(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(userId, tokenHash, expiresAt);

  setCookie(event, 'session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
}

export function clearAuthSession(event: any) {
  const token = getCookie(event, 'session');
  if (token) {
    const tokenHash = hashToken(token);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }
  deleteCookie(event, 'session', { path: '/' });
}

export type SessionUser = {
  id: number;
  username: string;
  musicList: Array<{ fn: string; id: number }>;
};

export function getSessionUser(event: any): SessionUser | null {
  const token = getCookie(event, 'session');
  if (!token) return null;

  const tokenHash = hashToken(token);
  const now = Date.now();
  const session = db
    .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, now) as { user_id: number } | undefined;

  if (!session) return null;

  const user = db
    .prepare('SELECT id, username FROM users WHERE id = ?')
    .get(session.user_id) as
      | { id: number; username: string }
      | undefined;

  if (!user) {
    return null;
  }

  const favRows = db.prepare(`
    SELECT s.id, s.filename as fn
    FROM favorites f
    JOIN songs s ON f.song_id = s.id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(user.id) as Array<{ id: number; fn: string }>;

  const musicList = favRows.map((row) => ({
    fn: row.fn,
    id: row.id
  }));

  return {
    id: user.id,
    username: user.username,
    musicList
  };
}

export function requireUser(event: any) {
  const user = getSessionUser(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  }
  return user;
}
