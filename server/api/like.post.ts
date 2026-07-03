import { createError, readBody } from 'h3';
import db from '../db';
import { requireUser } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const user = requireUser(event);
  const body = await readBody(event);
  const name = String(body?.name ?? '').trim();

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'Track name is required.' });
  }

  // 检查歌曲是否存在于 songs 表中
  const song = db.prepare('SELECT id FROM songs WHERE filename = ?').get(name) as { id: number } | undefined;
  if (!song) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found in library.' });
  }

  // 检查是否已经收藏
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND song_id = ?').get(user.id, song.id);

  if (existing) {
    // 取消收藏
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND song_id = ?').run(user.id, song.id);
  } else {
    // 添加收藏
    db.prepare('INSERT INTO favorites (user_id, song_id, created_at) VALUES (?, ?, ?)').run(user.id, song.id, Date.now());
  }

  // 获取最新的收藏列表
  const favRows = db.prepare(`
    SELECT s.filename as fn
    FROM favorites f
    JOIN songs s ON f.song_id = s.id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(user.id) as Array<{ fn: string }>;

  const musicList = favRows.map((row, index) => ({
    fn: row.fn,
    id: index + 1
  }));

  return { ok: true, musicList };
});
