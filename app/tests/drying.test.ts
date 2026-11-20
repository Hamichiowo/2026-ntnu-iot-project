import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { clothesRoute } from '../src/routes/clothes';
import { HttpError, parseGarment, parseOutcome, parseStart } from '../src/clothes/drying';
import { BASE_MINUTES, predictMinutes, swappedPrediction } from '../src/clothes/prediction';

const garment = { name: '白色班服', style: 'tee', color: '#F2F1EC', material: '棉' };
const status = (fn: () => unknown) => { try { fn(); return 0; } catch (error) { return error instanceof HttpError ? error.status : -1; } };

describe('Drying prediction', () => {
  it('uses the garment average, or the material default without history', () => {
    expect(predictMinutes('棉', [])).toBe(BASE_MINUTES['棉']);
    expect(predictMinutes('牛仔布', [400, 451])).toBe(426);
    expect(predictMinutes('棉', [0])).toBe(1);
  });
  it('never predicts a swapped garment to be dry before now', () => {
    expect(swappedPrediction(200, 110)).toBe(210);
    expect(swappedPrediction(30, 285)).toBe(285);
  });
});

describe('Drying body validation', () => {
  it('requires every garment field on create and at least one on update', () => {
    expect(parseGarment({ ...garment, name: '  白色班服 ' })).toEqual(garment);
    expect(status(() => parseGarment({ ...garment, style: undefined }))).toBe(400);
    expect(status(() => parseGarment({ ...garment, color: 'red' }))).toBe(400);
    expect(status(() => parseGarment({ ...garment, material: '絲' }))).toBe(400);
    expect(status(() => parseGarment({ ...garment, name: 'x'.repeat(41) }))).toBe(400);
    expect(status(() => parseGarment({ ...garment, extra: 1 }))).toBe(400);
    expect(status(() => parseGarment([]))).toBe(400);
    expect(parseGarment({ color: '#000000' }, true)).toEqual({ color: '#000000' });
    expect(status(() => parseGarment({}, true))).toBe(400);
  });
  it('takes either an existing garment or a new one when starting', () => {
    expect(parseStart({ clip_id: 'c1', garment_id: 'g_1' })).toEqual({ clip_id: 'c1', garment_id: 'g_1' });
    expect(parseStart({ clip_id: 'c1', garment })).toEqual({ clip_id: 'c1', garment } as any);
    for (const body of [{ clip_id: 'c1' }, { clip_id: 'c1', garment_id: 'g_1', garment }, { garment_id: 'g_1' },
      { clip_id: 'c1', garment: { name: 'x' } }]) {
      expect(status(() => parseStart(body))).toBe(400);
    }
  });
  it('only ends a session as dry, early or cancel', () => {
    expect(parseOutcome({ outcome: 'early' })).toBe('early');
    expect(status(() => parseOutcome({ outcome: 'done' }))).toBe(400);
  });
});

describe('Drying API without a database', () => {
  const app = new Hono().route('/clothes', clothesRoute);
  const send = (method: string, path: string, body?: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  it('answers 503 instead of pretending to succeed', async () => {
    for (const path of ['/clothes/garments', '/clothes/sessions/active', '/clothes/sessions']) {
      expect((await app.request(path)).status).toBe(503);
    }
    expect((await send('POST', '/clothes/garments', garment)).status).toBe(503);
    expect((await send('POST', '/clothes/sessions', { clip_id: 'c1', garment_id: 'g_1' })).status).toBe(503);
    expect((await send('POST', '/clothes/sessions/s_1/end', { outcome: 'dry' })).status).toBe(503);
  });
  it('rejects bad input before touching the database', async () => {
    expect((await send('POST', '/clothes/garments', { name: 'x' })).status).toBe(400);
    expect((await app.request('/clothes/garments', { method: 'POST', body: '{broken' })).status).toBe(400);
    expect((await send('PATCH', '/clothes/sessions/s_1/garment', {})).status).toBe(400);
    expect((await send('POST', '/clothes/sessions/s_1/end', { outcome: 'later' })).status).toBe(400);
    for (const query of ['limit=0', 'limit=1001', 'start=bad', 'start=2026-01-02&end=2026-01-01']) {
      expect((await app.request(`/clothes/sessions?${query}`)).status).toBe(400);
    }
  });
});
