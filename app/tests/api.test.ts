import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { apiRouter } from '../src/routes/api';

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = '$apr1$testsalt$whrPRbusxE1/eicd7bmek.';
process.env.AUTH_COOKIE_SECURE = 'false';
delete process.env.ADMIN_HTPASSWD_FILE;
delete process.env.ADMIN_PASSWORD_UPGRADE_FILE;

const json = async <T>(response: Response) => await response.json() as T;

describe('REST API Routes', () => {
  const app = new Hono();
  app.route('/api/v1', apiRouter);
  let cookie = '';
  let csrfToken = '';

  async function authenticate() {
    if (cookie) return;
    const response = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpassword' }),
    });
    const data = await json<{ csrfToken: string }>(response);
    cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    csrfToken = data.csrfToken;
  }

  async function authenticatedRequest(path: string, init: RequestInit = {}) {
    await authenticate();
    const headers = new Headers(init.headers);
    headers.set('Cookie', cookie);
    if (!['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('X-CSRF-Token', csrfToken);
    return app.request(path, { ...init, headers });
  }

  it('GET /api/v1/system/health should return ok status', async () => {
    const res = await authenticatedRequest('/api/v1/system/health');
    expect(res.status).toBe(200);

    const data = await json<{ status: string; services: object }>(res);
    expect(data.status).toBe('ok');
    expect(data.services).toBeDefined();
  });

  it('POST /api/v1/auth/login with valid credentials should succeed', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpassword' }),
    });
    expect(res.status).toBe(200);

    const data = await json<{ success: boolean; csrfToken: string }>(res);
    expect(data.success).toBe(true);
    expect(data.csrfToken).toBeDefined();
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(res.headers.get('Set-Cookie')).toContain('SameSite=Strict');
    cookie = res.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    csrfToken = data.csrfToken;
  });

  it('reports an anonymous session without exposing protected APIs', async () => {
    const me = await app.request('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(await json<{ authenticated: boolean }>(me)).toEqual(expect.objectContaining({ authenticated: false }));
    expect((await app.request('/api/v1/devices')).status).toBe(401);
  });

  it('rejects protected APIs without a session or CSRF token', async () => {
    await authenticate();
    const response = await app.request('/api/v1/devices/TEST_DEV_01/command', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trigger_co2_cal', params: {} }),
    });
    expect(response.status).toBe(403);
  });

  it('POST /api/v1/auth/login with invalid credentials should fail', async () => {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
    });
    expect(res.status).toBe(401);

    const data = await json<{ success: boolean }>(res);
    expect(data.success).toBe(false);
  });

  it('Device configuration get and update', async () => {
    // 1. Get default config
    const getRes = await authenticatedRequest('/api/v1/devices/TEST_DEV_01/config');
    expect(getRes.status).toBe(200);
    const getData = await json<{ config: { sensor_interval: number } }>(getRes);
    expect(getData.config.sensor_interval).toBe(60);

    // 2. Patch config
    const patchRes = await authenticatedRequest('/api/v1/devices/TEST_DEV_01/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensor_interval: 30, status_interval: 120 }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = await json<{ config: { sensor_interval: number; status_interval: number } }>(patchRes);
    expect(patchData.config.sensor_interval).toBe(30);
    expect(patchData.config.status_interval).toBe(120);
  });

  it('POST /api/v1/devices/:id/command should accept commands', async () => {
    const res = await authenticatedRequest('/api/v1/devices/TEST_DEV_01/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'trigger_co2_cal',
        params: {},
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ success: boolean; action: string }>(res);
    expect(data.success).toBe(true);
    expect(data.action).toBe('trigger_co2_cal');
  });

  it('POST /api/v1/devices/:id/backfill batch ingestion', async () => {
    const res = await authenticatedRequest('/api/v1/devices/TEST_DEV_01/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-09-10',
        records: [
          {
            timestamp: '2026-09-10T08:00:00Z',
            sensor: { temp: 25.1, humi: 60, co2: 430 },
          },
          {
            timestamp: '2026-09-10T08:01:00Z',
            sensor: { temp: 25.2, humi: 59, co2: 435 },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await json<{ success: boolean; inserted: number }>(res);
    expect(data.success).toBe(true);
    expect(data.inserted).toBe(2);
  });
});
