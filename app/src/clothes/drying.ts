// Clips (per-clip settings), garment library and drying sessions.
// A session with ended_at NULL is still drying; once ended it is a record ('dry' or 'early').
// 'cancel' deletes the row, so cancelled sessions leave no record.
//
// Demo data lives in the same tables with is_demo = true (see demo.ts). Lists leave it out unless
// the caller asks for it (includeDemo), and composite foreign keys keep a session, its clip and its
// garment all real or all demo, so demo data can never end up in a real record.
import { dbClient } from '../db/client';
import { CLIP_STALE_MS, DEFAULT_CLIP_ID } from './store';
import { MATERIALS, STYLES, type Material, predictMinutes, swappedPrediction } from './prediction';

export const METHODS = ['hx711_raw', 'ads1115_raw', 'touch_raw'] as const;
export type Method = typeof METHODS[number];
export type Outcome = 'dry' | 'early' | 'cancel';

const dryingState = { schemaReady: false };
const MIN = 60000;

// Errors the caller caused; routes answer with this status instead of 503.
export class HttpError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

// Bun SQL puts the SQLSTATE in errno (code is a generic ERR_POSTGRES_* name).
const sqlState = (error: any): string | undefined => error?.errno ?? error?.code;
function mapConstraint(error: unknown, conflict: string): never {
  const state = sqlState(error);
  if (state === '23505') throw new HttpError(409, conflict);
  if (state === '23503') throw new HttpError(400, `參照的資料不存在，或${MIXED_DEMO}`);
  throw error;
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
      is_demo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  // Only one physical clip for now; more rows come with multi-clip support.
  await sql`INSERT INTO clips (id, name) VALUES (${DEFAULT_CLIP_ID}, '衣夾-01') ON CONFLICT (id) DO NOTHING`;
  await sql`
    CREATE TABLE IF NOT EXISTS garments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
      style TEXT NOT NULL CHECK (style IN ('tee', 'shirt', 'tank', 'pants', 'towel')),
      color TEXT NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
      material TEXT NOT NULL CHECK (material IN ('棉', '聚酯纖維', '牛仔布', '羊毛', '麻', '毛巾布')),
      is_demo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS drying_sessions (
      id TEXT PRIMARY KEY,
      clip_id TEXT NOT NULL REFERENCES clips(id),
      garment_id TEXT NOT NULL REFERENCES garments(id) ON DELETE RESTRICT,
      started_at TIMESTAMPTZ NOT NULL,
      predicted_min INTEGER NOT NULL CHECK (predicted_min > 0),
      ended_at TIMESTAMPTZ,
      outcome TEXT CHECK (outcome IN ('dry', 'early')),
      actual_min INTEGER CHECK (actual_min >= 0),
      is_demo BOOLEAN NOT NULL DEFAULT false,
      CHECK ((ended_at IS NULL) = (outcome IS NULL)),
      CHECK (CASE WHEN outcome = 'dry' THEN actual_min IS NOT NULL ELSE actual_min IS NULL END),
      CHECK (ended_at IS NULL OR ended_at >= started_at)
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS drying_sessions_active_clip_idx ON drying_sessions (clip_id) WHERE ended_at IS NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS drying_sessions_active_garment_idx ON drying_sessions (garment_id) WHERE ended_at IS NULL`;
  await sql`CREATE INDEX IF NOT EXISTS drying_sessions_garment_idx ON drying_sessions (garment_id, started_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS drying_sessions_started_idx ON drying_sessions (started_at DESC)`;
  await ensureDemoColumns(sql);
  dryingState.schemaReady = true;
}

// is_demo and the composite keys, added idempotently so databases created before them get them too.
async function ensureDemoColumns(sql: any) {
  for (const table of ['clips', 'garments', 'drying_sessions']) {
    await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false`);
  }
  const constraints: [string, string, string][] = [
    ['clips', 'clips_id_is_demo_key', 'UNIQUE (id, is_demo)'],
    ['garments', 'garments_id_is_demo_key', 'UNIQUE (id, is_demo)'],
    ['drying_sessions', 'drying_sessions_clip_is_demo_fkey', 'FOREIGN KEY (clip_id, is_demo) REFERENCES clips (id, is_demo)'],
    ['drying_sessions', 'drying_sessions_garment_is_demo_fkey', 'FOREIGN KEY (garment_id, is_demo) REFERENCES garments (id, is_demo)'],
  ];
  for (const [table, name, definition] of constraints) {
    await sql.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition};
      END IF;
    END $$`);
  }
}

function database() {
  if (!dbClient.isConnected() || !dryingState.schemaReady) throw new Error('Drying database unavailable');
  return dbClient.sql;
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

// ===== Body validation (pure; also used by tests) =====
export interface GarmentDraft { name: string; style: string; color: string; material: Material }
export const MIXED_DEMO = '衣夾和衣物必須同為真實或同為示範';

// ?demo=include adds demo rows; without it lists hold real data only. undefined = bad value.
export function parseDemoQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) return false;
  return value === 'include' ? true : undefined;
}

// POST /garments: the garment fields plus an optional is_demo (default false).
export function parseNewGarment(body: unknown): { draft: GarmentDraft; isDemo: boolean } {
  if (!isObject(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  const { is_demo: isDemo = false, ...rest } = body;
  if (typeof isDemo !== 'boolean') throw new HttpError(400, '欄位 is_demo 格式錯誤');
  return { draft: parseGarment(rest) as GarmentDraft, isDemo };
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkKeys(body: Record<string, unknown>, allowed: string[]) {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) throw new HttpError(400, `不支援的欄位：${extra.join(', ')}`);
}

// Clip and garment names: 1–40 characters after trimming.
const validName = (v: unknown) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 40;

const GARMENT_FIELDS: Record<string, (value: unknown) => boolean> = {
  name: validName,
  style: (v) => (STYLES as readonly unknown[]).includes(v),
  color: (v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v),
  material: (v) => (MATERIALS as readonly unknown[]).includes(v),
};

// partial: PATCH (any subset, at least one); otherwise all four fields are required.
export function parseGarment(body: unknown, partial = false): Partial<GarmentDraft> {
  if (!isObject(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  checkKeys(body, Object.keys(GARMENT_FIELDS));
  const out: Record<string, unknown> = {};
  for (const [key, valid] of Object.entries(GARMENT_FIELDS)) {
    if (body[key] === undefined) {
      if (!partial) throw new HttpError(400, `缺少欄位 ${key}`);
      continue;
    }
    if (!valid(body[key])) throw new HttpError(400, `欄位 ${key} 格式錯誤`);
    out[key] = key === 'name' ? (body[key] as string).trim() : body[key];
  }
  if (partial && !Object.keys(out).length) throw new HttpError(400, '沒有要更新的欄位');
  return out as Partial<GarmentDraft>;
}

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

export type StartBody = { clip_id: string; garment_id: string } | { clip_id: string; garment: GarmentDraft };
export function parseStart(body: unknown): StartBody {
  if (!isObject(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  checkKeys(body, ['clip_id', 'garment_id', 'garment']);
  if (typeof body.clip_id !== 'string' || !body.clip_id) throw new HttpError(400, '缺少欄位 clip_id');
  if ((body.garment_id === undefined) === (body.garment === undefined)) {
    throw new HttpError(400, 'garment_id 與 garment 必須擇一提供');
  }
  if (body.garment_id !== undefined) {
    if (typeof body.garment_id !== 'string' || !body.garment_id) throw new HttpError(400, '欄位 garment_id 格式錯誤');
    return { clip_id: body.clip_id, garment_id: body.garment_id };
  }
  return { clip_id: body.clip_id, garment: parseGarment(body.garment) as GarmentDraft };
}

export function parseOutcome(body: unknown): Outcome {
  if (!isObject(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  checkKeys(body, ['outcome']);
  if (body.outcome !== 'dry' && body.outcome !== 'early' && body.outcome !== 'cancel') {
    throw new HttpError(400, 'outcome 必須是 dry、early 或 cancel');
  }
  return body.outcome;
}

// ===== Row shapes =====
type SessionRow = {
  id: string; clip_id: string; garment_id: string; started_at: Date; predicted_min: number;
  ended_at: Date | null; outcome: 'dry' | 'early' | null; actual_min: number | null; is_demo: boolean;
  g_name: string; g_style: string; g_color: string; g_material: string;
};

function sessionOut(row: SessionRow) {
  const started = new Date(row.started_at);
  return {
    id: row.id, clip_id: row.clip_id, garment_id: row.garment_id, started_at: started,
    predicted_min: row.predicted_min, dry_at: new Date(started.getTime() + row.predicted_min * MIN),
    ended_at: row.ended_at, outcome: row.outcome, actual_min: row.actual_min, is_demo: row.is_demo,
    garment: { id: row.garment_id, name: row.g_name, style: row.g_style, color: row.g_color, material: row.g_material },
  };
}

// Sessions joined with their garment; `where` picks the active ones or one by id.
async function selectSessions(sql: any, where: 'active' | 'id', id?: string, includeDemo = false) {
  const rows: SessionRow[] = where === 'active'
    ? await sql`
      SELECT s.id, s.clip_id, s.garment_id, s.started_at, s.predicted_min, s.ended_at, s.outcome, s.actual_min, s.is_demo,
        g.name AS g_name, g.style AS g_style, g.color AS g_color, g.material AS g_material
      FROM drying_sessions s JOIN garments g ON g.id = s.garment_id
      WHERE s.ended_at IS NULL AND (${includeDemo} OR NOT s.is_demo) ORDER BY s.started_at`
    : await sql`
      SELECT s.id, s.clip_id, s.garment_id, s.started_at, s.predicted_min, s.ended_at, s.outcome, s.actual_min, s.is_demo,
        g.name AS g_name, g.style AS g_style, g.color AS g_color, g.material AS g_material
      FROM drying_sessions s JOIN garments g ON g.id = s.garment_id
      WHERE s.id = ${id}`;
  return rows.map(sessionOut);
}

async function predictFor(sql: any, garmentId: string, material: Material) {
  const rows = await sql`
    SELECT actual_min FROM drying_sessions WHERE garment_id = ${garmentId} AND outcome = 'dry'`;
  return predictMinutes(material, rows.map((row: { actual_min: number }) => row.actual_min));
}

// ===== Clips =====
export async function listClips(includeDemo = false) {
  const sql = database();
  const clips = await sql`
    SELECT id, name, airbox_id, predict_method, is_demo, created_at, updated_at FROM clips
    WHERE ${includeDemo} OR NOT is_demo ORDER BY is_demo, id`;
  // Everything on clothes/raw belongs to the one clip for now.
  const latest = await sql`SELECT max(timestamp) AS last_reading FROM clothes_raw`;
  const active = await selectSessions(sql, 'active', undefined, includeDemo);
  const now = Date.now();
  return clips.map((clip: any) => {
    // Demo clips never report; the front end simulates their state.
    const lastReading = clip.id === DEFAULT_CLIP_ID && !clip.is_demo ? latest[0]?.last_reading ?? null : null;
    return {
      ...clip,
      last_reading: lastReading,
      online: lastReading !== null && now - new Date(lastReading).getTime() <= CLIP_STALE_MS,
      session: active.find((session) => session.clip_id === clip.id) ?? null,
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
      RETURNING id, name, airbox_id, predict_method, is_demo, created_at, updated_at`;
    return updated[0];
  });
}

// Only demo clips can be removed; their demo sessions go with them.
export async function deleteClip(id: string) {
  const sql = database();
  await sql.begin(async (tx: any) => {
    const rows = await tx`SELECT is_demo FROM clips WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, '找不到這支衣夾');
    if (!rows[0].is_demo) throw new HttpError(400, '實際的衣夾不能移除');
    await tx`DELETE FROM drying_sessions WHERE clip_id = ${id} AND is_demo`;
    await tx`DELETE FROM clips WHERE id = ${id}`;
  });
}

// ===== Garments =====
export async function listGarments(includeDemo = false) {
  return database()`
    SELECT g.id, g.name, g.style, g.color, g.material, g.is_demo, g.created_at, g.updated_at,
      (SELECT count(*)::int FROM drying_sessions s WHERE s.garment_id = g.id AND s.outcome = 'dry') AS dry_count,
      EXISTS (SELECT 1 FROM drying_sessions s WHERE s.garment_id = g.id AND s.ended_at IS NULL) AS busy
    FROM garments g WHERE ${includeDemo} OR NOT g.is_demo ORDER BY g.is_demo, g.created_at, g.id`;
}

async function insertGarment(sql: any, draft: GarmentDraft, isDemo: boolean) {
  const rows = await sql`
    INSERT INTO garments (id, name, style, color, material, is_demo)
    VALUES (${newId(isDemo ? 'demo-g' : 'g')}, ${draft.name}, ${draft.style}, ${draft.color}, ${draft.material}, ${isDemo})
    RETURNING id, name, style, color, material, is_demo, created_at, updated_at`;
  return rows[0];
}

export async function createGarment(draft: GarmentDraft, isDemo = false) {
  return { ...(await insertGarment(database(), draft, isDemo)), dry_count: 0, busy: false };
}

export async function updateGarment(id: string, patch: Partial<GarmentDraft>) {
  const sql = database();
  return sql.begin(async (tx: any) => {
    const rows = await tx`SELECT name, style, color, material FROM garments WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, '找不到這件衣物');
    const next = { ...rows[0], ...patch };
    const updated = await tx`
      UPDATE garments SET name = ${next.name}, style = ${next.style}, color = ${next.color}, material = ${next.material}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, style, color, material, is_demo, created_at, updated_at`;
    return updated[0];
  });
}

// ===== Sessions =====
export async function listActiveSessions(includeDemo = false) {
  return selectSessions(database(), 'active', undefined, includeDemo);
}

export async function startSession(body: StartBody, now: Date) {
  const sql = database();
  try {
    const id = await sql.begin(async (tx: any) => {
      const clip = (await tx`SELECT is_demo FROM clips WHERE id = ${body.clip_id}`)[0];
      if (!clip) throw new HttpError(404, '找不到這支衣夾');
      // A new garment is created real or demo to match the clip.
      const garment = 'garment' in body
        ? await insertGarment(tx, body.garment, clip.is_demo)
        : (await tx`SELECT id, material, is_demo FROM garments WHERE id = ${body.garment_id}`)[0];
      if (!garment) throw new HttpError(404, '找不到這件衣物');
      if (garment.is_demo !== clip.is_demo) throw new HttpError(400, MIXED_DEMO);
      const predicted = await predictFor(tx, garment.id, garment.material);
      const sessionId = newId(clip.is_demo ? 'demo-s' : 's');
      await tx`
        INSERT INTO drying_sessions (id, clip_id, garment_id, started_at, predicted_min, is_demo)
        VALUES (${sessionId}, ${body.clip_id}, ${garment.id}, ${now}, ${predicted}, ${clip.is_demo})`;
      return sessionId;
    });
    return (await selectSessions(sql, 'id', id))[0];
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapConstraint(error, '這支衣夾或這件衣物已經在晾衣中');
  }
}

export async function swapGarment(sessionId: string, garmentId: string, now: Date) {
  const sql = database();
  try {
    await sql.begin(async (tx: any) => {
      const rows = await tx`SELECT started_at, garment_id, ended_at, is_demo FROM drying_sessions WHERE id = ${sessionId} FOR UPDATE`;
      if (!rows.length) throw new HttpError(404, '找不到這筆晾衣');
      if (rows[0].ended_at) throw new HttpError(409, '這筆晾衣已經結束');
      // The same garment still re-predicts: its material may just have been edited.
      const garment = (await tx`SELECT id, material, is_demo FROM garments WHERE id = ${garmentId}`)[0];
      if (!garment) throw new HttpError(404, '找不到這件衣物');
      if (garment.is_demo !== rows[0].is_demo) throw new HttpError(400, MIXED_DEMO);
      const elapsed = (now.getTime() - new Date(rows[0].started_at).getTime()) / MIN;
      const predicted = swappedPrediction(elapsed, await predictFor(tx, garment.id, garment.material));
      await tx`UPDATE drying_sessions SET garment_id = ${garmentId}, predicted_min = ${predicted} WHERE id = ${sessionId}`;
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    mapConstraint(error, '這件衣物已經在其他衣夾上晾');
  }
  return (await selectSessions(sql, 'id', sessionId))[0];
}

export async function endSession(sessionId: string, outcome: Outcome, now: Date) {
  const sql = database();
  return sql.begin(async (tx: any) => {
    const rows = await tx`SELECT started_at, ended_at FROM drying_sessions WHERE id = ${sessionId} FOR UPDATE`;
    if (!rows.length) throw new HttpError(404, '找不到這筆晾衣');
    if (rows[0].ended_at) throw new HttpError(409, '這筆晾衣已經結束');
    if (outcome === 'cancel') {
      await tx`DELETE FROM drying_sessions WHERE id = ${sessionId}`;
      return null;
    }
    const startedAt = new Date(rows[0].started_at);
    // Never before started_at, even if the clock moved.
    const endedAt = now < startedAt ? startedAt : now;
    const actual = outcome === 'dry' ? Math.round((endedAt.getTime() - startedAt.getTime()) / MIN) : null;
    await tx`UPDATE drying_sessions SET ended_at = ${endedAt}, outcome = ${outcome}, actual_min = ${actual} WHERE id = ${sessionId}`;
    return (await selectSessions(tx, 'id', sessionId))[0];
  });
}

// Ended sessions that started in [start, end], newest first, and how many there are in total.
export async function listRecords(start: Date | null, end: Date | null, limit: number, includeDemo = false) {
  const sql = database();
  const from = start ?? new Date(0);
  const to = end ?? new Date('9999-12-31T00:00:00Z');
  const rows: SessionRow[] = await sql`
    SELECT s.id, s.clip_id, s.garment_id, s.started_at, s.predicted_min, s.ended_at, s.outcome, s.actual_min, s.is_demo,
      g.name AS g_name, g.style AS g_style, g.color AS g_color, g.material AS g_material
    FROM drying_sessions s JOIN garments g ON g.id = s.garment_id
    WHERE s.ended_at IS NOT NULL AND s.started_at >= ${from} AND s.started_at <= ${to} AND (${includeDemo} OR NOT s.is_demo)
    ORDER BY s.started_at DESC, s.id DESC LIMIT ${limit}`;
  const total = await sql`
    SELECT count(*)::int AS total FROM drying_sessions
    WHERE ended_at IS NOT NULL AND started_at >= ${from} AND started_at <= ${to} AND (${includeDemo} OR NOT is_demo)`;
  return { records: rows.map(sessionOut), total: total[0].total as number };
}
