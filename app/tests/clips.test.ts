import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { clothesRoute } from '../src/routes/clothes';
import { HttpError, parseClipPatch } from '../src/clothes/drying';
import { clipTopic, isDeviceId, parseClipTopic } from '../src/clothes/store';

const status = (fn: () => unknown) => { try { fn(); return 0; } catch (error) { return error instanceof HttpError ? error.status : -1; } };

describe('Clip settings', () => {
  it('accepts clip settings, including clearing the air box', () => {
    expect(parseClipPatch({ airbox_id: null })).toEqual({ airbox_id: null });
    expect(parseClipPatch({ airbox_id: 'B827EBE1580E', predict_method: 'touch_raw' }))
      .toEqual({ airbox_id: 'B827EBE1580E', predict_method: 'touch_raw' });
    for (const body of [{}, { airbox_id: 'a b' }, { predict_method: 'weight' }, { name: '' }, { online: true }]) {
      expect(status(() => parseClipPatch(body))).toBe(400);
    }
  });
});

describe('Clip topics', () => {
  it('names a clip\'s topics after its device id', () => {
    expect(clipTopic('FC012CD245E0', 'raw')).toBe('clothes/FC012CD245E0/raw');
    expect(clipTopic('FC012CD245E0', 'ota')).toBe('clothes/FC012CD245E0/ota');
    expect(parseClipTopic('clothes/FC012CD245E0/raw')).toEqual({ deviceId: 'FC012CD245E0', kind: 'raw' });
    expect(parseClipTopic('clothes/FC012CD245E0/fw')).toEqual({ deviceId: 'FC012CD245E0', kind: 'fw' });
  });
  it('accepts only 12 upper-case hex digits as a device id', () => {
    expect(isDeviceId('FC012CD245E0')).toBe(true);
    for (const id of ['fc012cd245e0', 'FC012CD245E', 'FC012CD245E0A', 'GC012CD245E0', '', 12, null]) expect(isDeviceId(id)).toBe(false);
    // The shared topic of older firmware and other shapes are not clip topics.
    for (const topic of ['clothes/raw', 'clothes/raw/fw', 'clothes/fc012cd245e0/raw', 'clothes/FC012CD245E0/ota',
      'clothes/FC012CD245E0/raw/x', 'MAPS/FC012CD245E0/raw', 'clothes/+/raw']) {
      expect(parseClipTopic(topic)).toBeNull();
    }
  });
});

describe('Clip API without a database', () => {
  const app = new Hono().route('/clothes', clothesRoute);
  const send = (method: string, path: string, body?: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  it('answers 503 instead of pretending to succeed', async () => {
    expect((await app.request('/clothes/clips')).status).toBe(503);
    expect((await send('PATCH', '/clothes/clips/11111111-1111-4111-8111-111111111111', { predict_method: 'touch_raw' })).status).toBe(503);
  });
  it('rejects bad input before touching the database', async () => {
    expect((await send('PATCH', '/clothes/clips/11111111-1111-4111-8111-111111111111', { predict_method: 'weight' })).status).toBe(400);
    expect((await app.request('/clothes/clips/11111111-1111-4111-8111-111111111111', { method: 'PATCH', body: '{broken' })).status).toBe(400);
    expect((await app.request('/clothes/latest?clip=a%20b')).status).toBe(400);
    expect((await app.request('/clothes/latest?clip=c1')).status).toBe(400);
    expect((await send('PATCH', '/clothes/clips/c1', { predict_method: 'touch_raw' })).status).toBe(404);
    expect((await app.request('/clothes/clips/c2', { method: 'DELETE' })).status).toBe(404);
  });
});
