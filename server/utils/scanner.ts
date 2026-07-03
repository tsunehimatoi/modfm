import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import db from '../db';
import { parseMetadata } from './metadata-parser';

// 音乐文件夹的基础路径（优先从环境变量读取，默认指向本地 data/music 目录）
const MUSIC_BASE_PATH = process.env.MUSIC_PATH || join(process.cwd(), 'data/music');

// 支持的前端可播放扩展名
// 所有可播放格式：
// - Tracker 模块（Chiptune3/libopenmpt 原生支持）
// - 现代音频（浏览器原生 <audio> 播放）
// - FFmpeg 可转换格式（引擎3 转 MP3 播放）
const PLAYABLE_EXTENSIONS = new Set([
  // Tracker: BassoonTracker + Chiptune3
  'mod', 'xm',
  // Tracker: Chiptune3 (libopenmpt)
  'it', 's3m', 'umx', 'mptm', 'stm', 'mtm', 'ptm', 'far', 'ult', '669',
  'amf', 'dsm', 'mdl', 'med', 'okt', 'psm', 'dbm', 'imf', 'j2b', 'mo3',
  'gdm', 'stp', 'sfx', 'sfx2', 'itp', 'dtm', 'mt2', 'symmod', 'c67', 'ams', 'stx',
  '667', 'cba', 'digi', 'dmf', 'dsym', 'etx', 'fc', 'fc13', 'fc14', 'fmt', 'ftm',
  'gmc', 'gt2', 'gtk', 'ice', 'ims', 'm15', 'mms', 'mus', 'oxm', 'plm', 'pt36',
  'puma', 'rtm', 'smod', 'st26', 'stk', 'wow', 'xmf', 'mdz', 's3z', 'xmz', 'itz',
  'mptmz', 'mdr',
  // 现代音频：浏览器原生 <audio>
  'ogg', 'mp3', 'wav', 'flac',
  // FFmpeg 可转换通用音频格式（引擎3）
  'aac', 'opus', 'aiff', 'm4a', 'wma', 'ac3', 'dts',
  'ape', 'wv', 'tta', 'mp2', 'amr', 'ra', 'au', 'voc', 'pcm',
  'spx', 'tak', 'cda', 'adpcm', 'gsm', 'vqf', 'ofr', 'mp1',
]);

export interface ScanStatus {
  isScanning: boolean;
  totalFiles: number;
  processedFiles: number;
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
  startTime: number | null;
  endTime: number | null;
  error: string | null;
}

let currentStatus: ScanStatus = {
  isScanning: false,
  totalFiles: 0,
  processedFiles: 0,
  addedCount: 0,
  updatedCount: 0,
  deletedCount: 0,
  skippedCount: 0,
  startTime: null,
  endTime: null,
  error: null
};

// 后台异步执行扫描
export async function runScanAsync(forceRefresh = false) {
  if (currentStatus.isScanning) return;

  currentStatus = {
    isScanning: true,
    totalFiles: 0,
    processedFiles: 0,
    addedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    skippedCount: 0,
    startTime: Date.now(),
    endTime: null,
    error: null
  };

  try {
    // 1. 读取目录下的所有文件
    const files = await readdir(MUSIC_BASE_PATH);
    currentStatus.totalFiles = files.length;

    // 2. 从数据库中拉取所有已存在的歌曲信息，进行增量比对
    const existingSongs = db.prepare('SELECT filename, file_size, file_mtime FROM songs').all() as Array<{
      filename: string;
      file_size: number;
      file_mtime: number;
    }>;
    
    const existingMap = new Map<string, { file_size: number; file_mtime: number }>();
    for (const song of existingSongs) {
      existingMap.set(song.filename, {
        file_size: song.file_size,
        file_mtime: song.file_mtime
      });
    }

    const currentFilesSet = new Set(files);

    // 3. 处理删除的文件
    const toDelete: string[] = [];
    for (const filename of existingMap.keys()) {
      if (!currentFilesSet.has(filename)) {
        toDelete.push(filename);
      }
    }

    if (toDelete.length > 0) {
      const deleteStmt = db.prepare('DELETE FROM songs WHERE filename = ?');
      const deleteTx = db.transaction((names: string[]) => {
        for (const name of names) {
          deleteStmt.run(name);
        }
      });
      deleteTx(toDelete);
      currentStatus.deletedCount = toDelete.length;
    }

    // 4. 并发读取新文件或修改过的文件并批量写入 SQLite
    const concurrency = 100;
    const batchSize = 1000;
    let batch: any[] = [];

    const insertStmt = db.prepare(`
      INSERT INTO songs (filename, title, artist, extension, file_size, file_mtime, playable, tracker_format, channels, tracker_name, message, instruments, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = db.prepare(`
      UPDATE songs SET title = ?, artist = ?, file_size = ?, file_mtime = ?, playable = ?, tracker_format = ?, channels = ?, tracker_name = ?, message = ?, instruments = ?, metadata = ?
      WHERE filename = ?
    `);

    // 批量提交事务
    const commitBatch = db.transaction((items: any[]) => {
      for (const item of items) {
        if (item.action === 'insert') {
          insertStmt.run(
            item.filename,
            item.title,
            item.artist,
            item.extension,
            item.file_size,
            item.file_mtime,
            item.playable,
            item.tracker_format,
            item.channels,
            item.tracker_name,
            item.message,
            item.instruments,
            item.metadata
          );
        } else if (item.action === 'update') {
          updateStmt.run(
            item.title,
            item.artist,
            item.file_size,
            item.file_mtime,
            item.playable,
            item.tracker_format,
            item.channels,
            item.tracker_name,
            item.message,
            item.instruments,
            item.metadata,
            item.filename
          );
        }
      }
    });

    // 线程池队列处理
    let index = 0;
    const workers = Array(concurrency).fill(null).map(async () => {
      while (index < files.length) {
        const i = index++;
        if (i >= files.length) break;
        const filename = files[i];
        if (!filename) continue;

        const filePath = join(MUSIC_BASE_PATH, filename);
        try {
          const stats = await stat(filePath);
          const size = stats.size;
          const mtime = stats.mtimeMs;

          const existing = existingMap.get(filename);

          if (!forceRefresh && existing && existing.file_size === size && Math.abs(existing.file_mtime - mtime) < 1000) {
            // 文件未发生变化，跳过
            currentStatus.skippedCount++;
            continue;
          }

          // 文件新增或修改
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          const playable = PLAYABLE_EXTENSIONS.has(ext) ? 1 : 0;

          const meta = await parseMetadata(filePath, ext);

          const item = {
            action: existing ? 'update' : 'insert',
            filename,
            title: meta.title,
            artist: meta.artist,
            extension: ext,
            file_size: size,
            file_mtime: mtime,
            playable,
            tracker_format: meta.trackerFormat,
            channels: meta.channels,
            tracker_name: meta.trackerName,
            message: meta.message,
            instruments: meta.instruments ? JSON.stringify(meta.instruments) : null,
            metadata: JSON.stringify(meta.metadata)
          };

          batch.push(item);
          if (batch.length >= batchSize) {
            const currentBatch = batch;
            batch = [];
            commitBatch(currentBatch);
            
            const updates = currentBatch.filter(x => x.action === 'update').length;
            const inserts = currentBatch.filter(x => x.action === 'insert').length;
            currentStatus.updatedCount += updates;
            currentStatus.addedCount += inserts;
          }
        } catch (e) {
          console.error(`Error scanning file ${filename}:`, e);
        } finally {
          currentStatus.processedFiles++;
        }
      }
    });

    await Promise.all(workers);

    // 提交剩下的批次
    if (batch.length > 0) {
      commitBatch(batch);
      currentStatus.updatedCount += batch.filter(x => x.action === 'update').length;
      currentStatus.addedCount += batch.filter(x => x.action === 'insert').length;
    }

    currentStatus.endTime = Date.now();
  } catch (error: any) {
    currentStatus.error = error.message || String(error);
    console.error('Scan failed:', error);
  } finally {
    currentStatus.isScanning = false;
  }
}

export function getScanStatus(): ScanStatus {
  return currentStatus;
}

export function startScan(forceRefresh = false) {
  if (currentStatus.isScanning) return;
  // 后台异步执行
  runScanAsync(forceRefresh);
}


