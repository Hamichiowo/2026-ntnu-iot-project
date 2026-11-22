import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { HttpError } from '../src/clothes/drying';
import { ADS_INPUT_OHM, OPEN_FRACTION, countToOhm, dividerAt, ohmMax, parseDivider } from '../src/clothes/resistance';
import { clothesRoute } from '../src/routes/clothes';

const status = (fn: () => unknown) => { try { fn(); return 0; } catch (error) { return error instanceof HttpError ? error.status : -1; } };
// The clip's real setups: 1 MΩ divider (open reading 22740), earlier 100 kΩ (open reading 25780).
const oneMeg = { since: '2026-11-22T08:00:00Z', divider_ohm: 1_000_000, open_count: 22740 };
const hundredK = { since: '2026-11-01T00:00:00Z', divider_ohm: 100_000, open_count: 25780 };
const rth = 1_000_000 * ADS_INPUT_OHM / (1_000_000 + ADS_INPUT_OHM);

describe('Fabric resistance from the ADS1115 reading', () => {
  it('converts with the divider and the open reading', () => {
    // Half the open reading means the fabric equals the divider seen from A0 (R ∥ R_in).
    expect(countToOhm(11370, oneMeg)).toBeCloseTo(rth, 0);
    expect(countToOhm(5000, oneMeg)).toBeCloseTo(rth * 5000 / 17740, 0);
    // A wet towel with the 100 kΩ divider read about 16000 counts: about 160 kΩ.
    expect(countToOhm(16000, hundredK)! / 1000).toBeGreaterThan(150);
    expect(countToOhm(16000, hundredK)! / 1000).toBeLessThan(170);
  });
  it('reports open, short and missing readings without inventing a number', () => {
    expect(countToOhm(22740, oneMeg)).toBe(Infinity);
    expect(countToOhm(Math.ceil(22740 * OPEN_FRACTION), oneMeg)).toBe(Infinity);
    expect(Number.isFinite(countToOhm(Math.floor(22740 * OPEN_FRACTION) - 1, oneMeg)!)).toBe(true);
    expect(countToOhm(-3, oneMeg)).toBe(0);
    expect(countToOhm(null, oneMeg)).toBeNull();
    expect(ohmMax(oneMeg)).toBeCloseTo(rth * OPEN_FRACTION / (1 - OPEN_FRACTION), 0);
  });
  it('uses the setting in force at the reading time', () => {
    const list = [hundredK, oneMeg];
    expect(dividerAt(list, Date.parse('2026-10-31T00:00:00Z'))).toBeNull();
    expect(dividerAt(list, Date.parse('2026-11-15T00:00:00Z'))).toBe(hundredK);
    expect(dividerAt(list, Date.parse('2026-11-22T08:00:00Z'))).toBe(oneMeg);
    expect(dividerAt([], Date.now())).toBeNull();
  });
  it('checks a new setting', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    expect(parseDivider({ divider_ohm: 1_000_000, open_count: 22740 }, now).since).toEqual(now);
    expect(new Date(parseDivider({ divider_ohm: 100_000, open_count: 25780, since: '2026-11-01T00:00:00Z' }, now).since).toISOString())
      .toBe('2026-11-01T00:00:00.000Z');
    for (const body of [null, [], {}, { divider_ohm: 1_000_000 }, { divider_ohm: 999, open_count: 22740 }, { divider_ohm: 1_000_000.5, open_count: 22740 },
      { divider_ohm: 1_000_000, open_count: 40000 }, { divider_ohm: 1_000_000, open_count: 22740, since: 'yesterday' },
      { divider_ohm: 1_000_000, open_count: 22740, since: '2026-11-23T00:00:00Z' }, { divider_ohm: 1_000_000, open_count: 22740, extra: 1 }]) {
      expect(status(() => parseDivider(body, now))).toBe(400);
    }
  });
});

describe('Divider API without a database', () => {
  const app = new Hono().route('/clothes', clothesRoute);
  const ID = '11111111-1111-4111-8111-111111111111';
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  it('rejects bad input first, then answers 503', async () => {
    expect((await post(`/clothes/clips/${ID}/dividers`, { divider_ohm: 1 })).status).toBe(400);
    expect((await post(`/clothes/clips/${ID}/dividers`, { divider_ohm: 1_000_000, open_count: 22740 })).status).toBe(503);
    expect((await app.request(`/clothes/clips/${ID}/dividers/${ID}`, { method: 'DELETE' })).status).toBe(503);
  });
});
