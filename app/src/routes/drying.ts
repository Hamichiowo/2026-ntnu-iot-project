// /api/v1/clothes/{clips,garments,sessions}: per-clip settings, garment library and drying sessions.
import { Hono, type Context } from 'hono';
import {
  HttpError, createGarment, endSession, listActiveSessions, listClips, listGarments, listRecords, parseClipPatch,
  parseGarment, parseOutcome, parseStart, startSession, swapGarment, updateClip, updateGarment, type GarmentDraft,
} from '../clothes/drying';
import { clothesAirboxId } from '../clothes/store';

export const dryingRoute = new Hono();

// Caller mistakes keep their status; anything else means the database is not usable.
async function handle(c: Context, unavailable: string, work: () => Promise<Response>) {
  try { return await work(); } catch (error) {
    if (error instanceof HttpError) return c.json({ success: false, error: error.message }, error.status);
    return c.json({ success: false, error: unavailable }, 503);
  }
}

async function jsonBody(c: Context): Promise<unknown> {
  try { return await c.req.json(); } catch { throw new HttpError(400, '內容必須是 JSON'); }
}

// ===== Clips =====
dryingRoute.get('/clips', (c) => handle(c, '資料庫無法讀取，衣夾清單暫時不可用', async () => {
  const clips = await listClips();
  for (const clip of clips) clip.resolved_airbox_id = await clothesAirboxId(clip.id);
  return c.json({ success: true, clips });
}));

dryingRoute.patch('/clips/:id', (c) => handle(c, '資料庫無法寫入，衣夾設定沒有儲存', async () => {
  const patch = parseClipPatch(await jsonBody(c));
  const clip = await updateClip(c.req.param('id'), patch);
  return c.json({ success: true, clip: { ...clip, resolved_airbox_id: await clothesAirboxId(clip.id) } });
}));

// ===== Garments =====
dryingRoute.get('/garments', (c) => handle(c, '資料庫無法讀取，衣物庫暫時不可用', async () =>
  c.json({ success: true, garments: await listGarments() })));

dryingRoute.post('/garments', (c) => handle(c, '資料庫無法寫入，衣物沒有新增', async () => {
  const draft = parseGarment(await jsonBody(c)) as GarmentDraft;
  return c.json({ success: true, garment: await createGarment(draft) }, 201);
}));

dryingRoute.patch('/garments/:id', (c) => handle(c, '資料庫無法寫入，衣物沒有更新', async () => {
  const patch = parseGarment(await jsonBody(c), true);
  return c.json({ success: true, garment: await updateGarment(c.req.param('id'), patch) });
}));

// ===== Sessions =====
dryingRoute.get('/sessions/active', (c) => handle(c, '資料庫無法讀取，晾衣中清單暫時不可用', async () =>
  c.json({ success: true, sessions: await listActiveSessions() })));

dryingRoute.post('/sessions', (c) => handle(c, '資料庫無法寫入，晾衣沒有開始', async () => {
  const body = parseStart(await jsonBody(c));
  return c.json({ success: true, session: await startSession(body, new Date()) }, 201);
}));

dryingRoute.patch('/sessions/:id/garment', (c) => handle(c, '資料庫無法寫入，衣物沒有更換', async () => {
  const body = await jsonBody(c) as { garment_id?: unknown };
  if (typeof body !== 'object' || body === null || typeof body.garment_id !== 'string' || !body.garment_id) {
    throw new HttpError(400, '缺少欄位 garment_id');
  }
  return c.json({ success: true, session: await swapGarment(c.req.param('id'), body.garment_id, new Date()) });
}));

dryingRoute.post('/sessions/:id/end', (c) => handle(c, '資料庫無法寫入，晾衣沒有結束', async () => {
  const outcome = parseOutcome(await jsonBody(c));
  return c.json({ success: true, session: await endSession(c.req.param('id'), outcome, new Date()) });
}));

// Ended sessions (records). start/end are optional and filter on started_at.
dryingRoute.get('/sessions', (c) => handle(c, '資料庫無法讀取，晾衣紀錄暫時不可用', async () => {
  const parseTime = (text: string | undefined) => {
    if (text === undefined) return null;
    const date = new Date(text);
    if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'start／end 時間格式錯誤');
    return date;
  };
  const start = parseTime(c.req.query('start'));
  const end = parseTime(c.req.query('end'));
  if (start && end && start > end) throw new HttpError(400, '結束需晚於開始');
  const limitText = c.req.query('limit') ?? '200';
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || limit < 1 || limit > 1000) throw new HttpError(400, 'limit 必須為 1～1000');
  return c.json({ success: true, ...(await listRecords(start, end, limit)) });
}));
