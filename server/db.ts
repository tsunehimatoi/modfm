// @ts-expect-error better-sqlite3 does not have builtin types
import Database from 'better-sqlite3';

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

let dataDir = process.env.DB_DATA_DIR;
if (!dataDir) {
  try {
    const config = useRuntimeConfig();
    if (config && config.dbDataDir) {
      dataDir = config.dbDataDir;
    }
  } catch (e) {
    // Ignore error if useRuntimeConfig is not yet available during initialization
  }
}
if (!dataDir) {
  dataDir = join(process.cwd(), 'data');
}
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'app.sqlite'));

try {
  db.exec('ALTER TABLE songs ADD COLUMN artist TEXT');
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec('ALTER TABLE songs ADD COLUMN tracker_name TEXT');
} catch (e) {}

try {
  db.exec('ALTER TABLE songs ADD COLUMN message TEXT');
} catch (e) {}

try {
  db.exec('ALTER TABLE songs ADD COLUMN instruments TEXT');
} catch (e) {}

try {
  db.exec('ALTER TABLE songs ADD COLUMN md5 TEXT');
} catch (e) {}

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    title TEXT,
    artist TEXT,
    extension TEXT,
    file_size INTEGER,
    file_mtime INTEGER,
    playable INTEGER NOT NULL DEFAULT 1,
    tracker_format TEXT,
    channels INTEGER,
    tracker_name TEXT,
    message TEXT,
    instruments TEXT,
    metadata TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_songs_filename ON songs(filename);
  CREATE INDEX IF NOT EXISTS idx_songs_extension ON songs(extension);
  CREATE INDEX IF NOT EXISTS idx_songs_playable ON songs(playable);
  CREATE INDEX IF NOT EXISTS idx_songs_tracker_name ON songs(tracker_name);

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
  );

  CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
  CREATE INDEX IF NOT EXISTS idx_favorites_song_id ON favorites(song_id);

  CREATE TABLE IF NOT EXISTS play_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    played_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE(user_id, song_id)
  );

  CREATE INDEX IF NOT EXISTS idx_play_history_user_id ON play_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);

  CREATE TABLE IF NOT EXISTS tma_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER UNIQUE,
    hash TEXT,
    tma_id INTEGER,
    title TEXT,
    filename TEXT,
    format TEXT,
    size TEXT,
    bytes INTEGER,
    date TEXT,
    timestamp INTEGER,
    tracker_format TEXT,
    channels INTEGER,
    instruments TEXT,
    genre_id INTEGER,
    genre_text TEXT,
    ratings TEXT,
    license TEXT,
    artist_info TEXT,
    raw_data TEXT,
    fetched_at INTEGER NOT NULL,
    FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tma_data_song_id ON tma_data(song_id);
  CREATE INDEX IF NOT EXISTS idx_tma_data_hash ON tma_data(hash);

  CREATE TABLE IF NOT EXISTS tma_request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_at INTEGER NOT NULL,
    hash TEXT NOT NULL,
    success INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tma_request_log_requested_at ON tma_request_log(requested_at);
`);

// 迁移旧的 music_list JSON 字段到 favorites 表，并删除废弃的 music_list 字段
try {
  // 检查 users 表中是否存在 music_list 列
  const info = db.pragma("table_info(users)") as Array<{ name: string }>;
  const hasMusicListColumn = info.some(col => col.name === 'music_list');

  if (hasMusicListColumn) {
    const usersWithOldFavorites = db.prepare(`
      SELECT id, music_list FROM users 
      WHERE music_list IS NOT NULL AND music_list != '[]'
    `).all() as Array<{ id: number; music_list: string }>;

    if (usersWithOldFavorites.length > 0) {
      console.log(`Found ${usersWithOldFavorites.length} users with old favorites. Migrating to favorites table...`);
      
      const insertFavorite = db.prepare(`
        INSERT OR IGNORE INTO favorites (user_id, song_id, created_at)
        VALUES (?, ?, ?)
      `);
      
      const getSongId = db.prepare(`SELECT id FROM songs WHERE filename = ?`);
      
      // 启动事务
      const migrateTx = db.transaction(() => {
        const now = Date.now();
        for (const userRow of usersWithOldFavorites) {
          try {
            const list = JSON.parse(userRow.music_list);
            if (Array.isArray(list)) {
              for (const item of list) {
                const fn = typeof item === 'object' && item !== null ? item.fn : (typeof item === 'string' ? item : null);
                if (fn && typeof fn === 'string') {
                  const song = getSongId.get(fn.trim()) as { id: number } | undefined;
                  if (song) {
                    insertFavorite.run(userRow.id, song.id, now);
                  }
                }
              }
            }
          } catch (err) {
            console.error(`Failed to migrate favorites for user ID ${userRow.id}:`, err);
          }
        }
      });
      
      migrateTx();
      console.log('Favorites migration completed successfully.');
    }

    // 物理删除已经废弃的 music_list 字段
    try {
      db.exec('ALTER TABLE users DROP COLUMN music_list');
      console.log('Successfully dropped obsolete column users.music_list');
    } catch (dropErr) {
      console.error('Failed to drop column users.music_list:', dropErr);
    }
  }
} catch (e) {
  console.error('Error during favorites migration and column cleanup:', e);
}

const count = db.prepare('SELECT COUNT(*) as count FROM songs').get() as { count: number };
if (count.count === 0) {
  import('./utils/scanner').then(({ startScan }) => {
    console.log('Songs table is empty. Starting background music scan...');
    startScan();
  }).catch(err => {
    console.error('Failed to start automatic songs scan:', err);
  });
}

export default db;

