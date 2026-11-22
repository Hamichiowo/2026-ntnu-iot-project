import { onMounted, onUnmounted, ref, watch } from 'vue';

export interface OutdoorWeather {
  county: string;
  observed_at: string;
  temp: number | null;
  hum: number | null;
  stations: number;
}

const counties = ref<string[]>([]);
const county = ref('');
const outdoor = ref<OutdoorWeather | null>(null);
const loading = ref(false);
const error = ref('');
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

async function request(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOutdoor() {
  if (!county.value) return;
  loading.value = true;
  try {
    const data = await request(`/api/v1/weather/outdoor?county=${encodeURIComponent(county.value)}`);
    outdoor.value = data.data;
    error.value = '';
  } catch {
    error.value = '氣象署資料暫時無法取得';
  } finally {
    loading.value = false;
  }
}

async function loadCounties() {
  try {
    const data = await request('/api/v1/weather/counties');
    counties.value = data.data;
    let saved = '';
    try { saved = localStorage.getItem('outdoorCounty') || ''; } catch { /* cache only */ }
    county.value = counties.value.includes(saved) ? saved : data.default || counties.value[0] || '';
    if (!county.value) error.value = '氣象署沒有可用的測站資料';
  } catch {
    error.value = '氣象署資料暫時無法取得';
  }
}

watch(county, (value) => {
  if (!value) return;
  try { localStorage.setItem('outdoorCounty', value); } catch { /* cache only */ }
  void loadOutdoor();
});

export function useOutdoorWeather() {
  onMounted(() => {
    consumers += 1;
    if (counties.value.length) void loadOutdoor();
    else void loadCounties();
    timer ??= setInterval(() => {
      if (counties.value.length) void loadOutdoor();
      else void loadCounties();
    }, 10 * 60 * 1000);
  });
  onUnmounted(() => {
    consumers -= 1;
    if (consumers === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return { counties, county, outdoor, loading, error, refresh: loadOutdoor };
}
