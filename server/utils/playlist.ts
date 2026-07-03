import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SongEntry {
  id: number;
  fileName: string;
}

const PLAYLIST_PATH = join(
  process.cwd(),
  "public",
  "json",
  "playlist_xm_mod_pressed.json",
);

let cachedRaw: unknown[] | null = null;
let cachedSorted: string[] | null = null;

async function loadPlaylistRaw(): Promise<unknown[] | null> {
  if (cachedRaw) {
    return cachedRaw;
  }
  try {
    const rawText = await readFile(PLAYLIST_PATH, "utf8");
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      cachedRaw = parsed;
      return parsed;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function extractFileNamesFromJsonh(raw: unknown[]): string[] {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const keyCount = Number(raw[0]);
  if (!Number.isInteger(keyCount) || keyCount <= 0) return [];
  if (raw.length < 1 + keyCount) return [];

  const keys = raw.slice(1, 1 + keyCount);
  const fnIndex = keys.findIndex((key) => key === "fn");
  if (fnIndex === -1) return [];

  const valuesStart = 1 + keyCount;
  const total = Math.floor((raw.length - valuesStart) / keyCount);
  const names: string[] = [];

  for (let i = 0; i < total; i += 1) {
    const value = raw[valuesStart + i * keyCount + fnIndex];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) names.push(trimmed);
    }
  }

  return names;
}

function extractFileNamesFromPlain(raw: unknown[]): string[] {
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) names.push(trimmed);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const fn = (entry as { fn?: unknown }).fn;
    if (typeof fn === "string") {
      const trimmed = fn.trim();
      if (trimmed) names.push(trimmed);
    }
  }
  return names;
}

async function loadSortedPlaylist(): Promise<string[] | null> {
  if (cachedSorted) return cachedSorted;

  const raw = await loadPlaylistRaw();
  if (!raw) return null;

  const jsonhNames = extractFileNamesFromJsonh(raw);
  const names = jsonhNames.length ? jsonhNames : extractFileNamesFromPlain(raw);
  if (!names.length) return null;

  names.sort((a, b) => {
    const fnA = a.toUpperCase();
    const fnB = b.toUpperCase();
    if (fnA < fnB) return -1;
    if (fnA > fnB) return 1;
    return 0;
  });

  cachedSorted = names;
  return names;
}

export async function getSongById(id: number): Promise<SongEntry | null> {
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  const playlist = await loadSortedPlaylist();
  if (!playlist) return null;

  const fileName = playlist[id - 1];
  if (typeof fileName !== "string" || !fileName) return null;

  return {
    id,
    fileName,
  };
}
