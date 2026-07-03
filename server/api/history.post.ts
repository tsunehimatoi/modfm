import { createError, readBody } from 'h3';
import db from '../db';
import { requireUser } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const user = requireUser(event);
  const body = await readBody(event);
  
  const filename = body?.filename;
  const filenames = body?.filenames;

  let fns: string[] = [];
  if (Array.isArray(filenames)) {
    fns = filenames.map(f => String(f).trim()).filter(Boolean);
  } else if (filename) {
    fns = [String(filename).trim()];
  }

  if (fns.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Filename or filenames are required.' });
  }

  // 准备插入 SQL 语句 (使用 ON CONFLICT 更新 played_at)
  const insertStmt = db.prepare(`
    INSERT INTO play_history (user_id, song_id, played_at)
    SELECT ?, id, ? FROM songs WHERE filename = ?
    ON CONFLICT(user_id, song_id) DO UPDATE SET played_at = excluded.played_at
  `);

  const now = Date.now();

  // 运行事务批量插入
  const runTransaction = db.transaction((filenamesList: string[]) => {
    const len = filenamesList.length;
    // 逆序处理以保持原有播放的时间先后顺序 (最旧的先插入，最新的最后插入)
    for (let i = 0; i < len; i++) {
      const fn = filenamesList[i];
      // 稍微偏移几毫秒/秒以保持顺序
      const playedAt = now - (len - 1 - i) * 1000;
      insertStmt.run(user.id, playedAt, fn);
    }

    // 清理该用户超出 100 条的旧播放历史记录
    db.prepare(`
      DELETE FROM play_history
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM play_history
        WHERE user_id = ?
        ORDER BY played_at DESC
        LIMIT 100
      )
    `).run(user.id, user.id);
  });

  runTransaction(fns);

  return { ok: true };
});
