import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';

export interface ParsedMetadata {
  title: string;
  artist: string | null;
  trackerFormat: string | null;
  channels: number | null;
  trackerName: string | null;
  message: string | null;
  instruments: string[] | null;
  metadata: Record<string, any>;
}

// 辅助函数：清理二进制字符串，去除尾部空字符、空白及不可见字符
function cleanString(buffer: Buffer): string {
  let str = buffer.toString('utf8');
  str = str.replace(/\0+$/, '').trim();
  str = str.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  return str;
}

interface Reader {
  read(offset: number, length: number): Buffer;
  readUInt8(offset: number): number;
  readUInt16LE(offset: number): number;
  readUInt32LE(offset: number): number;
}

function createSyncReader(scanBuf: Buffer, fileLength: number): Reader {
  const bufSize = scanBuf.length;
  const read = (offset: number, length: number): Buffer => {
    if (offset >= bufSize) {
      return Buffer.alloc(0);
    }
    const realLength = Math.min(length, bufSize - offset);
    if (realLength <= 0) {
      return Buffer.alloc(0);
    }
    return scanBuf.subarray(offset, offset + realLength);
  };

  return {
    read,
    readUInt8(offset: number): number {
      const b = read(offset, 1);
      return b.length >= 1 ? b.readUInt8(0) : 0;
    },
    readUInt16LE(offset: number): number {
      const b = read(offset, 2);
      return b.length >= 2 ? b.readUInt16LE(0) : 0;
    },
    readUInt32LE(offset: number): number {
      const b = read(offset, 4);
      return b.length >= 4 ? b.readUInt32LE(0) : 0;
    }
  };
}

// 针对不同格式的解析函数
function parseXm(reader: Reader, fileLength: number): ParsedMetadata {
  // 17-36字节为 Song Name
  const titleBuf = reader.read(17, 20);
  const title = cleanString(titleBuf);

  // 37-56字节为 Tracker Name
  const trackerNameBuf = reader.read(37, 20);
  const trackerName = cleanString(trackerNameBuf);

  // 68-69字节为 Channels
  const channels = reader.readUInt16LE(68);
  const numPatterns = reader.readUInt16LE(70);
  const numInstruments = reader.readUInt16LE(72);
  const headerSize = reader.readUInt32LE(60);

  const instruments: string[] = [];
  let message: string | null = null;

  try {
    let offset = 60 + headerSize;
    // 1. 跳过所有 patterns
    for (let p = 0; p < numPatterns; p++) {
      if (offset + 9 > fileLength) break;
      const patHeaderLen = reader.readUInt32LE(offset);
      const patDataSize = reader.readUInt16LE(offset + 7);
      offset += (patHeaderLen > 0 ? patHeaderLen : 9) + patDataSize;
    }

    // 2. 依次读取每个 Instrument Header 并提取 Name
    for (let i = 0; i < numInstruments; i++) {
      if (offset + 29 > fileLength) break;
      const insSize = reader.readUInt32LE(offset);
      const nameBuf = reader.read(offset + 4, 22);
      const name = cleanString(nameBuf);
      const numSamples = reader.readUInt16LE(offset + 27);

      if (name) {
        instruments.push(name);
      }

      // 精准计算并跳过这个 Instrument（含所有 sample headers 和 sample data）
      let nextOffset = offset + insSize;
      if (numSamples > 0 && insSize > 29) {
        const sampleHeaderSize = reader.readUInt32LE(offset + 29);
        let totalSampleDataSize = 0;

        for (let s = 0; s < numSamples; s++) {
          const shOffset = offset + insSize + s * sampleHeaderSize;
          if (shOffset + 4 <= fileLength) {
            const sampleLength = reader.readUInt32LE(shOffset);
            totalSampleDataSize += sampleLength;
          }
        }
        nextOffset = offset + insSize + numSamples * sampleHeaderSize + totalSampleDataSize;
      }
      offset = nextOffset > offset ? nextOffset : offset + 29;
    }

    // 3. 提取尾部 OpenMPT 扩展 Chunks (如 text, CMSG, CNAM, INAM)
    while (offset + 8 <= fileLength) {
      const tagBuf = reader.read(offset, 4);
      if (tagBuf.length < 4) break;
      const tag = tagBuf.toString('ascii');

      // 校验 tag 是否是合法的 4 字符 ASCII（通常为大写字母，或者是 'text'）
      if (!/^[A-Z0-9]{4}$/.test(tag) && tag !== 'text') {
        offset++;
        continue;
      }

      const len = reader.readUInt32LE(offset + 4);
      if (offset + 8 + len > fileLength || len < 0 || len > 1048576) {
        offset++;
        continue;
      }

      const chunkData = reader.read(offset + 8, len);

      if (tag === 'text' || tag === 'CMSG') {
        const msg = cleanString(chunkData);
        if (msg) {
          message = msg;
        }
      }

      offset += 8 + len;
    }
  } catch (e) {
    console.error('Failed to parse XM instruments', e);
  }

  return {
    title,
    artist: null,
    trackerFormat: 'XM',
    channels,
    trackerName,
    message,
    instruments,
    metadata: {}
  };
}

function parseMod(reader: Reader, fileLength: number): ParsedMetadata {
  const titleBuf = reader.read(0, 20);
  const title = cleanString(titleBuf);

  let signature = '';
  if (fileLength >= 1084) {
    const sigBuf = reader.read(1080, 4);
    signature = sigBuf.toString('ascii');
  }
  let channels = 4;

  if (['M.K.', 'M!K!', '4CHN', 'FLT4'].includes(signature)) {
    channels = 4;
  } else if (signature === '6CHN') {
    channels = 6;
  } else if (['8CHN', 'FLT8'].includes(signature)) {
    channels = 8;
  } else if (signature.endsWith('CHN')) {
    const ch = parseInt(signature.substring(0, signature.length - 3), 10);
    if (!isNaN(ch)) channels = ch;
  } else if (signature.endsWith('CH')) {
    const ch = parseInt(signature.substring(0, signature.length - 2), 10);
    if (!isNaN(ch)) channels = ch;
  }

  const instruments: string[] = [];
  try {
    for (let i = 0; i < 31; i++) {
      const offset = 20 + i * 30;
      if (offset + 22 > fileLength) break;
      const nameBuf = reader.read(offset, 22);
      const name = cleanString(nameBuf);
      if (name) {
        instruments.push(name);
      }
    }
  } catch (e) {
    console.error('Failed to parse MOD instruments', e);
  }

  return {
    title,
    artist: null,
    trackerFormat: 'MOD',
    channels,
    trackerName: null,
    message: null,
    instruments,
    metadata: { signature }
  };
}

async function parseIt(reader: Reader, fileLength: number): Promise<ParsedMetadata> {
  const titleBuf = reader.read(4, 26);
  const title = cleanString(titleBuf);

  const channels = fileLength >= 33 ? reader.readUInt8(32) : 0;
  const insNum = fileLength >= 36 ? reader.readUInt16LE(34) : 0;
  const smpNum = fileLength >= 38 ? reader.readUInt16LE(36) : 0;
  const itOrdNum = fileLength >= 34 ? reader.readUInt16LE(32) : 0;

  // 提取 Song Message (留言)
  let message: string | null = null;
  try {
    if (fileLength >= 60) {
      const special = reader.readUInt16LE(0x2c);
      if (special & 1) {
        const msgLength = reader.readUInt16LE(0x36);
        const msgOffset = reader.readUInt32LE(0x38);
        if (msgOffset > 0 && msgLength > 0 && msgOffset + msgLength <= fileLength) {
          const msgBuf = reader.read(msgOffset, msgLength);
          message = cleanString(msgBuf);
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse IT song message', e);
  }

  const instruments: string[] = [];
  try {
    const insPtrOffset = 192 + itOrdNum;
    const smpPtrOffset = insPtrOffset + insNum * 4;

    if (insNum > 0) {
      for (let i = 0; i < insNum; i++) {
        const ptrIdx = insPtrOffset + i * 4;
        if (ptrIdx + 4 > fileLength) break;
        const offset = reader.readUInt32LE(ptrIdx);
        if (offset > 0 && offset + 64 <= fileLength) {
          const nameBuf = reader.read(offset + 32, 32);
          const name = cleanString(nameBuf);
          if (name) instruments.push(name);
        }
      }
    }

    for (let i = 0; i < smpNum; i++) {
      const ptrIdx = smpPtrOffset + i * 4;
      if (ptrIdx + 4 > fileLength) break;
      const offset = reader.readUInt32LE(ptrIdx);
      if (offset > 0 && offset + 52 <= fileLength) {
        const nameBuf = reader.read(offset + 20, 32);
        const name = cleanString(nameBuf);
        if (name && !instruments.includes(name)) {
          instruments.push(name);
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse IT instruments', e);
  }

  return {
    title,
    artist: null,
    trackerFormat: 'IT',
    channels,
    trackerName: 'Impulse Tracker',
    message,
    instruments,
    metadata: {}
  };
}

function parseS3m(reader: Reader, fileLength: number): ParsedMetadata {
  const titleBuf = reader.read(0, 28);
  const title = cleanString(titleBuf);

  let signature = '';
  if (fileLength >= 48) {
    const sigBuf = reader.read(44, 4);
    signature = sigBuf.toString('ascii');
  }
  const insNum = fileLength >= 36 ? reader.readUInt16LE(34) : 0;
  const ordNum = fileLength >= 34 ? reader.readUInt16LE(32) : 0;

  const instruments: string[] = [];
  try {
    const insPtrOffset = 96 + ordNum;

    for (let i = 0; i < insNum; i++) {
      const ptrIdx = insPtrOffset + i * 2;
      if (ptrIdx + 2 > fileLength) break;
      const parapointer = reader.readUInt16LE(ptrIdx);
      const realOffset = parapointer * 16;

      if (realOffset > 0 && realOffset + 76 <= fileLength) {
        const nameBuf = reader.read(realOffset + 48, 28);
        const name = cleanString(nameBuf);
        if (name) instruments.push(name);
      }
    }
  } catch (e) {
    console.error('Failed to parse S3M instruments', e);
  }

  return {
    title,
    artist: null,
    trackerFormat: 'S3M',
    channels: null,
    trackerName: signature === 'SCRM' ? 'Scream Tracker 3' : null,
    message: null,
    instruments,
    metadata: { signature }
  };
}

// 提取 MP3 元数据 (ID3v1 和 ID3v2 标题/注释简易解析)
async function parseMp3(fd: any, fileLength: number): Promise<ParsedMetadata> {
  let title = '';
  let artist = '';
  let message: string | null = null;
  const metadata: Record<string, any> = {};

  const headerSize = Math.min(8192, fileLength);
  if (headerSize > 10) {
    const header = Buffer.alloc(headerSize);
    await fd.read(header, 0, headerSize, 0);

    if (header.subarray(0, 3).toString('ascii') === 'ID3') {
      metadata.hasId3v2 = true;

      // 1. 查找标题 TIT2 帧
      const tit2Idx = header.indexOf('TIT2');
      if (tit2Idx !== -1 && tit2Idx + 10 < headerSize) {
        const frameSize = header.readUInt32BE(tit2Idx + 4);
        const encoding = header.readUInt8(tit2Idx + 10);
        const textStart = tit2Idx + 11;
        if (textStart + frameSize - 1 <= headerSize && frameSize > 1) {
          const textBuf = header.subarray(textStart, textStart + frameSize - 1);
          if (encoding === 0) {
            title = cleanString(textBuf);
          } else if (encoding === 1 || encoding === 2) {
            title = textBuf.toString('utf16le');
            title = title.replace(/^\ufeff/, '').replace(/\0+$/, '').trim();
          } else if (encoding === 3) {
            title = cleanString(textBuf);
          }
        }
      }

      // 2. 查找作者 TPE1 帧
      const tpe1Idx = header.indexOf('TPE1');
      if (tpe1Idx !== -1 && tpe1Idx + 10 < headerSize) {
        const frameSize = header.readUInt32BE(tpe1Idx + 4);
        const encoding = header.readUInt8(tpe1Idx + 10);
        const textStart = tpe1Idx + 11;
        if (textStart + frameSize - 1 <= headerSize && frameSize > 1) {
          const textBuf = header.subarray(textStart, textStart + frameSize - 1);
          if (encoding === 0) {
            artist = cleanString(textBuf);
          } else if (encoding === 1 || encoding === 2) {
            artist = textBuf.toString('utf16le');
            artist = artist.replace(/^\ufeff/, '').replace(/\0+$/, '').trim();
          } else if (encoding === 3) {
            artist = cleanString(textBuf);
          }
        }
      }

      // 3. 查找留言 COMM 帧
      const commIdx = header.indexOf('COMM');
      if (commIdx !== -1 && commIdx + 10 < headerSize) {
        const frameSize = header.readUInt32BE(commIdx + 4);
        const encoding = header.readUInt8(commIdx + 10);
        const textStart = commIdx + 11;
        if (textStart + frameSize - 1 <= headerSize && frameSize > 4) {
          const textBuf = header.subarray(textStart + 3, textStart + frameSize - 1);
          let actualStart = 0;
          if (encoding === 0 || encoding === 3) {
            const descEnd = textBuf.indexOf(0);
            if (descEnd !== -1) actualStart = descEnd + 1;
            message = cleanString(textBuf.subarray(actualStart));
          } else {
            let descEnd = -1;
            for (let j = 0; j < textBuf.length - 1; j += 2) {
              if (textBuf[j] === 0 && textBuf[j+1] === 0) {
                descEnd = j;
                break;
              }
            }
            if (descEnd !== -1) actualStart = descEnd + 2;
            message = textBuf.subarray(actualStart).toString('utf16le');
            message = message.replace(/^\ufeff/, '').replace(/\0+$/, '').trim();
          }
        }
      }
    }
  }

  if (fileLength > 128) {
    const footer = Buffer.alloc(128);
    await fd.read(footer, 0, 128, fileLength - 128);

    if (footer.subarray(0, 3).toString('ascii') === 'TAG') {
      metadata.hasId3v1 = true;
      if (!title) {
        const titleBuf = footer.subarray(3, 33);
        title = cleanString(titleBuf);
      }
      const artistBuf = footer.subarray(33, 63);
      const artistV1 = cleanString(artistBuf);
      if (artistV1) {
        metadata.artist = artistV1;
        if (!artist) {
          artist = artistV1;
        }
      }
      // ID3v1 留言在偏移 97 到 126
      if (!message) {
        const commentBuf = footer.subarray(97, 127);
        message = cleanString(commentBuf);
      }
    }
  }

  return {
    title,
    artist: artist || null,
    trackerFormat: 'MP3',
    channels: null,
    trackerName: null,
    message,
    instruments: null,
    metadata
  };
}

// 提取 OGG/FLAC/WAV 元数据 (检索前 8KB)
async function parseGenericAudio(fd: any, fileLength: number, format: string): Promise<ParsedMetadata> {
  let title = '';
  let artist = '';
  let message: string | null = null;
  const scanSize = Math.min(8192, fileLength);
  if (scanSize > 10) {
    const buf = Buffer.alloc(scanSize);
    await fd.read(buf, 0, scanSize, 0);

    // 1. WAV INFO List INAM / IART / ICMT 查找
    if (format === 'WAV') {
      const inamIdx = buf.indexOf('INAM');
      if (inamIdx !== -1 && inamIdx + 8 < scanSize) {
        const size = buf.readUInt32LE(inamIdx + 4);
        if (inamIdx + 8 + size <= scanSize && size > 0) {
          title = cleanString(buf.subarray(inamIdx + 8, inamIdx + 8 + size));
        }
      }

      const iartIdx = buf.indexOf('IART');
      if (iartIdx !== -1 && iartIdx + 8 < scanSize) {
        const size = buf.readUInt32LE(iartIdx + 4);
        if (iartIdx + 8 + size <= scanSize && size > 0) {
          artist = cleanString(buf.subarray(iartIdx + 8, iartIdx + 8 + size));
        }
      }

      const icmtIdx = buf.indexOf('ICMT');
      if (icmtIdx !== -1 && icmtIdx + 8 < scanSize) {
        const size = buf.readUInt32LE(icmtIdx + 4);
        if (icmtIdx + 8 + size <= scanSize && size > 0) {
          message = cleanString(buf.subarray(icmtIdx + 8, icmtIdx + 8 + size));
        }
      }
    }

    // 2. OGG/FLAC Vorbis Comment TITLE / ARTIST / COMMENT / DESCRIPTION 查找
    if (['OGG', 'FLAC'].includes(format)) {
      // 2.1 查找标题
      let titleIdx = buf.indexOf('TITLE=');
      if (titleIdx === -1) {
        titleIdx = buf.indexOf('title=');
      }
      if (titleIdx !== -1 && titleIdx + 6 < scanSize) {
        const textBuf = buf.subarray(titleIdx + 6);
        let endIdx = 0;
        while (endIdx < textBuf.length) {
          const charCode = textBuf[endIdx];
          if (charCode === undefined || charCode < 32 || charCode >= 127) {
            break;
          }
          endIdx++;
        }
        title = cleanString(textBuf.subarray(0, endIdx));
      }

      // 2.2 查找作者
      let artistIdx = buf.indexOf('ARTIST=');
      let prefixLen = 7;
      if (artistIdx === -1) {
        artistIdx = buf.indexOf('artist=');
        prefixLen = 7;
      }
      if (artistIdx === -1) {
        artistIdx = buf.indexOf('PERFORMER=');
        prefixLen = 10;
      }
      if (artistIdx === -1) {
        artistIdx = buf.indexOf('performer=');
        prefixLen = 10;
      }
      if (artistIdx !== -1 && artistIdx + prefixLen < scanSize) {
        const textBuf = buf.subarray(artistIdx + prefixLen);
        let endIdx = 0;
        while (endIdx < textBuf.length) {
          const charCode = textBuf[endIdx];
          if (charCode === undefined || charCode < 32 || charCode >= 127) {
            break;
          }
          endIdx++;
        }
        artist = cleanString(textBuf.subarray(0, endIdx));
      }

      // 2.3 查找留言 (COMMENT 或 DESCRIPTION)
      let commIdx = buf.indexOf('COMMENT=');
      let commPrefix = 8;
      if (commIdx === -1) {
        commIdx = buf.indexOf('comment=');
        commPrefix = 8;
      }
      if (commIdx === -1) {
        commIdx = buf.indexOf('DESCRIPTION=');
        commPrefix = 12;
      }
      if (commIdx === -1) {
        commIdx = buf.indexOf('description=');
        commPrefix = 12;
      }
      if (commIdx !== -1 && commIdx + commPrefix < scanSize) {
        const textBuf = buf.subarray(commIdx + commPrefix);
        let endIdx = 0;
        while (endIdx < textBuf.length) {
          const charCode = textBuf[endIdx];
          if (charCode === undefined || charCode < 32 || charCode >= 127) {
            break;
          }
          endIdx++;
        }
        message = cleanString(textBuf.subarray(0, endIdx));
      }
    }
  }

  return {
    title,
    artist: artist || null,
    trackerFormat: format,
    channels: null,
    trackerName: null,
    message,
    instruments: null,
    metadata: {}
  };
}

// 主入口函数
export async function parseMetadata(filePath: string, ext: string): Promise<ParsedMetadata> {
  const upperExt = ext.toUpperCase();
  let fd: any = null;

  try {
    const fileStats = await stat(filePath);
    const fileLength = fileStats.size;

    fd = await open(filePath, 'r');

    let result: ParsedMetadata;

    // 对于 Tracker 音乐，直接预读前 2MB 并在内存中进行高速同步解析，解决超大文件截断问题
    if (['XM', 'MOD', 'IT', 'S3M'].includes(upperExt)) {
      const scanBufSize = Math.min(2097152, fileLength);
      const scanBuf = Buffer.alloc(scanBufSize);
      await fd.read(scanBuf, 0, scanBufSize, 0);
      const reader = createSyncReader(scanBuf, fileLength);

      switch (upperExt) {
        case 'XM':
          result = parseXm(reader, fileLength);
          break;
        case 'MOD':
          result = parseMod(reader, fileLength);
          break;
        case 'IT':
          result = await parseIt(reader, fileLength);
          break;
        case 'S3M':
          result = parseS3m(reader, fileLength);
          break;
        default:
          throw new Error('Unsupported tracker type');
      }
    } else {
      // 其它非 Tracker 音频格式，依然采用各自的异步解析
      switch (upperExt) {
        case 'MP3':
          result = await parseMp3(fd, fileLength);
          break;
        case 'OGG':
        case 'FLAC':
        case 'WAV':
          result = await parseGenericAudio(fd, fileLength, upperExt);
          break;
        default:
          result = {
            title: '',
            artist: null,
            trackerFormat: upperExt,
            channels: null,
            trackerName: null,
            message: null,
            instruments: null,
            metadata: {}
          };
      }
    }

    if (!result.title) {
      const name = basename(filePath);
      const dotIdx = name.lastIndexOf('.');
      result.title = dotIdx !== -1 ? name.substring(0, dotIdx) : name;
    }

    return result;
  } catch (error) {
    const name = basename(filePath);
    const dotIdx = name.lastIndexOf('.');
    return {
      title: dotIdx !== -1 ? name.substring(0, dotIdx) : name,
      artist: null,
      trackerFormat: upperExt,
      channels: null,
      trackerName: null,
      message: null,
      instruments: null,
      metadata: { error: String(error) }
    };
  } finally {
    if (fd) {
      await fd.close();
    }
  }
}
