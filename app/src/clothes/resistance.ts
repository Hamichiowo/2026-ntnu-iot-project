// Fabric resistance from the ADS1115 reading.
//
// Wiring: 3V3 → divider resistor (R) → A0 → electrode → fabric (Rx) → electrode → GND, ADS1115
// on ±4.096 V. A0 also sees the ADS1115's own input impedance (about 6.6 MΩ, measured on the
// clip), so with nothing clamped A0 does not reach 3.3 V: it sits at the "open" reading, which is
// measured per clip. Seen from A0 the source is the open reading behind R ∥ R_in, so
//   Rx = (R ∥ R_in) · count / (open − count)
// The supply voltage cancels out. Readings close to the open reading mean the fabric is beyond
// what the divider can resolve (dry), so they are reported as "above OHM_MAX" instead of a number.
//
// The clip keeps sending raw counts; a divider setting applies from its `since` time on, so data
// recorded with an earlier resistor keeps converting with that resistor.
import { dbClient } from '../db/client';
import { HttpError } from './drying';
import { isUuid } from './store';

export const ADS_INPUT_OHM = 6_600_000;
// Above this fraction of the open reading the fabric counts as open (beyond ~32 × (R ∥ R_in)).
export const OPEN_FRACTION = 0.97;

export interface Divider { id?: string; since: string | Date; divider_ohm: number; open_count: number }

const parallel = (a: number, b: number) => a * b / (a + b);
// The highest resistance a divider still resolves; readings above it are shown as "> this".
export const ohmMax = (d: Divider) => parallel(d.divider_ohm, ADS_INPUT_OHM) * OPEN_FRACTION / (1 - OPEN_FRACTION);

// Pure. null: no reading. Infinity: open (above ohmMax). Never negative.
export function countToOhm(count: number | null, d: Divider): number | null {
  if (count === null) return null;
  if (count >= d.open_count * OPEN_FRACTION) return Infinity;
  if (count <= 0) return 0;
  return parallel(d.divider_ohm, ADS_INPUT_OHM) * count / (d.open_count - count);
}

// The setting in force at `time` (dividers sorted by since, oldest first); null before the first one.
export function dividerAt(dividers: Divider[], time: number): Divider | null {
  let found: Divider | null = null;
  for (const d of dividers) {
    if (new Date(d.since).getTime() <= time) found = d; else break;
  }
  return found;
}

export function parseDivider(body: unknown, now: Date): Divider {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '內容必須是 JSON 物件');
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!['since', 'divider_ohm', 'open_count'].includes(key)) throw new HttpError(400, `不支援的欄位 ${key}`);
  }
  const ohm = b.divider_ohm, open = b.open_count;
  if (!Number.isInteger(ohm) || (ohm as number) < 1_000 || (ohm as number) > 100_000_000) {
    throw new HttpError(400, '分壓電阻要是 1 kΩ～100 MΩ 的整數歐姆');
  }
  if (!Number.isInteger(open) || (open as number) < 1_000 || (open as number) > 32_767) {
    throw new HttpError(400, '開路讀值要是 1000～32767 的整數');
  }
  const since = b.since === undefined ? now : typeof b.since === 'string' ? new Date(b.since) : new Date(NaN);
  if (!Number.isFinite(since.getTime())) throw new HttpError(400, '生效時間格式錯誤');
  if (since > now) throw new HttpError(400, '生效時間不能晚於現在');
  return { since, divider_ohm: ohm as number, open_count: open as number };
}

function database() {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  return dbClient.sql;
}

// Needs the clips table (ensureDryingSchema) first.
export async function ensureResistanceSchema(): Promise<void> {
  await database()`
    CREATE TABLE IF NOT EXISTS clip_dividers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      since TIMESTAMPTZ NOT NULL,
      divider_ohm INTEGER NOT NULL CHECK (divider_ohm BETWEEN 1000 AND 100000000),
      open_count INTEGER NOT NULL CHECK (open_count BETWEEN 1000 AND 32767),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (clip_id, since)
    )`;
}

// Every clip's settings, oldest first, keyed by clip id.
export async function dividersByClip(): Promise<Map<string, Divider[]>> {
  const rows = await database()`SELECT id, clip_id, since, divider_ohm, open_count FROM clip_dividers ORDER BY clip_id, since`;
  const out = new Map<string, Divider[]>();
  for (const row of rows) {
    const list = out.get(row.clip_id) ?? [];
    list.push({ id: row.id, since: row.since, divider_ohm: row.divider_ohm, open_count: row.open_count });
    out.set(row.clip_id, list);
  }
  return out;
}

export async function clipDividers(clipId: string): Promise<Divider[]> {
  return database()`
    SELECT id, since, divider_ohm, open_count FROM clip_dividers WHERE clip_id = ${clipId}::uuid ORDER BY since`;
}

export async function addDivider(clipId: string, divider: Divider) {
  if (!isUuid(clipId)) throw new HttpError(404, '找不到這支衣夾');
  const sql = database();
  const clip = await sql`SELECT is_demo FROM clips WHERE id = ${clipId}::uuid`;
  if (!clip.length) throw new HttpError(404, '找不到這支衣夾');
  if (clip[0].is_demo) throw new HttpError(400, '示範衣夾沒有實體電路，不能設定分壓電阻');
  try {
    await sql`
      INSERT INTO clip_dividers (clip_id, since, divider_ohm, open_count)
      VALUES (${clipId}::uuid, ${divider.since}, ${divider.divider_ohm}, ${divider.open_count})`;
  } catch (error: any) {
    if ((error?.errno ?? error?.code) === '23505') throw new HttpError(409, '這個時間已經有一筆設定');
    throw error;
  }
  return clipDividers(clipId);
}

export async function deleteDivider(clipId: string, dividerId: string) {
  if (!isUuid(clipId) || !isUuid(dividerId)) throw new HttpError(404, '找不到這筆設定');
  const rows = await database()`
    DELETE FROM clip_dividers WHERE id = ${dividerId}::uuid AND clip_id = ${clipId}::uuid RETURNING id`;
  if (!rows.length) throw new HttpError(404, '找不到這筆設定');
  return clipDividers(clipId);
}
