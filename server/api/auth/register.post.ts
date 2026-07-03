import bcrypt from 'bcryptjs';
import { createError, readBody } from 'h3';
import db from '../../db';
import { cleanupExpiredSessions, createSession } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');

  if (username.length < 3 || username.length > 32) {
    throw createError({ statusCode: 400, statusMessage: 'Username must be 3-32 characters.' });
  }
  if (password.length < 6 || password.length > 72) {
    throw createError({ statusCode: 400, statusMessage: 'Password must be 6-72 characters.' });
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username) as { id: number } | undefined;

  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Username already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, passwordHash, Date.now());

  cleanupExpiredSessions();
  createSession(event, Number(result.lastInsertRowid));

  return { ok: true, username, display_name: username };
});
