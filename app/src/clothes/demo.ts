// Demo data: clips 衣夾-02～08, a garment library, sessions in progress and past records, all with
// is_demo = true. It is never written on startup; `make seed` (scripts/seed-demo.ts) writes it once
// and POST /clothes/demo/reset rebuilds it. 衣夾-01 (c1) is the real clip and gets no demo data.
import { dbClient } from '../db/client';
import type { Material } from './prediction';

const MIN = 60000;
const DAY_MS = 24 * 60 * MIN;
const TAIPEI_MS = 8 * 60 * MIN;

type Style = 'tee' | 'shirt' | 'tank' | 'pants' | 'towel';
export interface DemoSeed {
  clips: { id: string; name: string }[];
  garments: { id: string; name: string; style: Style; color: string; material: Material }[];
  sessions: {
    id: string; clip_id: string; garment_id: string; started_at: Date; predicted_min: number;
    ended_at: Date | null; outcome: 'dry' | 'early' | null; actual_min: number | null;
  }[];
}

const CLIPS = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];

// Pure, so tests can check it. Times are relative to `now`.
export function demoSeed(now: number): DemoSeed {
  const clips = CLIPS.map((id) => ({ id, name: `衣夾-0${id.slice(1)}` }));
  const garments: DemoSeed['garments'] = [
    { id: 'demo-g1', name: '白色班服', style: 'tee', color: '#F2F1EC', material: '棉' },
    { id: 'demo-g2', name: '牛仔褲', style: 'pants', color: '#4A6FA5', material: '牛仔布' },
    { id: 'demo-g3', name: '運動背心', style: 'tank', color: '#2A2B30', material: '聚酯纖維' },
    { id: 'demo-g4', name: '亞麻襯衫', style: 'shirt', color: '#D8CBB0', material: '麻' },
    { id: 'demo-g5', name: '黃色浴巾', style: 'towel', color: '#E9C46A', material: '毛巾布' },
    { id: 'demo-g6', name: '黑色運動褲', style: 'pants', color: '#2A2B30', material: '聚酯纖維' },
    { id: 'demo-g7', name: '條紋毛巾', style: 'towel', color: '#4A6FA5', material: '毛巾布' },
    { id: 'demo-g8', name: '灰色帽 T', style: 'shirt', color: '#9AA3AD', material: '棉' },
  ];
  // [clip, garment, elapsed min, remaining min] — drying right now.
  const active: [string, string, number, number][] = [
    ['c2', 'demo-g2', 205, 295], ['c3', 'demo-g3', 110, 40], ['c4', 'demo-g4', 130, 185], ['c5', 'demo-g5', 80, 345],
  ];
  // [days ago, start hour (Taipei), garment, actual min (null = taken in early), predicted min]
  const past: [number, number, string, number | null, number][] = [
    [1, 9.5, 'demo-g1', 280, 265], [1, 10, 'demo-g2', 455, 420], [2, 8, 'demo-g7', 320, 340], [3, 13, 'demo-g3', 110, 115],
    [4, 9, 'demo-g4', 350, 310], [5, 9, 'demo-g1', 295, 300], [6, 10, 'demo-g6', 150, 140], [7, 11, 'demo-g7', 335, 320],
    [8, 9, 'demo-g1', 270, 290], [9, 14, 'demo-g3', 105, 100], [10, 9, 'demo-g8', 300, 285], [11, 10, 'demo-g6', null, 160],
    [12, 9, 'demo-g2', 470, 450], [13, 8, 'demo-g8', 275, 290],
  ];
  const todayStart = Math.floor((now + TAIPEI_MS) / DAY_MS) * DAY_MS - TAIPEI_MS;
  const sessions: DemoSeed['sessions'] = [
    ...active.map(([clip_id, garment_id, elapsed, left], i) => ({
      id: `demo-s${i + 1}`, clip_id, garment_id, started_at: new Date(now - elapsed * MIN), predicted_min: elapsed + left,
      ended_at: null, outcome: null, actual_min: null,
    })),
    ...past.map(([days, hour, garment_id, actual, predicted], i) => {
      const started = todayStart - days * DAY_MS + hour * 60 * MIN;
      // Taken in early: put away about halfway through.
      const ended = started + (actual ?? Math.round(predicted / 2)) * MIN;
      return {
        id: `demo-r${i + 1}`, clip_id: CLIPS[i % CLIPS.length], garment_id, started_at: new Date(started),
        predicted_min: predicted, ended_at: new Date(ended), outcome: actual == null ? 'early' as const : 'dry' as const,
        actual_min: actual,
      };
    }),
  ];
  return { clips, garments, sessions };
}

async function writeSeed(tx: any, seed: DemoSeed) {
  for (const clip of seed.clips) {
    await tx`INSERT INTO clips (id, name, is_demo) VALUES (${clip.id}, ${clip.name}, true)`;
  }
  for (const g of seed.garments) {
    await tx`INSERT INTO garments (id, name, style, color, material, is_demo) VALUES (${g.id}, ${g.name}, ${g.style}, ${g.color}, ${g.material}, true)`;
  }
  for (const s of seed.sessions) {
    await tx`
      INSERT INTO drying_sessions (id, clip_id, garment_id, started_at, predicted_min, ended_at, outcome, actual_min, is_demo)
      VALUES (${s.id}, ${s.clip_id}, ${s.garment_id}, ${s.started_at}, ${s.predicted_min}, ${s.ended_at}, ${s.outcome}, ${s.actual_min}, true)`;
  }
}

function database() {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  return dbClient.sql;
}

// Writes the demo data once. Returns false (and writes nothing) when demo clips already exist.
export async function seedDemoData(now = Date.now()): Promise<boolean> {
  return database().begin(async (tx: any) => {
    const existing = await tx`SELECT 1 FROM clips WHERE is_demo LIMIT 1`;
    if (existing.length) return false;
    await writeSeed(tx, demoSeed(now));
    return true;
  });
}

// Deletes every demo row and writes a fresh set relative to now. Real rows are not touched.
export async function resetDemoData(now = Date.now()): Promise<void> {
  await database().begin(async (tx: any) => {
    await tx`DELETE FROM drying_sessions WHERE is_demo`;
    await tx`DELETE FROM garments WHERE is_demo`;
    await tx`DELETE FROM clips WHERE is_demo`;
    await writeSeed(tx, demoSeed(now));
  });
}
