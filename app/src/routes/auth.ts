// ==============================================================================
// Authentication Routes (Simple Admin Auth)
// ==============================================================================

import { Hono } from 'hono';
import {
  clearLoginFailures,
  createSession,
  destroySession,
  loginAllowed,
  readSession,
  recordLoginAttempt,
  verifyAdminCredentials,
} from '../auth/session';

export const authRoute = new Hono();

// POST /api/v1/auth/login
authRoute.post('/login', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return c.json({ success: false, error: 'Content-Type must be application/json' }, 415);
  }
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > 4096) return c.json({ success: false, error: 'Request body too large' }, 413);
  const throttle = loginAllowed(c);
  if (!throttle.allowed) {
    c.header('Retry-After', String(throttle.retryAfter));
    return c.json({ success: false, error: '登入嘗試過多，請稍後再試' }, 429);
  }
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body;
  recordLoginAttempt(c);
  if (typeof username === 'string' && typeof password === 'string'
    && username.length <= 128 && password.length <= 1024
    && await verifyAdminCredentials(username, password)) {
    clearLoginFailures(c);
    const session = createSession(c, username);
    return c.json({
      success: true,
      user: { username, role: 'administrator' },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  }
  return c.json({ success: false, error: '帳號或密碼錯誤' }, 401);
});

// POST /api/v1/auth/logout
authRoute.post('/logout', (c) => {
  destroySession(c);
  return c.json({ success: true, message: 'Logged out' });
});

// GET /api/v1/auth/me
authRoute.get('/me', (c) => {
  c.header('Cache-Control', 'no-store');
  const session = readSession(c);
  if (!session) return c.json({ success: true, authenticated: false, user: null });
  return c.json({
    success: true,
    authenticated: true,
    user: { username: session.username, role: 'administrator' },
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
});
