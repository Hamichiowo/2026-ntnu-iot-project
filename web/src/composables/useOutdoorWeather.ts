import { onMounted, onUnmounted, ref, watch } from 'vue';

export interface OutdoorWeather {
  county: string;
  observed_at: string;
  weather: string | null;
  temp: number | null;
  hum: number | null;
  rain_mm: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  gust_speed: number | null;
  pressure: number | null;
  stations: number;
}

export interface ForecastPeriod {
  start: string;
  end: string;
  weather: string | null;
  weather_code: number | null;
  rain_probability: number | null;
  min_temp: number | null;
  max_temp: number | null;
  comfort: string | null;
}

const counties = ref<string[]>([]);
const county = ref('');
const outdoor = ref<OutdoorWeather | null>(null);
const forecast = ref<ForecastPeriod[]>([]);
const forecastUpdatedAt = ref<number | null>(null);
const loading = ref(false);
const error = ref('');
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let latestRequest = 0;

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
  const requestId = ++latestRequest;
  loading.value = true;
  try {
    const data = await request(`/api/v1/weather/detail?county=${encodeURIComponent(county.value)}`);
    if (requestId !== latestRequest) return;
    outdoor.value = data.data.current;
    forecast.value = data.data.forecast;
    forecastUpdatedAt.value = data.data.forecast_updated_at;
    error.value = '';
  } catch {
    if (requestId !== latestRequest) return;
    outdoor.value = null;
    forecast.value = [];
    forecastUpdatedAt.value = null;
    error.value = '氣象署資料暫時無法取得';
  } finally {
    if (requestId === latestRequest) loading.value = false;
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
  return { counties, county, outdoor, forecast, forecastUpdatedAt, loading, error, refresh: loadOutdoor };
}
