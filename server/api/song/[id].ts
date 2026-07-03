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

  const song = db.prepare('SELECT id, filename as fileName FROM songs WHERE id = ?').get(parsedId) as { id: number, fileName: string } | undefined;
  if (!song) {
    throw createError({
      statusCode: 404,
      statusMessage: "Song not found",
    });
  }

  return song;
});

