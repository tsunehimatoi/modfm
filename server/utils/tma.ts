import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import db from '../db';

const MUSIC_BASE_PATH = '/nvme1/collectedmod';

/**
 * 异步计算本地文件的 MD5 哈希值
 */
export function calculateFileMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

/**
 * 播放歌曲时在后台触发的 TMA 元数据获取与存储任务。
 * 具有严格的防滥用限制：
 * 1. 相同 song_id 已有记录时绝不再请求。
 * 2. 自然月请求总次数严格限制在 20000 次以内。
 * 3. 对同哈希（MD5）数据自动复用，免去重复网络请求。
 * 4. 对于在 TMA 上未找到的歌曲，在本地建立空记录占位，防止今后重复请求。
 */
export async function fetchAndStoreTmaDataForSong(filename: string): Promise<void> {
  try {
    // 0. 校验元数据获取开关：只有当明确配置为 true 时才启用抓取
    let runtimeEnableFetch = false;
    try {
      const config = useRuntimeConfig();
      if (config && config.tmaEnableFetch === true) {
        runtimeEnableFetch = true;
      }
    } catch (e) {}

    const enableFetch = process.env.TMA_ENABLE_FETCH === 'true' || runtimeEnableFetch;
    if (!enableFetch) {
      return;
    }

    // 1. 获取歌曲数据库记录
    const song = db.prepare('SELECT id, filename, md5 FROM songs WHERE filename = ?').get(filename) as { id: number, filename: string, md5: string | null } | undefined;
    if (!song) {
      console.log(`[TMA] Song not found in database: ${filename}`);
      return;
    }

    // 2. 检查本歌曲（song_id）是否已经存有 TMA 记录（包含未找到的占位记录）
    const existing = db.prepare('SELECT id FROM tma_data WHERE song_id = ?').get(song.id);
    if (existing) {
      // 已经有获取记录，按要求跳过，不再请求。
      return;
    }

    // 3. 计算文件 MD5（若未计算）
    let md5 = song.md5;
    const filePath = join(MUSIC_BASE_PATH, filename);
    if (!md5) {
      try {
        md5 = await calculateFileMd5(filePath);
        db.prepare('UPDATE songs SET md5 = ? WHERE id = ?').run(md5, song.id);
      } catch (err) {
        console.error(`[TMA] Failed to calculate MD5 for ${filename}:`, err);
        return;
      }
    }

    // 4. 检查是否有相同哈希（MD5）的其他歌曲已经在 tma_data 表里了
    // 如果有，可以直接克隆这条记录（修改 song_id），不需要向网络发起请求
    const existingByHash = db.prepare('SELECT * FROM tma_data WHERE hash = ? AND tma_id IS NOT NULL LIMIT 1').get(md5) as any;
    if (existingByHash) {
      db.prepare(`
        INSERT INTO tma_data (
          song_id, hash, tma_id, title, filename, format, size, bytes, date, timestamp, 
          tracker_format, channels, instruments, genre_id, genre_text, ratings, license, artist_info, raw_data, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        song.id, md5, existingByHash.tma_id, existingByHash.title, existingByHash.filename, 
        existingByHash.format, existingByHash.size, existingByHash.bytes, existingByHash.date, 
        existingByHash.timestamp, existingByHash.tracker_format, existingByHash.channels, 
        existingByHash.instruments, existingByHash.genre_id, existingByHash.genre_text, 
        existingByHash.ratings, existingByHash.license, existingByHash.artist_info, 
        existingByHash.raw_data, Date.now()
      );
      console.log(`[TMA] Reused metadata for ${filename} from identical MD5 ${md5}`);
      return;
    }

    // 5. 限流检查：限制每月请求次数在 20000 次以内
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const requestCount = db.prepare('SELECT COUNT(*) as count FROM tma_request_log WHERE requested_at >= ?').get(startOfMonth) as { count: number };
    
    if (requestCount.count >= 20000) {
      console.warn(`[TMA] Monthly request limit (20000) reached. Current count: ${requestCount.count}. Skipping request for ${filename}.`);
      return;
    }

    // 6. 获取安全保存在环境变量中的 API KEY
    const apiKey = process.env.TMA_API_KEY || '';
    if (!apiKey || apiKey === 'YOUR_MODARCHIVE_API_KEY_HERE') {
      console.error('[TMA] API key is missing or invalid. Please check TMA_API_KEY inside `.env` config file.');
      return;
    }

    // 7. 发送 API 请求
    const url = `https://api.modarchive.org/xml-tools.php?key=${apiKey}&request=search&type=hash&query=${md5}`;
    console.log(`[TMA] Requesting TMA API for ${filename} (MD5: ${md5})`);
    
    const response = await fetch(url);
    if (!response.ok) {
      // 记录请求失败日志
      db.prepare('INSERT INTO tma_request_log (requested_at, hash, success) VALUES (?, ?, ?)').run(Date.now(), md5, 0);
      throw new Error(`TMA API HTTP Error: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    
    // 写入请求成功日志，算作一次有效请求次数
    db.prepare('INSERT INTO tma_request_log (requested_at, hash, success) VALUES (?, ?, ?)').run(Date.now(), md5, 1);

    // 8. 解析 XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: true,
      trimValues: true,
    });
    const result = parser.parse(xmlText);

    const modarchive = result?.modarchive;
    const resultsCount = parseInt(modarchive?.results || '0', 10);

    // 如果未找到任何匹配记录
    if (resultsCount === 0 || !modarchive?.module) {
      // 在本地建立空占位记录，标志已获取过，避免下一次播放此小众歌曲时再次发起请求
      db.prepare(`
        INSERT INTO tma_data (song_id, hash, fetched_at)
        VALUES (?, ?, ?)
      `).run(song.id, md5, Date.now());
      console.log(`[TMA] No metadata found on TMA for ${filename} (${md5}). Recorded as null placeholder.`);
      return;
    }

    const mod = modarchive.module;

    // 格式化需要的数据（剔除赞助商 sponsor）
    const ratings = mod.overall_ratings ? JSON.stringify(mod.overall_ratings) : null;
    const license = mod.license ? JSON.stringify(mod.license) : null;
    const artistInfo = mod.artist_info ? JSON.stringify(mod.artist_info) : null;
    
    // 清理后的模块原始 JSON
    const rawData = JSON.stringify(mod);

    // 乐器列表可能为多行文本或者空
    const instruments = typeof mod.instruments === 'string' ? mod.instruments : (mod.instruments ? JSON.stringify(mod.instruments) : null);

    // 存库
    db.prepare(`
      INSERT INTO tma_data (
        song_id, hash, tma_id, title, filename, format, size, bytes, date, timestamp, 
        tracker_format, channels, instruments, genre_id, genre_text, ratings, license, artist_info, raw_data, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      song.id,
      md5,
      mod.id || null,
      mod.songtitle || null,
      mod.filename || null,
      mod.format || null,
      mod.size || null,
      mod.bytes || null,
      mod.date || null,
      mod.timestamp || null,
      mod.format || null,
      mod.channels || null,
      instruments,
      mod.genreid || null,
      mod.genretext || null,
      ratings,
      license,
      artistInfo,
      rawData,
      Date.now()
    );

    console.log(`[TMA] Successfully stored metadata for ${filename} (${md5})`);
  } catch (err) {
    console.error(`[TMA] Error fetching TMA data for ${filename}:`, err);
  }
}
