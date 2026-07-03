import bcrypt from 'bcryptjs';
import { createError, readBody } from 'h3';
import db from '../../db';
import { cleanupExpiredSessions, createSession } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');

  if (!username || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Username and password are required.' });
  }

  const user = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; password_hash: string } | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials.' });
  }

  cleanupExpiredSessions();
  createSession(event, user.id);

  return { ok: true, username: user.username, display_name: user.username };
});
