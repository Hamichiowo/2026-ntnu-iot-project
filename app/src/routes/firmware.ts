// /api/v1/clothes/firmware: upload an ESP32 image, roll it out to clips, and serve it to them.
import { Hono, type Context } from 'hono';
import { HttpError } from '../clothes/drying';
import {
  FIRMWARE_MAX_BYTES, cancelFirmwareJob, firmwareImageData, firmwareState, parseFirmwareImage, parseRolloutTarget,
  saveFirmwareImage, startRollout,
} from '../clothes/firmware';

export const firmwareRoute = new Hono();

async function handle(c: Context, unavailable: string, work: () => Promise<Response>) {
  try { return await work(); } catch (error) {
    if (error instanceof HttpError) return c.json({ success: false, error: error.message }, error.status);
    return c.json({ success: false, error: unavailable }, 503);
  }
}

// Images (without their bytes), recent jobs and what each clip says it runs.
firmwareRoute.get('/', (c) => handle(c, '資料庫無法讀取，韌體資料暫時不可用', async () =>
  c.json({ success: true, max_bytes: FIRMWARE_MAX_BYTES, ...await firmwareState() })));

// multipart/form-data with one field: file.
firmwareRoute.post('/', (c) => handle(c, '資料庫無法寫入，韌體沒有儲存', async () => {
  if (Number(c.req.header('Content-Length') || 0) > FIRMWARE_MAX_BYTES + 65536) throw new HttpError(400, '韌體檔太大');
  let file: unknown;
  try { file = (await c.req.parseBody()).file; } catch { throw new HttpError(400, '請用 multipart/form-data 上傳 file 欄位'); }
  if (!(file instanceof File)) throw new HttpError(400, '請用 multipart/form-data 上傳 file 欄位');
  if (file.size > FIRMWARE_MAX_BYTES) throw new HttpError(400, '韌體檔太大');
  const bytes = new Uint8Array(await file.arrayBuffer());
  parseFirmwareImage(bytes);  // reject a bad file before the database is involved
  return c.json({ success: true, image: await saveFirmwareImage(file.name, bytes) }, 201);
}));

firmwareRoute.post('/:id/rollout', (c) => handle(c, '資料庫或 MQTT 無法使用，沒有開始更新', async () => {
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new HttpError(400, '內容必須是 JSON'); }
  const target = parseRolloutTarget(body);
  return c.json({ success: true, ...await startRollout(c.req.param('id'), target) });
}));

firmwareRoute.post('/jobs/:id/cancel', (c) => handle(c, '資料庫無法寫入，沒有取消', async () => {
  await cancelFirmwareJob(c.req.param('id'));
  return c.json({ success: true });
}));

// Called by the clip itself (no login session): the token from its OTA command is the credential.
firmwareRoute.get('/:id/image', async (c) => {
  try {
    const data = await firmwareImageData(c.req.param('id'), c.req.query('token') ?? '');
    if (!data) return c.json({ success: false, error: '找不到韌體或 token 不正確' }, 404);
    return new Response(data, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length), 'Cache-Control': 'no-store',
    } });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取' }, 503);
  }
});
