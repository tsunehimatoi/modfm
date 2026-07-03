import { getQuery, createError } from 'h3';
import db from '../../db';
import { getSessionUser } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  const currentFilename = String(query.currentFilename || '').trim();
  const direction = String(query.direction || 'next').trim().toLowerCase();

  const search = String(query.search || '').trim();
  const extensionsRaw = String(query.extensions || '').trim();
  const sort = parseInt(String(query.sort || '0'), 10);
  const mode = parseInt(String(query.mode || '0'), 10);
  const filenamesStr = String(query.filenames || '').trim();
  const channels = String(query.channels || 'all').trim().toLowerCase();
  const size = String(query.size || 'all').trim().toLowerCase();

  if (!currentFilename) {
    throw createError({ statusCode: 400, statusMessage: 'currentFilename is required' });
  }

  let filenames: string[] = [];
  const user = getSessionUser(event);

  if (mode === 2 && (!user || filenamesStr)) {
    // 历史记录模式，直接使用前端传入的有序文件名列表（以保持准确的历史顺序）
    filenames = filenamesStr.split(',').map(f => f.trim()).filter(Boolean);
  } else {
    // 构建 SQL
    let joinClause = '';
    const conditions: string[] = [];
    const params: any[] = [];

    if (mode === 1) {
      // 收藏模式
      if (!user) {
        return { song: null };
      }
      joinClause = 'INNER JOIN favorites f ON songs.id = f.song_id';
      conditions.push('f.user_id = ?');
      params.push(user.id);
    } else if (mode === 2 && user) {
      // 历史模式（已登录）
      joinClause = 'INNER JOIN play_history h ON songs.id = h.song_id';
      conditions.push('h.user_id = ?');
      params.push(user.id);
    }

    if (search) {
      conditions.push('(songs.filename LIKE ? OR songs.title LIKE ? OR songs.message LIKE ? OR songs.instruments LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (extensionsRaw) {
      const extList = extensionsRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      if (extList.length > 0) {
        const placeholders = extList.map(() => '?').join(',');
        conditions.push(`songs.extension IN (${placeholders})`);
        params.push(...extList);
      }
    }

    if (channels !== 'all') {
      if (channels === '4') {
        conditions.push('songs.channels = 4');
      } else if (channels === '8') {
        conditions.push('songs.channels = 8');
      } else if (channels === 'multi') {
        conditions.push('songs.channels > 8');
      }
    }

    if (size !== 'all') {
      if (size === 'small') {
        conditions.push('songs.file_size < 102400');
      } else if (size === 'medium') {
        conditions.push('songs.file_size >= 102400 AND songs.file_size <= 1048576');
      } else if (size === 'large') {
        conditions.push('songs.file_size > 1048576');
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 同步 songs.get.ts 的排序逻辑
    let orderBy = 'ORDER BY songs.id ASC';
    if (sort === 0) {
      if (mode === 1) {
        orderBy = 'ORDER BY f.created_at DESC';
      } else if (mode === 2 && user) {
        orderBy = 'ORDER BY h.played_at DESC';
      } else {
        orderBy = 'ORDER BY songs.id ASC';
      }
    } else {
      switch (sort) {
        case 1:
          orderBy = 'ORDER BY songs.id DESC';
          break;
        case 2:
          orderBy = 'ORDER BY songs.title COLLATE NOCASE ASC';
          break;
        case 3:
          orderBy = 'ORDER BY songs.title COLLATE NOCASE DESC';
          break;
        case 4:
          orderBy = 'ORDER BY songs.filename COLLATE NOCASE ASC';
          break;
        case 5:
          orderBy = 'ORDER BY songs.filename COLLATE NOCASE DESC';
          break;
        case 6:
          orderBy = 'ORDER BY songs.file_size ASC';
          break;
        case 7:
          orderBy = 'ORDER BY songs.file_size DESC';
          break;
        case 8:
          orderBy = 'ORDER BY songs.file_mtime ASC';
          break;
        case 9:
          orderBy = 'ORDER BY songs.file_mtime DESC';
          break;
        default:
          orderBy = 'ORDER BY songs.id ASC';
          break;
      }
    }

    const sql = `SELECT songs.filename FROM songs ${joinClause} ${whereClause} ${orderBy}`;
    const result = db.prepare(sql).all(...params) as Array<{ filename: string }>;
    filenames = result.map(r => r.filename);
  }

  if (filenames.length === 0) {
    return { song: null };
  }

  // 2. 在有序数组中寻找当前歌曲的位置
  const currentIndex = filenames.indexOf(currentFilename);
  if (currentIndex === -1) {
    // 如果当前播放的歌曲不在列表中（可能是因为刚刚切换了搜索/过滤条件）
    // 那我们默认返回列表中的第一首
    const targetFilename = filenames[0]!;
    const song = db.prepare('SELECT id, filename as fn, title, artist, extension, playable, tracker_format, channels, tracker_name, message, instruments, metadata FROM songs WHERE filename = ?').get(targetFilename);
    return { song };
  }

  // 3. 计算相邻歌曲索引
  let targetIndex = -1;
  if (direction === 'next') {
    targetIndex = currentIndex + 1;
    // 如果是最后一首，可以循环播放到第一首，或者根据需要返回 null 停止
    if (targetIndex >= filenames.length) {
      targetIndex = 0; // 循环
    }
  } else {
    targetIndex = currentIndex - 1;
    if (targetIndex < 0) {
      targetIndex = filenames.length - 1; // 循环到最后一首
    }
  }

  const targetFilename = filenames[targetIndex]!;
  const song = db.prepare('SELECT id, filename as fn, title, artist, extension, playable, tracker_format, channels, tracker_name, message, instruments, metadata FROM songs WHERE filename = ?').get(targetFilename);

  return { song };
});
