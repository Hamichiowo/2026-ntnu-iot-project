import { describe, expect, it } from 'bun:test';
import { parseForecastLocation, summarizeCounty, type Observation } from '../src/routes/weather';

describe('CWA weather normalization', () => {
  it('joins forecast elements into chronological periods', () => {
    const location = {
      weatherElement: [
        { elementName: 'Wx', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '短暫雨', parameterValue: '8' } }] },
        { elementName: 'PoP', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '70' } }] },
        { elementName: 'MinT', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '19' } }] },
        { elementName: 'MaxT', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '23' } }] },
        { elementName: 'CI', time: [{ startTime: '2026-11-22 12:00:00', endTime: '2026-11-22 18:00:00', parameter: { parameterName: '稍有寒意' } }] },
      ],
    };
    expect(parseForecastLocation(location)).toEqual([{
      start: '2026-11-22 12:00:00', end: '2026-11-22 18:00:00', weather: '短暫雨', weather_code: 8,
      rain_probability: 70, min_temp: 19, max_temp: 23, comfort: '稍有寒意',
    }]);
  });

  it('summarizes county observations and keeps the strongest rain and gust', () => {
    const base: Observation = {
      id: 'A', name: '甲站', county: '臺北市', town: '', observed_at: '2026-11-22T12:00:00+08:00', weather: '晴',
      temp: 20, hum: 60, rain_mm: 0, wind_speed: 2, wind_direction: 90, gust_speed: 5, pressure: 1012,
    };
    const result = summarizeCounty([
      base,
      { ...base, id: 'B', name: '乙站', temp: 24, hum: 70, rain_mm: 3.2, wind_speed: 4, gust_speed: 12, observed_at: '2026-11-22T12:10:00+08:00' },
    ], '臺北市');
    expect(result).toMatchObject({ temp: 22, hum: 65, rain_mm: 3.2, wind_speed: 3, wind_direction: 90, gust_speed: 12, stations: 2 });
  });
});
