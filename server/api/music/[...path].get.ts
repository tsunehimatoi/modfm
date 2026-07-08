import { readFileSync, statSync } from 'node:fs';
import { basename, join, resolve, normalize } from 'node:path';
import { createError } from 'h3';
import { fetchAndStoreTmaDataForSong } from '../../utils/tma';

// 音乐文件的基础路径
const MUSIC_BASE_PATH = '/nvme1/collectedmod';

export default defineEventHandler(async (event) => {
  try {
    // 获取请求的文件路径
    const params = getRouterParams(event);
    const pathParam = params.path;
    if (!pathParam) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing file path parameter'
      });
    }

    // 构建完整的文件路径
    // 规范化路径以防止路径遍历攻击
    const decodedPath = decodeURIComponent(pathParam);
    const requestedPath = normalize(decodedPath);

    // 当用户请求播放该歌曲时，异步获取并存储该单曲的 TMA 详细数据
    const filename = basename(requestedPath);
    fetchAndStoreTmaDataForSong(filename).catch(err => {
      console.error(`[TMA] Background job error for ${filename} on music request:`, err);
    });
    const fullPath = resolve(join(MUSIC_BASE_PATH, requestedPath));

    // 安全检查：确保请求的路径在基础路径内
    const basePathResolved = resolve(MUSIC_BASE_PATH);
    if (!fullPath.startsWith(basePathResolved)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Access denied: Path traversal detected'
      });
    }

    // 检查文件是否存在
    let stats;
    try {
      stats = statSync(fullPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw createError({
          statusCode: 404,
          statusMessage: 'File not found'
        });
      }
      throw err;
    }

    // 检查是否是文件（不是目录）
    if (!stats.isFile()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Path is not a file'
      });
    }

    // 读取文件内容
    const fileBuffer = readFileSync(fullPath);

    // 根据文件扩展名设置正确的 Content-Type
    const ext = fullPath.split('.').pop()?.toLowerCase();
    const contentTypeMap: Record<string, string> = {
      'mod': 'audio/mod',
      'xm': 'audio/xm',
      'it': 'audio/it',
      's3m': 'audio/s3m',
      'umx': 'audio/umx',
      'mptm': 'audio/x-mod',
      'stm': 'audio/x-mod',
      'mtm': 'audio/x-mod',
      'ptm': 'audio/x-mod',
      'far': 'audio/x-mod',
      'ult': 'audio/x-mod',
      '669': 'audio/x-mod',
      'amf': 'audio/x-mod',
      'dsm': 'audio/x-mod',
      'mdl': 'audio/x-mod',
      'med': 'audio/x-mod',
      'okt': 'audio/x-mod',
      'psm': 'audio/x-mod',
      'dbm': 'audio/x-mod',
      'imf': 'audio/x-mod',
      'j2b': 'audio/x-mod',
      'mo3': 'audio/x-mod',
      'gdm': 'audio/x-mod',
      'stp': 'audio/x-mod',
      'sfx': 'audio/x-mod',
      'sfx2': 'audio/x-mod',
      'itp': 'audio/x-mod',
      'dtm': 'audio/x-mod',
      'mt2': 'audio/x-mod',
      'symmod': 'audio/x-mod',
      'c67': 'audio/x-mod',
      'ams': 'audio/x-mod',
      'stx': 'audio/x-mod',
      '667': 'audio/x-mod',
      'cba': 'audio/x-mod',
      'digi': 'audio/x-mod',
      'dmf': 'audio/x-mod',
      'dsym': 'audio/x-mod',
      'etx': 'audio/x-mod',
      'fc': 'audio/x-mod',
      'fc13': 'audio/x-mod',
      'fc14': 'audio/x-mod',
      'fmt': 'audio/x-mod',
      'ftm': 'audio/x-mod',
      'gmc': 'audio/x-mod',
      'gt2': 'audio/x-mod',
      'gtk': 'audio/x-mod',
      'ice': 'audio/x-mod',
      'ims': 'audio/x-mod',
      'm15': 'audio/x-mod',
      'mms': 'audio/x-mod',
      'mus': 'audio/x-mod',
      'oxm': 'audio/x-mod',
      'plm': 'audio/x-mod',
      'pt36': 'audio/x-mod',
      'puma': 'audio/x-mod',
      'rtm': 'audio/x-mod',
      'smod': 'audio/x-mod',
      'st26': 'audio/x-mod',
      'stk': 'audio/x-mod',
      'wow': 'audio/x-mod',
      'xmf': 'audio/x-mod',
      'mdz': 'audio/x-mod',
      's3z': 'audio/x-mod',
      'xmz': 'audio/x-mod',
      'itz': 'audio/x-mod',
      'mptmz': 'audio/x-mod',
      'mdr': 'audio/x-mod',
      'ogg': 'audio/ogg',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac'
    };

    const contentType = contentTypeMap[ext || ''] || 'application/octet-stream';

    // 设置响应头
    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Content-Length', stats.size);
    setHeader(event, 'Cache-Control', 'public, max-age=3600');
    setHeader(event, 'Accept-Ranges', 'bytes');

    // 支持 Range 请求（用于音频流式播放）
    const rangeHeader = getHeader(event, 'range');
    const rangeValue = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
    if (typeof rangeValue === 'string' && rangeValue.startsWith('bytes=')) {
      const parts = rangeValue.replace(/bytes=/, '').split('-');
      const startText = parts[0] ?? '';
      const endText = parts[1] ?? '';

      let start: number;
      let end: number;

      if (startText === '' && endText !== '') {
        const suffixLength = Math.max(0, parseInt(endText, 10) || 0);
        start = Math.max(0, stats.size - suffixLength);
        end = stats.size - 1;
      } else {
        start = Math.max(0, parseInt(startText, 10) || 0);
        end = endText ? parseInt(endText, 10) || stats.size - 1 : stats.size - 1;
      }

      if (start <= end && start < stats.size) {
        end = Math.min(end, stats.size - 1);
        const chunkSize = end - start + 1;
        const chunk = fileBuffer.slice(start, end + 1);

        setHeader(event, 'Content-Range', `bytes ${start}-${end}/${stats.size}`);
        setHeader(event, 'Content-Length', chunkSize);
        setResponseStatus(event, 206); // Partial Content

        return chunk;
      }
    }

    return fileBuffer;
  } catch (error: any) {
    if (error.statusCode) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Internal server error'
    });
  }
});
