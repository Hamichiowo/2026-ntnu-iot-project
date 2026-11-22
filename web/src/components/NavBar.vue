<template>
  <header class="header">
    <div class="bar">
      <router-link to="/" class="brand">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="30" height="30" stroke="currentColor" stroke-width="2" />
          <path d="M12 7v18M20 7v18M12 15h8" stroke="currentColor" stroke-width="2.5" />
        </svg>
        <span>智慧衣夾</span>
      </router-link>

      <nav aria-label="主選單" class="nav">
        <router-link v-for="item in items" :key="item.to" :to="item.to" class="nav-item"
          :class="{ active: item.match(route.path) }" :aria-current="item.match(route.path) ? 'page' : undefined">{{ item.label }}</router-link>
      </nav>

      <div class="actions">
        <router-link to="/settings" class="icon-btn" aria-label="系統設定" title="系統設定">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" /><path :d="GEAR" stroke="currentColor" stroke-width="1.6" /></svg>
        </router-link>
        <button type="button" class="icon-btn" :aria-label="themeLabel" :title="themeLabel" @click="toggle">
          <svg v-if="isLight" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path :d="MOON" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" /><path :d="SUN_RAYS" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="登出" title="登出" @click="signOut">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path :d="LOGOUT" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>

      <button type="button" class="icon-btn menu-btn" aria-label="開啟選單" aria-controls="mobile-menu"
        :aria-expanded="menuOpen" @click="menuOpen = true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>

    <Teleport to="body">
      <Transition name="fade">
        <div v-if="menuOpen" class="backdrop" aria-hidden="true" @click="menuOpen = false" />
      </Transition>
      <Transition name="slide">
        <aside v-if="menuOpen" id="mobile-menu" ref="drawer" class="drawer" role="dialog" aria-modal="true" aria-label="選單"
          tabindex="-1" @keydown.esc="menuOpen = false">
          <div class="drawer-head">
            <span class="drawer-title">選單</span>
            <button type="button" class="icon-btn" aria-label="關閉選單" @click="menuOpen = false">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            </button>
          </div>

          <nav aria-label="主選單" class="drawer-nav">
            <router-link v-for="item in items" :key="item.to" :to="item.to" class="drawer-item"
              :class="{ active: item.match(route.path) }" :aria-current="item.match(route.path) ? 'page' : undefined">{{ item.label }}</router-link>
          </nav>

          <div class="drawer-actions">
            <router-link to="/settings" class="drawer-item" :class="{ active: route.path === '/settings' }">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" /><path :d="GEAR" stroke="currentColor" stroke-width="1.6" /></svg>
              系統設定
            </router-link>
            <button type="button" class="drawer-item" @click="toggle">
              <svg v-if="isLight" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path :d="MOON" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" /><path :d="SUN_RAYS" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
              {{ isLight ? '深色模式' : '亮色模式' }}
            </button>
            <button type="button" class="drawer-item" @click="signOut">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path :d="LOGOUT" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              登出
            </button>
          </div>
        </aside>
      </Transition>
    </Teleport>
  </header>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTheme } from '../composables/useTheme';
import { logout } from '../composables/useAuth';

const route = useRoute();
const { isLight, toggle } = useTheme();
const themeLabel = computed(() => (isLight.value ? '切換為深色模式' : '切換為亮色模式'));

const menuOpen = ref(false);
const drawer = ref<HTMLElement | null>(null);

// Close the drawer after navigating, and when the viewport grows back to desktop width.
watch(() => route.fullPath, () => { menuOpen.value = false; });
const desktop = window.matchMedia('(min-width: 901px)');
const onViewport = (e: MediaQueryListEvent) => { if (e.matches) menuOpen.value = false; };
onMounted(() => desktop.addEventListener('change', onViewport));
onBeforeUnmount(() => {
  desktop.removeEventListener('change', onViewport);
  document.body.style.overflow = '';
});

watch(menuOpen, async (open) => {
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) { await nextTick(); drawer.value?.focus(); }
});

async function signOut() {
  await logout();
  location.assign('/login');
}

const GEAR = 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z';
const MOON = 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z';
const SUN_RAYS = 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4';
const LOGOUT = 'M10 5H5v14h5M14 8l4 4-4 4M18 12H9';

// Clip detail (/clips/:id) and air box detail (/devices/:id) both live under 設備狀況;
// garments and drying records (/garments…, /sessions…) under 衣物管理.
const items = [
  { to: '/', label: '總覽', match: (p: string) => p === '/' || p === '/start' },
  { to: '/devices', label: '設備狀況', match: (p: string) => p.startsWith('/devices') || p.startsWith('/clips/') },
  { to: '/garments', label: '衣物管理', match: (p: string) => p.startsWith('/garments') || p.startsWith('/sessions') },
  { to: '/weather', label: '戶外天氣', match: (p: string) => p === '/weather' },
  { to: '/history', label: '空氣歷史', match: (p: string) => p === '/history' },
];
</script>

<style scoped>
.header { background: var(--hdr); border-bottom: 1px solid var(--bd); }
.bar { max-width: 1320px; margin: 0 auto; padding: 0 24px; display: flex; flex-wrap: wrap; align-items: stretch; gap: 0 32px; min-height: 64px; }
.brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--tx); font-weight: 900; font-size: 1.125rem; letter-spacing: 0.04em; }
.brand svg { color: var(--ac); }
.nav { display: flex; flex-wrap: wrap; align-items: stretch; }
.nav-item { display: flex; align-items: center; padding: 0 18px; min-height: 64px; text-decoration: none; color: var(--tx2); border-bottom: 3px solid transparent; }
.nav-item:hover { color: var(--tx); }
.nav-item.active { color: var(--tx); font-weight: 700; border-bottom-color: var(--ac); }
.actions { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 0.875rem; color: var(--tx2); padding: 10px 0; }
.icon-btn { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid var(--bd); background: transparent; color: var(--tx); cursor: pointer; text-decoration: none; }
.icon-btn:hover { background: var(--sf2); }
.menu-btn { display: none; }

/* Mobile drawer */
.backdrop { position: fixed; inset: 0; z-index: 100; background: rgba(0, 0, 0, 0.5); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 101; width: min(300px, 82vw); display: flex; flex-direction: column;
  background: var(--hdr); border-left: 1px solid var(--bd); overflow-y: auto; outline: none; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; min-height: 64px; padding: 0 16px; border-bottom: 1px solid var(--bd); }
.drawer-title { font-weight: 900; color: var(--tx); letter-spacing: 0.04em; }
.drawer-nav, .drawer-actions { display: flex; flex-direction: column; padding: 8px 0; }
.drawer-actions { border-top: 1px solid var(--bd); }
.drawer-item { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 20px; width: 100%; text-align: left;
  font: inherit; color: var(--tx2); background: transparent; border: 0; border-left: 3px solid transparent; text-decoration: none; cursor: pointer; }
.drawer-item:hover { color: var(--tx); background: var(--sf2); }
.drawer-item.active { color: var(--tx); font-weight: 700; border-left-color: var(--ac); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform 0.25s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); }
@media (prefers-reduced-motion: reduce) {
  .fade-enter-active, .fade-leave-active, .slide-enter-active, .slide-leave-active { transition: none; }
}

@media (max-width: 900px) {
  .bar { gap: 0 16px; padding: 0 16px; flex-wrap: nowrap; align-items: center; }
  .nav, .actions { display: none; }
  .menu-btn { display: grid; margin-left: auto; }
}
</style>
