// Clips: one row per clothes clip with its own settings (name, paired air box, prediction method).
// There is one physical clip for now; everything on clothes/raw belongs to it.
import { dbClient } from '../db/client';
import { CLIP_STALE_MS, DEFAULT_CLIP_ID } from './store';

export const METHODS = ['hx711_raw', 'ads1115_raw', 'touch_raw'] as const;
export type Method = typeof METHODS[number];

const dryingState = { schemaReady: false };

// Errors the caller caused; routes answer with this status instead of 503.
export class HttpError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

export async function ensureDryingSchema(): Promise<void> {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  const sql = dbClient.sql;
  await sql`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
      airbox_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
      predict_method TEXT NOT NULL DEFAULT 'hx711_raw' CHECK (predict_method IN ('hx711_raw', 'ads1115_raw', 'touch_raw')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  // Only one physical clip for now; more rows come with multi-clip support.
  await sql`INSERT INTO clips (id, name) VALUES (${DEFAULT_CLIP_ID}, '衣夾-01') ON CONFLICT (id) DO NOTHING`;
  dryingState.schemaReady = true;
}

function database() {
  if (!dbClient.isConnected() || !dryingState.schemaReady) throw new Error('Drying database unavailable');
  return dbClient.sql;
}

// ===== Body validation (pure; also used by tests) =====
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkKeys(body: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) throw new HttpError(400, `不支援的欄位：${extra.join(', ')}`);
}

// Clip names: 1–40 characters after trimming.
const validName = (v: unknown) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 40;

export interface ClipPatch { name?: string; airbox_id?: string | null; predict_method?: Method }
const AIRBOX_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export function parseClipPatch(body: unknown): ClipPatch {
  if (!isObject(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  checkKeys(body, ['name', 'airbox_id', 'predict_method']);
  const out: ClipPatch = {};
  if (body.name !== undefined) {
    if (!validName(body.name)) throw new HttpError(400, '欄位 name 格式錯誤');
    out.name = (body.name as string).trim();
  }
  if (body.airbox_id !== undefined) {
    if (body.airbox_id !== null && !(typeof body.airbox_id === 'string' && AIRBOX_ID.test(body.airbox_id))) {
      throw new HttpError(400, '欄位 airbox_id 格式錯誤');
    }
    out.airbox_id = body.airbox_id as string | null;
  }
  if (body.predict_method !== undefined) {
    if (!(METHODS as readonly unknown[]).includes(body.predict_method)) throw new HttpError(400, '欄位 predict_method 格式錯誤');
    out.predict_method = body.predict_method as Method;
  }
  if (!Object.keys(out).length) throw new HttpError(400, '沒有要更新的欄位');
  return out;
}

// ===== Clips =====
export async function listClips() {
  const sql = database();
  const clips = await sql`SELECT id, name, airbox_id, predict_method, created_at, updated_at FROM clips ORDER BY id`;
  // Everything on clothes/raw belongs to the one clip for now.
  const latest = await sql`SELECT max(timestamp) AS last_reading FROM clothes_raw`;
  const now = Date.now();
  return clips.map((clip: any) => {
    const lastReading = clip.id === DEFAULT_CLIP_ID ? latest[0]?.last_reading ?? null : null;
    return {
      ...clip,
      last_reading: lastReading,
      online: lastReading !== null && now - new Date(lastReading).getTime() <= CLIP_STALE_MS,
    };
  });
}

export async function updateClip(id: string, patch: ClipPatch) {
  const sql = database();
  return sql.begin(async (tx: any) => {
    const rows = await tx`SELECT name, airbox_id, predict_method FROM clips WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, '找不到這支衣夾');
    if (patch.airbox_id) {
      const box = await tx`SELECT 1 FROM devices WHERE device_id = ${patch.airbox_id}`;
      if (!box.length) throw new HttpError(400, '找不到這個空氣盒子');
    }
    const next = { ...rows[0], ...patch };
    const updated = await tx`
      UPDATE clips SET name = ${next.name}, airbox_id = ${next.airbox_id}, predict_method = ${next.predict_method}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, airbox_id, predict_method, created_at, updated_at`;
    return updated[0];
  });
}
