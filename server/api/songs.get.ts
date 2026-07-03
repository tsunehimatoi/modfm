import { getQuery } from 'h3';
import db from '../db';
import { getSessionUser } from '../utils/auth';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  
  const page = Math.max(1, parseInt(String(query.page || '1'), 10));
  const limit = Math.max(1, parseInt(String(query.limit || '100'), 10));
  const search = String(query.search || '').trim();
  const extensionsRaw = String(query.extensions || '').trim();
  const sort = parseInt(String(query.sort || '0'), 10);
  const mode = parseInt(String(query.mode || '0'), 10);
  const filenamesStr = String(query.filenames || '').trim();
  const channels = String(query.channels || 'all').trim().toLowerCase();
  const size = String(query.size || 'all').trim().toLowerCase();
  const trackerName = String(query.tracker_name || '').trim();

  // 构建 SQL 查询条件和绑定参数
  let joinClause = '';
  const conditions: string[] = [];
  const params: any[] = [];

  const user = getSessionUser(event);

  // 1. 根据模式筛选 (全部 / 收藏 / 历史)
  if (mode === 1) {
    // 收藏模式
    if (!user) {
      return { songs: [], total: 0, page, limit, totalPages: 0 };
    }
    joinClause = 'INNER JOIN favorites f ON songs.id = f.song_id';
    conditions.push('f.user_id = ?');
    params.push(user.id);
  } else if (mode === 2) {
    // 历史模式
    if (user) {
      // 已登录用户，拉取云端历史
      joinClause = 'INNER JOIN play_history h ON songs.id = h.song_id';
      conditions.push('h.user_id = ?');
      params.push(user.id);
    } else {
      // 未登录用户，通过传入的文件名列表拉取
      if (!filenamesStr) {
        return { songs: [], total: 0, page, limit, totalPages: 0 };
      }
      const historyFilenames = filenamesStr.split(',').map(f => f.trim()).filter(Boolean);
      if (historyFilenames.length === 0) {
        return { songs: [], total: 0, page, limit, totalPages: 0 };
      }
      
      const placeholders = historyFilenames.map(() => '?').join(',');
      conditions.push(`songs.filename IN (${placeholders})`);
      params.push(...historyFilenames);
    }
  }

  // 2. 搜索条件（支持文件名、歌曲标题和元数据乐器模糊匹配）
  if (search) {
    conditions.push('(songs.filename LIKE ? OR songs.title LIKE ? OR songs.message LIKE ? OR songs.instruments LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  // 3. 多选格式筛选（逗号分隔扩展名列表，空字符串表示不限制）
  if (extensionsRaw) {
    const extList = extensionsRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (extList.length > 0) {
      const placeholders = extList.map(() => '?').join(',');
      conditions.push(`songs.extension IN (${placeholders})`);
      params.push(...extList);
    }
  }

  // 4.1. 通道数筛选
  if (channels !== 'all') {
    if (channels === '4') {
      conditions.push('songs.channels = 4');
    } else if (channels === '8') {
      conditions.push('songs.channels = 8');
    } else if (channels === 'multi') {
      conditions.push('songs.channels > 8');
    }
  }

  // 4.2. 文件大小筛选
  if (size !== 'all') {
    if (size === 'small') {
      conditions.push('songs.file_size < 102400'); // < 100KB
    } else if (size === 'medium') {
      conditions.push('songs.file_size >= 102400 AND songs.file_size <= 1048576'); // 100KB - 1MB
    } else if (size === 'large') {
      conditions.push('songs.file_size > 1048576'); // > 1MB
    }
  }

  // 4.3. Tracker Name 筛选
  if (trackerName && trackerName !== 'all') {
    conditions.push('songs.tracker_name LIKE ?');
    params.push(`%${trackerName}%`);
  }

  // 组装 WHERE 语句
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 5. 排序方式
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

  // 执行 COUNT 获取总条数
  const countSql = `SELECT COUNT(*) as count FROM songs ${joinClause} ${whereClause}`;
  const countResult = db.prepare(countSql).get(...params) as { count: number };
  const total = countResult.count;
  const totalPages = Math.ceil(total / limit);

  // 执行分页数据查询
  const offset = (page - 1) * limit;
  const dataSql = `SELECT songs.id, songs.filename as fn, songs.title, songs.artist, songs.extension, songs.file_size, songs.file_mtime, songs.playable, songs.tracker_format, songs.channels, songs.tracker_name, songs.message, songs.instruments, songs.metadata 
                   FROM songs ${joinClause} ${whereClause} ${orderBy} LIMIT ? OFFSET ?`;
  
  const songs = db.prepare(dataSql).all(...params, limit, offset) as any[];

  // 如果是历史模式且未登录，根据前端传入的文件名顺序重新对结果进行排序，以便保持历史播放的时间先后顺序
  if (mode === 2 && !user && filenamesStr) {
    const historyFilenames = filenamesStr.split(',').map(f => f.trim()).filter(Boolean);
    const songMap = new Map<string, any>();
    for (const song of songs) {
      songMap.set(song.fn, song);
    }
    const sortedSongs: any[] = [];
    for (const fn of historyFilenames) {
      const song = songMap.get(fn);
      if (song) {
        sortedSongs.push(song);
      }
    }
    return {
      songs: sortedSongs,
      total,
      page,
      limit,
      totalPages
    };
  }

  return {
    songs,
    total,
    page,
    limit,
    totalPages
  };
});
