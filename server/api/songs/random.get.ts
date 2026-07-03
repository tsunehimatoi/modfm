import { getQuery } from 'h3';
import db from '../../db';
import { getSessionUser } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  const search = String(query.search || '').trim();
  const extensionsRaw = String(query.extensions || '').trim();
  const mode = parseInt(String(query.mode || '0'), 10);
  const filenamesStr = String(query.filenames || '').trim();
  const channels = String(query.channels || 'all').trim().toLowerCase();
  const size = String(query.size || 'all').trim().toLowerCase();
  const trackerName = String(query.tracker_name || '').trim();

  const user = getSessionUser(event);
  let joinClause = '';
  const conditions: string[] = [];
  const params: any[] = [];

  // 1. 根据模式筛选
  if (mode === 1) {
    if (!user) {
      return { song: null };
    }
    joinClause = 'INNER JOIN favorites f ON songs.id = f.song_id';
    conditions.push('f.user_id = ?');
    params.push(user.id);
  } else if (mode === 2) {
    if (user) {
      joinClause = 'INNER JOIN play_history h ON songs.id = h.song_id';
      conditions.push('h.user_id = ?');
      params.push(user.id);
    } else {
      if (!filenamesStr) {
        return { song: null };
      }
      const historyFilenames = filenamesStr.split(',').map(f => f.trim()).filter(Boolean);
      if (historyFilenames.length === 0) {
        return { song: null };
      }
      const placeholders = historyFilenames.map(() => '?').join(',');
      conditions.push(`songs.filename IN (${placeholders})`);
      params.push(...historyFilenames);
    }
  }

  // 2. 搜索条件
  if (search) {
    conditions.push('(songs.filename LIKE ? OR songs.title LIKE ? OR songs.message LIKE ? OR songs.instruments LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  // 3. 多选格式筛选
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

  if (trackerName && trackerName !== 'all') {
    conditions.push('songs.tracker_name LIKE ?');
    params.push(`%${trackerName}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `SELECT songs.id, songs.filename as fn, songs.title, songs.artist, songs.extension, songs.file_size, songs.file_mtime, songs.playable, songs.tracker_format, songs.channels, songs.tracker_name, songs.message, songs.instruments, songs.metadata 
               FROM songs ${joinClause} ${whereClause} ORDER BY RANDOM() LIMIT 1`;
  
  const song = db.prepare(sql).get(...params);

  return { song: song || null };
});
