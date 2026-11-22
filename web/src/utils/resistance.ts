// Fabric resistance from the ADS1115 reading. Same formula as the server (app/src/clothes/resistance.ts);
// keep the two in step.
//   3V3 → divider resistor R → A0 → electrode → fabric Rx → electrode → GND
//   Rx = (R ∥ R_in) · count / (open − count)
// R_in is the ADS1115's own input impedance; `open` is the reading with nothing clamped.
export const ADS_INPUT_OHM = 6_600_000;
export const OPEN_FRACTION = 0.97;

export interface Divider { id?: string; since: string; divider_ohm: number; open_count: number }

const parallel = (a: number, b: number) => a * b / (a + b);
export const ohmMax = (d: Divider) => parallel(d.divider_ohm, ADS_INPUT_OHM) * OPEN_FRACTION / (1 - OPEN_FRACTION);

// null: no reading. Infinity: beyond what the divider resolves (open / dry fabric).
export function countToOhm(count: number | null | undefined, d: Divider): number | null {
  if (count == null) return null;
  if (count >= d.open_count * OPEN_FRACTION) return Infinity;
  if (count <= 0) return 0;
  return parallel(d.divider_ohm, ADS_INPUT_OHM) * count / (d.open_count - count);
}

// The setting in force at `time`; dividers come sorted oldest first. null before the first one.
export function dividerAt(dividers: Divider[] | null | undefined, time: number): Divider | null {
  let found: Divider | null = null;
  for (const d of dividers ?? []) {
    if (new Date(d.since).getTime() <= time) found = d; else break;
  }
  return found;
}

// 3 significant digits: 845 Ω, 12.3 kΩ, 245 kΩ, 1.23 MΩ.
export function formatOhm(ohm: number): string {
  const unit = ohm >= 1e6 ? { v: ohm / 1e6, u: 'MΩ' } : ohm >= 1e3 ? { v: ohm / 1e3, u: 'kΩ' } : { v: ohm, u: 'Ω' };
  const digits = unit.v >= 100 ? 0 : unit.v >= 10 ? 1 : 2;
  return `${unit.v.toFixed(digits)} ${unit.u}`;
}

// A reading as text, with the divider in force at its time: "245 kΩ", "> 27.7 MΩ" (open), or null
// when there is no reading or no divider setting yet (then show the raw count instead).
export function ohmText(count: number | null | undefined, time: number, dividers: Divider[] | null | undefined): string | null {
  const d = dividerAt(dividers, time);
  if (!d || count == null) return null;
  const ohm = countToOhm(count, d)!;
  return Number.isFinite(ohm) ? formatOhm(ohm) : `> ${formatOhm(ohmMax(d))}`;
}
