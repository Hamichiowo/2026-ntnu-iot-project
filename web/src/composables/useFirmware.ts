// Firmware updates for the device page.
// Real clips go through the server (/api/v1/clothes/firmware): it stores the image, queues one job
// per clip and follows what the clip reports. Demo clips have no device behind them, so their
// rollout is simulated here, like the rest of their state.
import { computed, reactive, ref } from 'vue';
import { apiFetch } from './useAuth';

export type FirmwarePhase = 'offline' | 'wait' | 'down' | 'boot' | 'done' | 'failed';
export const FIRMWARE_PHASE: Record<FirmwarePhase, string> = {
  offline: '已排入更新，上線後自動開始',
  wait: '等衣夾醒來',
  down: '下載中',
  boot: '驗證並重新開機',
  done: '更新完成',
  failed: '更新失敗',
};
export interface FirmwareJob { id: string; name: string; to: string; phase: FirmwarePhase; pct: number; detail: string; cancellable: boolean }
export interface FirmwareTarget { id: string; name: string; online: boolean; live: boolean }
export interface FirmwareEvent { at: number; device: string; text: string; tone: string }

interface ServerJob { id: string; clip_id: string; clip_name: string; version: string; state: 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled'; progress: number; detail: string | null; created_at: string; updated_at: string }
interface ServerClip { clip_id: string; version: string }
const serverJobs = ref<ServerJob[]>([]);
const serverVersions = ref<Record<string, string>>({});
const loadError = ref('');
const maxBytes = ref(3 * 1024 * 1024);

// ----- demo clips: simulated rollout
interface SimJob { id: string; name: string; to: string; phase: FirmwarePhase; pct: number; delay: number }
const simJobs = ref<SimJob[]>([]);
const simEvents = ref<FirmwareEvent[]>([]);
const simVersions = reactive<Record<string, string>>({});
let simTimer: ReturnType<typeof setInterval> | undefined;

function simTick() {
  for (const j of simJobs.value) {
    if (j.phase === 'wait') { j.delay -= 1; if (j.delay <= 0) j.phase = 'down'; }
    else if (j.phase === 'down') { j.pct = Math.min(95, j.pct + 5); if (j.pct >= 95) { j.phase = 'boot'; j.delay = 6; } }
    else if (j.phase === 'boot') {
      j.delay -= 1;
      if (j.delay <= 0) {
        j.phase = 'done'; j.pct = 100; j.delay = 20;
        simVersions[j.id] = j.to;
        simEvents.value.unshift({ at: Date.now(), device: j.name, text: `韌體更新為 ${j.to} 完成`, tone: 'ac-tx' });
      }
    } else if (j.phase === 'done') j.delay -= 1;
  }
  // A finished clip keeps its "done" line for a few seconds, then the card goes back to normal.
  simJobs.value = simJobs.value.filter((j) => j.phase !== 'done' || j.delay > 0);
  if (!simJobs.value.some((j) => j.phase !== 'offline')) { clearInterval(simTimer); simTimer = undefined; }
}
function simStart(version: string, targets: FirmwareTarget[]) {
  const fresh = targets.filter((t) => !simJobs.value.some((j) => j.id === t.id));
  simJobs.value.push(...fresh.map((t, i): SimJob => ({
    id: t.id, name: t.name, to: version, phase: t.online ? 'wait' : 'offline', pct: 0, delay: 5 + i * 6,
  })));
  if (!simTimer) simTimer = setInterval(simTick, 400);
}

// ----- real clips: the server
const RECENT_MS = 60000;  // how long a finished job stays on its card
const active = (job: ServerJob) => job.state === 'queued' || job.state === 'downloading';

async function load() {
  try {
    const res = await apiFetch('/api/v1/clothes/firmware', { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    serverJobs.value = data.jobs;
    serverVersions.value = Object.fromEntries((data.clips as ServerClip[]).map((c) => [c.clip_id, c.version]));
    maxBytes.value = data.max_bytes;
    loadError.value = '';
  } catch {
    loadError.value = '無法讀取韌體更新狀態，請檢查後端。';
  }
}

// Poll while the device page is open: quickly during an update, slowly otherwise.
let watchers = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
function poll() {
  pollTimer = setTimeout(async () => { await load(); if (watchers) poll(); }, serverJobs.value.some(active) ? 3000 : 15000);
}
function watch() {
  watchers += 1;
  if (watchers === 1) { void load(); poll(); }
  return () => { watchers -= 1; if (!watchers) clearTimeout(pollTimer); };
}

async function request(path: string, init: RequestInit): Promise<any> {
  let res: Response;
  try { res = await apiFetch(path, init); } catch { throw new Error('無法連線到伺服器'); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error ?? `伺服器回應 ${res.status}`);
  return data;
}

// Uploads the image when a real clip is among the targets, then starts both kinds of rollout.
async function start(file: File, version: string, targets: FirmwareTarget[]) {
  const real = targets.filter((t) => t.live);
  if (real.length) {
    const form = new FormData();
    form.set('file', file);
    const { image } = await request('/api/v1/clothes/firmware', { method: 'POST', body: form });
    await request(`/api/v1/clothes/firmware/${image.id}/rollout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clip_ids: real.map((t) => t.id) }),
    });
    await load();
  }
  simStart(version, targets.filter((t) => !t.live));
}

const actionError = ref('');
async function cancel(clipId: string) {
  actionError.value = '';
  const sim = simJobs.value.find((j) => j.id === clipId);
  if (sim) {
    if (sim.phase !== 'wait' && sim.phase !== 'offline') return;
    simJobs.value = simJobs.value.filter((j) => j.id !== clipId);
    simEvents.value.unshift({ at: Date.now(), device: sim.name, text: `取消韌體更新（${sim.to}）`, tone: 'muted-2' });
    return;
  }
  const job = serverJobs.value.find((j) => j.clip_id === clipId && active(j));
  if (!job) return;
  try { await request(`/api/v1/clothes/firmware/jobs/${job.id}/cancel`, { method: 'POST' }); }
  catch (error) { actionError.value = (error as Error).message; }
  await load();
}

// What a clip's card shows: its job under way, or one that just ended.
function jobOf(clipId: string, online = true): FirmwareJob | undefined {
  const sim = simJobs.value.find((j) => j.id === clipId);
  if (sim) return { id: sim.id, name: sim.name, to: sim.to, phase: sim.phase, pct: sim.pct, detail: '', cancellable: sim.phase === 'wait' || sim.phase === 'offline' };
  const job = serverJobs.value.find((j) => j.clip_id === clipId);  // newest first
  if (!job || job.state === 'cancelled') return undefined;
  const ended = !active(job);
  if (ended && Date.now() - new Date(job.updated_at).getTime() > (job.state === 'failed' ? 10 * RECENT_MS : RECENT_MS)) return undefined;
  const phase: FirmwarePhase = job.state === 'done' ? 'done' : job.state === 'failed' ? 'failed'
    : job.state === 'queued' ? (online ? 'wait' : 'offline') : job.progress >= 100 ? 'boot' : 'down';
  return { id: job.id, name: job.clip_name, to: job.version, phase, pct: job.progress, detail: job.detail ?? '', cancellable: job.state === 'queued' };
}

const events = computed<FirmwareEvent[]>(() => [
  ...simEvents.value,
  ...serverJobs.value.filter((j) => !active(j)).map((j) => ({
    at: new Date(j.updated_at).getTime(), device: j.clip_name,
    text: j.state === 'done' ? `韌體更新為 ${j.version} 完成` : j.state === 'failed' ? `韌體更新（${j.version}）失敗：${j.detail ?? ''}` : `取消韌體更新（${j.version}）`,
    tone: j.state === 'done' ? 'ac-tx' : j.state === 'failed' ? 'wa-tx' : 'muted-2',
  })),
].sort((a, b) => b.at - a.at));

export function useFirmware() {
  return {
    events, loadError, actionError, maxBytes, start, cancel, jobOf, watch,
    versionOf: (clipId: string): string | undefined => simVersions[clipId] ?? serverVersions.value[clipId],
  };
}
