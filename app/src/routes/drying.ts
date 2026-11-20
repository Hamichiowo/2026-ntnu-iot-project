// /api/v1/clothes/clips: per-clip settings.
import { Hono, type Context } from 'hono';
import { HttpError, listClips, parseClipPatch, updateClip } from '../clothes/drying';
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
