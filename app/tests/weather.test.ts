import { describe, expect, it } from 'bun:test';
import { parseForecastLocation, selectDistrictObservation, summarizeCounty, type Observation } from '../src/routes/weather';

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

  it('selects the latest exact station within the requested district', () => {
    const base: Observation = {
      id: 'A', name: '信義舊站', county: '臺北市', town: '信義區', observed_at: '2026-11-22T12:00:00+08:00', weather: '晴',
      temp: 20, hum: 60, rain_mm: 0, wind_speed: 2, wind_direction: 91.4, gust_speed: 5, pressure: 1012,
    };
    const result = selectDistrictObservation([
      base,
      { ...base, id: 'B', name: '信義新站', temp: 24.26, observed_at: '2026-11-22T12:10:00+08:00' },
      { ...base, id: 'C', name: '士林站', town: '士林區', temp: 18, observed_at: '2026-11-22T12:20:00+08:00' },
    ], '臺北市', '信義區');

    expect(result).toMatchObject({ county: '臺北市', district: '信義區', station_id: 'B', station_name: '信義新站', temp: 24.3, wind_direction: 91, stations: 1 });
  });

  it('does not cross county boundaries when district names match', () => {
    const observation = (id: string, county: string): Observation => ({
      id, name: `${county}中正站`, county, town: '中正區', observed_at: '2026-11-22T12:00:00+08:00', weather: '晴',
      temp: county === '臺北市' ? 21 : 27, hum: 60, rain_mm: 0, wind_speed: 2, wind_direction: 90, gust_speed: 5, pressure: 1012,
    });

    expect(selectDistrictObservation([observation('A', '臺北市'), observation('B', '基隆市')], '臺北市', '中正區'))
      .toMatchObject({ county: '臺北市', district: '中正區', station_id: 'A', temp: 21 });
  });
});
