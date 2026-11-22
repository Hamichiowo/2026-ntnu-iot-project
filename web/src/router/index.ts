import { createRouter, createWebHistory } from 'vue-router';
import OverviewView from '../views/OverviewView.vue';
import DevicesView from '../views/DevicesView.vue';
import ClipDetailView from '../views/ClipDetailView.vue';
import SessionsView from '../views/SessionsView.vue';
import GarmentsView from '../views/GarmentsView.vue';
import GarmentDetailView from '../views/GarmentDetailView.vue';
import StartFlowView from '../views/StartFlowView.vue';
import HistoryView from '../views/HistoryView.vue';
import DeviceDetailView from '../views/DeviceDetailView.vue';
import SettingsView from '../views/SettingsView.vue';
import WeatherView from '../views/WeatherView.vue';
import LoginView from '../views/LoginView.vue';
import { checkSession, useAuth } from '../composables/useAuth';

const routes = [
  { path: '/login', name: 'Login', component: LoginView, meta: { public: true } },
  // 智慧衣夾
  { path: '/', name: 'Overview', component: OverviewView },
  { path: '/start', name: 'StartFlow', component: StartFlowView },
  { path: '/devices', name: 'Devices', component: DevicesView },
  { path: '/clips/:id', name: 'ClipDetail', component: ClipDetailView },
  // 衣物管理：衣物列表 → 衣物詳細；全部晾衣紀錄 → 單筆紀錄
  { path: '/garments', name: 'Garments', component: GarmentsView },
  { path: '/garments/:id', name: 'GarmentDetail', component: GarmentDetailView },
  { path: '/sessions', name: 'Sessions', component: SessionsView },
  { path: '/weather', name: 'Weather', component: WeatherView },
  // 空氣盒子（MAPS）：清單併入設備狀況
  { path: '/devices/:id', name: 'DeviceDetail', component: DeviceDetailView },
  { path: '/history', name: 'History', component: HistoryView },
  { path: '/settings', name: 'Settings', component: SettingsView },
  // 舊網址
  { path: '/air', redirect: '/devices' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash, behavior: 'smooth' } : { top: 0 }),
});

router.beforeEach(async (to) => {
  const { authenticated, checked } = useAuth();
  if (!checked.value) await checkSession();
  if (to.meta.public) {
    if (to.name === 'Login' && authenticated.value) return '/';
    return true;
  }
  if (!authenticated.value) return { name: 'Login', query: { redirect: to.fullPath } };
  return true;
});
