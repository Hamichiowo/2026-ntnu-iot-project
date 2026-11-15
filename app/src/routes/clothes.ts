import { Hono } from 'hono';
import { CSV_HEADER, type CsvRow, clothesCsvLine, clothesExportRows, clothesHistory, clothesState, latestClothesRaw } from '../clothes/store';
import { mqttSubscriber } from '../mqtt/subscriber';

export const clothesRoute = new Hono();

clothesRoute.get('/latest', async (c) => {
  try {
    const data = await latestClothesRaw();
    const now = new Date();
    const ageMs = data ? Math.max(0, now.getTime() - new Date(data.timestamp).getTime()) : null;
    return c.json({
      success: true, data, server_time: now.toISOString(), age_ms: ageMs,
      stale: ageMs === null || ageMs > 10000,
      mqtt_connected: mqttSubscriber.isConnected(),
      ingestion_error: clothesState.lastError,
    });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，請檢查後端與 PostgreSQL' }, 503);
  }
});

export const EXPORT_MAX_DAYS = 7;
const fileStamp = (date: Date) => new Date(date.getTime() + 8 * 60 * 60000).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

// Raw CSV download for a closed time range (both ends required so the file is reproducible).
clothesRoute.get('/export', async (c) => {
  const startText = c.req.query('start');
  const endText = c.req.query('end');
  const start = new Date(startText ?? NaN);
  const end = new Date(endText ?? NaN);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end ||
      end.getTime() - start.getTime() > EXPORT_MAX_DAYS * 24 * 60 * 60000) {
    return c.json({ success: false, error: `請提供 start 與 end，結束需晚於開始，最長 ${EXPORT_MAX_DAYS} 天` }, 400);
  }
  const pages = clothesExportRows(start, end);
  let first: IteratorResult<CsvRow[], void>;
  try { first = await pages.next(); } catch {
    return c.json({ success: false, error: '資料庫無法讀取，暫時無法匯出' }, 503);
  }
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // BOM so Excel opens the UTF-8 file correctly.
      controller.enqueue(encoder.encode('\uFEFF' + CSV_HEADER));
      if (first.value) controller.enqueue(encoder.encode(first.value.map(clothesCsvLine).join('')));
    },
    async pull(controller) {
      try {
        const page = await pages.next();
        if (page.done) return controller.close();
        if (page.value.length) controller.enqueue(encoder.encode(page.value.map(clothesCsvLine).join('')));
      } catch (err) { controller.error(err); }
    },
    async cancel() { await pages.return(undefined); },
  });
  const name = `clothes_raw_${fileStamp(start)}_${fileStamp(end)}.csv`;
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store',
  } });
});

clothesRoute.get('/history', async (c) => {
  const now = new Date();
  const startText = c.req.query('start');
  const endText = c.req.query('end');
  const start = startText === undefined ? new Date(now.getTime() - 15 * 60000) : new Date(startText);
  const end = endText === undefined ? now : new Date(endText);
  const limitText = c.req.query('limit') ?? '5000';
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isInteger(limit) || limit < 1 || limit > 5000 ||
      !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end ||
      end.getTime() - start.getTime() > 24 * 60 * 60000) {
    return c.json({ success: false, error: '時間範圍最多24小時，limit 必須為1～5000' }, 400);
  }
  try {
    const result = await clothesHistory(start, end, limit);
    return c.json({ success: true, start: start.toISOString(), end: end.toISOString(), ...result });
  } catch {
    return c.json({ success: false, error: '資料庫無法讀取，歷史資料暫時不可用' }, 503);
  }
});
