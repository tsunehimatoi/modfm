import { statSync } from 'node:fs';
import { join, resolve, normalize, basename, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { readFileSync, unlinkSync } from 'node:fs';
import { createError } from 'h3';

const execFileAsync = promisify(execFile);
const CONVERTIBLE_EXTS = new Set(['xm', 'mod', 'it', 's3m', 'umx', 'mptm', 'stm', 'mtm', 'ptm', 'far', 'ult', '669', 'amf', 'dsm', 'mdl', 'med', 'okt', 'psm', 'dbm', 'imf', 'j2b', 'mo3', 'gdm', 'stp', 'sfx', 'sfx2', 'itp', 'dtm', 'mt2', 'symmod', 'c67', 'ams', 'stx', '667', 'cba', 'digi', 'dmf', 'dsym', 'etx', 'fc', 'fc13', 'fc14', 'fmt', 'ftm', 'gmc', 'gt2', 'gtk', 'ice', 'ims', 'm15', 'mms', 'mus', 'oxm', 'plm', 'pt36', 'puma', 'rtm', 'smod', 'st26', 'stk', 'wow', 'xmf', 'mdz', 's3z', 'xmz', 'itz', 'mptmz', 'mdr']);

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const musicBasePath = config.musicPath || process.env.MUSIC_PATH || './data/music';
  const ffmpegPath = config.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';

  const query = getQuery(event);
  const pathParam = query.path as string;

  if (!pathParam) {
    throw createError({ statusCode: 400, statusMessage: 'Missing path parameter' });
  }

  const decodedPath = decodeURIComponent(pathParam);
  const requestedPath = normalize(decodedPath);
  const fullPath = resolve(join(musicBasePath, requestedPath));

  if (!fullPath.startsWith(resolve(musicBasePath))) {
    throw createError({ statusCode: 403, statusMessage: 'Access denied' });
  }

  let stats;
  try {
    stats = statSync(fullPath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }
    throw err;
  }

  if (!stats.isFile()) {
    throw createError({ statusCode: 400, statusMessage: 'Path is not a file' });
  }

  const ext = extname(fullPath).slice(1).toLowerCase();
  // 支持所有 ffmpeg 可处理的音频格式（引擎3：全部转为MP3播放）
  const SUPPORTED_EXTS = new Set([...CONVERTIBLE_EXTS, 'mp3', 'ogg', 'wav', 'flac', 'aac', 'wma', 'm4a', 'opus', 'aiff', 'au', 'ra', 'amr', 'ac3', 'dts', 'tta', 'wv', 'ape', 'mp2', 'mp1', 'voc', 'pcm', 'adpcm', 'gsm', 'vqf', 'tak', 'ofr', 'spx', 'cda']);
  if (!SUPPORTED_EXTS.has(ext)) {
    throw createError({ statusCode: 400, statusMessage: `Cannot convert .${ext} to MP3` });
  }

  const baseName = basename(fullPath, extname(fullPath));
  const tmpOut = join(tmpdir(), `tp_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);

  try {
    await execFileAsync(ffmpegPath, [
      '-y',
      '-i', fullPath,
      '-q:a', '2',
      '-map', 'a',
      tmpOut,
    ], { timeout: 120000 });

    const mp3Buffer = readFileSync(tmpOut);

    setHeader(event, 'Content-Type', 'audio/mpeg');
    setHeader(event, 'Content-Disposition', `attachment; filename="${encodeURIComponent(baseName)}.mp3"`);
    setHeader(event, 'Cache-Control', 'no-store');

    return mp3Buffer;
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: `Conversion failed: ${err.message}` });
  } finally {
    try { unlinkSync(tmpOut); } catch {}
  }
});
