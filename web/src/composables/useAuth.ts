import { computed, ref } from 'vue';

export interface AuthUser {
  username: string;
  role: string;
}

interface AuthResponse {
  success: boolean;
  user?: AuthUser;
  csrfToken?: string;
  expiresAt?: number;
  error?: string;
}

const user = ref<AuthUser | null>(null);
const csrfToken = ref('');
const checked = ref(false);
let checking: Promise<boolean> | null = null;

function applyAuth(data: AuthResponse) {
  user.value = data.user ?? null;
  csrfToken.value = data.csrfToken ?? '';
}

function clearAuth() {
  user.value = null;
  csrfToken.value = '';
}

async function authRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, cache: 'no-store', credentials: 'same-origin' });
}

export async function checkSession(): Promise<boolean> {
  checking ??= authRequest('/api/v1/auth/me')
    .then(async (response) => {
      if (!response.ok) {
        clearAuth();
        return false;
      }
      const data = await response.json() as AuthResponse;
      applyAuth(data);
      return Boolean(data.user && data.csrfToken);
    })
    .catch(() => {
      clearAuth();
      return false;
    })
    .finally(() => {
      checked.value = true;
      checking = null;
    });
  return checking;
}

export async function login(username: string, password: string): Promise<{ ok: boolean; error: string }> {
  try {
    const response = await authRequest('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => null) as AuthResponse | null;
    if (!response.ok || !data?.success || !data.user || !data.csrfToken) {
      clearAuth();
      return { ok: false, error: data?.error || '登入失敗，請稍後再試' };
    }
    applyAuth(data);
    checked.value = true;
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: '無法連線到伺服器，請稍後再試' };
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    clearAuth();
    checked.value = true;
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken.value) {
    headers.set('X-CSRF-Token', csrfToken.value);
  }
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401) {
    clearAuth();
    if (location.pathname !== '/login') {
      const redirect = `${location.pathname}${location.search}${location.hash}`;
      location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
  }
  return response;
}

export function useAuth() {
  return {
    user,
    checked,
    authenticated: computed(() => user.value !== null),
    checkSession,
    login,
    logout,
  };
}
