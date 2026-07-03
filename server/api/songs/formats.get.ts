import db from '../../db';

// 引擎标签映射
const ENGINE_TAGS: Record<string, string> = {
  // Bassoon + Chiptune3
  xm: 'bc', mod: 'bc',
  // Chiptune3 (libopenmpt) — 68 种 tracker 格式
  it: 'c', s3m: 'c', umx: 'c', mptm: 'c', stm: 'c', mtm: 'c', ptm: 'c',
  far: 'c', ult: 'c', '669': 'c', amf: 'c', dsm: 'c', mdl: 'c', med: 'c',
  okt: 'c', psm: 'c', dbm: 'c', imf: 'c', j2b: 'c', mo3: 'c', gdm: 'c',
  stp: 'c', sfx: 'c', sfx2: 'c', itp: 'c', dtm: 'c', mt2: 'c', symmod: 'c',
  c67: 'c', ams: 'c', stx: 'c', '667': 'c', cba: 'c', digi: 'c', dmf: 'c',
  dsym: 'c', etx: 'c', fc: 'c', fc13: 'c', fc14: 'c', fmt: 'c', ftm: 'c',
  gmc: 'c', gt2: 'c', gtk: 'c', ice: 'c', ims: 'c', m15: 'c', mms: 'c',
  mus: 'c', oxm: 'c', plm: 'c', pt36: 'c', puma: 'c', rtm: 'c', smod: 'c',
  st26: 'c', stk: 'c', wow: 'c', xmf: 'c', mdz: 'c', s3z: 'c', xmz: 'c',
  itz: 'c', mptmz: 'c', mdr: 'c',
  // Native HTML5 Audio
  mp3: 'n', ogg: 'n', wav: 'n', flac: 'n',
  // FFmpeg convertible
  aac: 'f', opus: 'f', aiff: 'f', m4a: 'f', wma: 'f',
  ac3: 'f', dts: 'f', ape: 'f', wv: 'f', tta: 'f', mp2: 'f', amr: 'f',
  ra: 'f', au: 'f', voc: 'f', pcm: 'f', spx: 'f', tak: 'f', cda: 'f',
  adpcm: 'f', gsm: 'f', vqf: 'f', ofr: 'f', mp1: 'f',
};

export default defineEventHandler(async () => {
  const rows = db.prepare(`
    SELECT extension, COUNT(*) as count
    FROM songs
    WHERE extension IS NOT NULL AND extension != ''
      AND playable = 1
    GROUP BY extension
    ORDER BY count DESC
  `).all() as Array<{ extension: string; count: number }>;

  const formats = rows.map(row => ({
    extension: row.extension.toLowerCase(),
    count: row.count,
    engine: ENGINE_TAGS[row.extension.toLowerCase()] || 'f',
  }));

  return formats;
});
