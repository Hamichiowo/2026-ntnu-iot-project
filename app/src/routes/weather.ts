import { Hono } from 'hono';

export const weatherRoute = new Hono();

const BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';
const OBSERVATION_DATASETS = ['O-A0001-001', 'O-A0003-001'];
const FORECAST_DATASET = 'F-C0032-001';
const OBSERVATION_TTL_MS = 10 * 60 * 1000;
const FORECAST_TTL_MS = 30 * 60 * 1000;

export interface Observation {
  id: string;
  name: string;
  county: string;
  town: string;
  observed_at: string;
  weather: string | null;
  temp: number | null;
  hum: number | null;
  rain_mm: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  gust_speed: number | null;
  pressure: number | null;
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

let observationCache: { at: number; map: Map<string, Observation> } | null = null;
let forecastCache: { at: number; map: Map<string, ForecastPeriod[]> } | null = null;

const num = (value: unknown): number | null => {
  const parsed = Number(value);
  return value == null || value === '' || !Number.isFinite(parsed) || parsed <= -99 ? null : parsed;
};
const round1 = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const mode = (values: string[]): string | null => {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
};

async function fetchObservationDataset(dataset: string, key: string): Promise<Observation[]> {
  const params = new URLSearchParams({ Authorization: key, format: 'JSON' });
  const response = await fetch(`${BASE}/${dataset}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`氣象署 ${dataset} HTTP ${response.status}`);
  const json: any = await response.json();
  const stations: any[] = json?.records?.Station ?? [];
  return stations.map((station) => {
    const weather = station.WeatherElement ?? {};
    let humidity = num(weather.RelativeHumidity);
    if (humidity !== null && humidity <= 1) humidity *= 100;
    const weatherText = String(weather.Weather ?? '').trim();
    return {
      id: String(station.StationId ?? ''),
      name: String(station.StationName ?? ''),
      county: station.GeoInfo?.CountyName ?? station.CountyName ?? '其他',
      town: station.GeoInfo?.TownName ?? station.TownName ?? '',
      observed_at: station.ObsTime?.DateTime ?? '',
      weather: weatherText && weatherText !== '-99' ? weatherText : null,
      temp: num(weather.AirTemperature),
      hum: humidity,
      rain_mm: num(weather.Now?.Precipitation),
      wind_speed: num(weather.WindSpeed),
      wind_direction: num(weather.WindDirection),
      gust_speed: num(weather.GustInfo?.PeakGustSpeed),
      pressure: num(weather.AirPressure),
    };
  }).filter((station) => station.id && station.name);
}

async function loadObservations(): Promise<Map<string, Observation>> {
  if (observationCache && Date.now() - observationCache.at < OBSERVATION_TTL_MS) return observationCache.map;
  const key = process.env.CWA_API_KEY;
  if (!key) throw new Error('後端未設定 CWA_API_KEY');
  const results = await Promise.allSettled(OBSERVATION_DATASETS.map((dataset) => fetchObservationDataset(dataset, key)));
  const map = new Map<string, Observation>();
  for (const result of results) {
    if (result.status === 'fulfilled') for (const observation of result.value) map.set(observation.id, observation);
  }
  if (map.size === 0) {
    if (observationCache) return observationCache.map;
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    throw new Error(failed ? String(failed.reason?.message ?? failed.reason) : '氣象署沒有回傳測站');
  }
  observationCache = { at: Date.now(), map };
  return map;
}

export function parseForecastLocation(location: any): ForecastPeriod[] {
  const periods = new Map<string, ForecastPeriod>();
  const fieldMap: Record<string, keyof ForecastPeriod> = {
    Wx: 'weather', PoP: 'rain_probability', PoP12h: 'rain_probability', MinT: 'min_temp', MaxT: 'max_temp', CI: 'comfort',
  };
  for (const element of location?.weatherElement ?? []) {
    const field = fieldMap[element?.elementName];
    if (!field) continue;
    for (const slot of element?.time ?? []) {
      if (!slot?.startTime) continue;
      const period = periods.get(slot.startTime) ?? {
        start: slot.startTime, end: slot.endTime ?? '', weather: null, weather_code: null,
        rain_probability: null, min_temp: null, max_temp: null, comfort: null,
      };
      const parameter = slot.parameter ?? {};
      if (field === 'weather') {
        period.weather = String(parameter.parameterName ?? '').trim() || null;
        period.weather_code = num(parameter.parameterValue);
      } else if (field === 'comfort') {
        period.comfort = String(parameter.parameterName ?? '').trim() || null;
      } else {
        const value = num(parameter.parameterName);
        if (field === 'rain_probability') period.rain_probability = value;
        if (field === 'min_temp') period.min_temp = value;
        if (field === 'max_temp') period.max_temp = value;
      }
      if (slot.endTime) period.end = slot.endTime;
      periods.set(slot.startTime, period);
    }
  }
  return [...periods.values()].sort((a, b) => a.start.localeCompare(b.start));
}

async function loadForecasts(): Promise<Map<string, ForecastPeriod[]>> {
  if (forecastCache && Date.now() - forecastCache.at < FORECAST_TTL_MS) return forecastCache.map;
  const key = process.env.CWA_API_KEY;
  if (!key) throw new Error('後端未設定 CWA_API_KEY');
  try {
    const params = new URLSearchParams({ Authorization: key, format: 'JSON' });
    const response = await fetch(`${BASE}/${FORECAST_DATASET}?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`氣象署 ${FORECAST_DATASET} HTTP ${response.status}`);
    const json: any = await response.json();
    const map = new Map<string, ForecastPeriod[]>();
    for (const location of json?.records?.location ?? []) {
      const county = String(location?.locationName ?? '');
      if (county) map.set(county, parseForecastLocation(location));
    }
    if (!map.size) throw new Error('氣象署沒有回傳預報');
    forecastCache = { at: Date.now(), map };
    return map;
  } catch (error) {
    if (forecastCache) return forecastCache.map;
    throw error;
  }
}

function windDirection(observations: Observation[]): number | null {
  const samples = observations.filter((item) => item.wind_direction !== null);
  if (!samples.length) return null;
  let x = 0;
  let y = 0;
  for (const sample of samples) {
    const radians = sample.wind_direction! * Math.PI / 180;
    const weight = sample.wind_speed && sample.wind_speed > 0 ? sample.wind_speed : 1;
    x += Math.sin(radians) * weight;
    y += Math.cos(radians) * weight;
  }
  return Math.round((Math.atan2(x, y) * 180 / Math.PI + 360) % 360);
}

export function summarizeCounty(observations: Observation[], county: string) {
  const selected = observations.filter((item) => item.county === county);
  if (!selected.length) return null;
  const values = (field: keyof Observation) => selected.map((item) => item[field]).filter((value): value is number => typeof value === 'number');
  const observedAt = selected.map((item) => item.observed_at).filter(Boolean).sort().at(-1) ?? '';
  return {
    county,
    observed_at: observedAt,
    weather: mode(selected.map((item) => item.weather).filter((value): value is string => value !== null)),
    temp: round1(median(values('temp'))),
    hum: round1(median(values('hum'))),
    rain_mm: round1(values('rain_mm').length ? Math.max(...values('rain_mm')) : null),
    wind_speed: round1(median(values('wind_speed'))),
    wind_direction: windDirection(selected),
    gust_speed: round1(values('gust_speed').length ? Math.max(...values('gust_speed')) : null),
    pressure: round1(median(values('pressure'))),
    stations: selected.length,
  };
}

const defaultStation = () => process.env.CWA_STATION || '臺北';
const defaultCounty = (observations: Observation[]) => observations.find((item) => item.name === defaultStation())?.county;

async function countyDetail(requested: string | undefined) {
  const [observationMap, forecastMap] = await Promise.all([loadObservations(), loadForecasts()]);
  const observations = [...observationMap.values()];
  const county = requested || defaultCounty(observations);
  if (!county) return null;
  const current = summarizeCounty(observations, county);
  if (!current) return null;
  return { current, forecast: forecastMap.get(county) ?? [], forecast_updated_at: forecastCache?.at ?? null };
}

weatherRoute.get('/counties', async (context) => {
  try {
    const all = [...(await loadObservations()).values()].filter((item) => item.temp !== null);
    const counties = [...new Set(all.map((item) => item.county))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    return context.json({ success: true, data: counties, default: defaultCounty(all) ?? counties[0] ?? null });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});

weatherRoute.get('/outdoor', async (context) => {
  try {
    const detail = await countyDetail(context.req.query('county'));
    if (!detail) return context.json({ success: false, error: '找不到這個縣市' }, 404);
    return context.json({ success: true, data: detail.current });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});

weatherRoute.get('/detail', async (context) => {
  try {
    const detail = await countyDetail(context.req.query('county'));
    if (!detail) return context.json({ success: false, error: '找不到這個縣市' }, 404);
    return context.json({ success: true, data: detail });
  } catch (error) {
    return context.json({ success: false, error: (error as Error).message }, 502);
  }
});
