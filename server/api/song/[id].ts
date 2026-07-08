import { createError } from "h3";
import db from "../../db";

export default defineEventHandler(async (event) => {
  const params = getRouterParams(event);
  const idParam = params.id;
  const parsedId = idParam ? Number.parseInt(String(idParam), 10) : NaN;

  if (!Number.isFinite(parsedId) || parsedId < 1) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid song id",
    });
  }

  const song = db.prepare(`
    SELECT songs.id, songs.filename as fileName,
           t.tma_id, t.hash as tma_hash, t.title as tma_title, t.filename as tma_filename, t.format as tma_format, t.size as tma_size, t.bytes as tma_bytes, t.date as tma_date, t.timestamp as tma_timestamp, t.tracker_format as tma_tracker_format, t.channels as tma_channels, t.instruments as tma_instruments, t.genre_id as tma_genre_id, t.genre_text as tma_genre_text, t.ratings as tma_ratings, t.license as tma_license, t.artist_info as tma_artist_info, t.fetched_at as tma_fetched_at
    FROM songs
    LEFT JOIN tma_data t ON songs.id = t.song_id
    WHERE songs.id = ?
  `).get(parsedId) as any;
  
  if (song) {
    if (song.tma_fetched_at !== null && song.tma_fetched_at !== undefined) {
      song.tma_metadata = {
        tma_id: song.tma_id,
        hash: song.tma_hash,
        title: song.tma_title,
        filename: song.tma_filename,
        format: song.tma_format,
        size: song.tma_size,
        bytes: song.tma_bytes,
        date: song.tma_date,
        timestamp: song.tma_timestamp,
        tracker_format: song.tma_tracker_format,
        channels: song.tma_channels,
        instruments: song.tma_instruments,
        genre_id: song.tma_genre_id,
        genre_text: song.tma_genre_text,
        ratings: song.tma_ratings ? JSON.parse(song.tma_ratings) : null,
        license: song.tma_license ? JSON.parse(song.tma_license) : null,
        artist_info: song.tma_artist_info ? JSON.parse(song.tma_artist_info) : null,
        fetched_at: song.fetched_at
      };
    } else {
      song.tma_metadata = null;
    }

    // 清除临时扁平字段
    delete song.tma_id;
    delete song.tma_hash;
    delete song.tma_title;
    delete song.tma_filename;
    delete song.tma_format;
    delete song.tma_size;
    delete song.tma_bytes;
    delete song.tma_date;
    delete song.tma_timestamp;
    delete song.tma_tracker_format;
    delete song.tma_channels;
    delete song.tma_instruments;
    delete song.tma_genre_id;
    delete song.tma_genre_text;
    delete song.tma_ratings;
    delete song.tma_license;
    delete song.tma_artist_info;
    delete song.tma_fetched_at;
  }

  if (!song) {
    throw createError({
      statusCode: 404,
      statusMessage: "Song not found",
    });
  }

  return song;
});

