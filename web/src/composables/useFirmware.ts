// Firmware update state for the device page. UI preview only: nothing is sent to a clip yet,
// the rollout below is simulated. The real one will come from the server.
import { computed, reactive, ref } from 'vue';

export type FirmwarePhase = 'offline' | 'wait' | 'down' | 'boot' | 'done';
export const FIRMWARE_PHASE: Record<FirmwarePhase, string> = {
  offline: '已排入更新，上線後自動開始',
  wait: '等衣夾醒來',
  down: '下載中',
  boot: '驗證並重新開機',
  done: '更新完成',
};
export interface FirmwareJob { id: string; name: string; to: string; phase: FirmwarePhase; pct: number; delay: number }
export interface FirmwareTarget { id: string; name: string; online: boolean }
export interface FirmwareEvent { at: number; device: string; text: string; tone: string }

const jobs = ref<FirmwareJob[]>([]);
const events = ref<FirmwareEvent[]>([]);
const installed = reactive<Record<string, string>>({});  // clip id -> version it now runs
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  for (const j of jobs.value) {
    if (j.phase === 'wait') { j.delay -= 1; if (j.delay <= 0) j.phase = 'down'; }
    else if (j.phase === 'down') { j.pct = Math.min(95, j.pct + 5); if (j.pct >= 95) { j.phase = 'boot'; j.delay = 6; } }
    else if (j.phase === 'boot') {
      j.delay -= 1;
      if (j.delay <= 0) {
        j.phase = 'done'; j.pct = 100; j.delay = 20;
        installed[j.id] = j.to;
        events.value.unshift({ at: Date.now(), device: j.name, text: `韌體更新為 ${j.to} 完成`, tone: 'ac-tx' });
      }
    } else if (j.phase === 'done') j.delay -= 1;
  }
  // A finished clip keeps its "done" line for a few seconds, then the card goes back to normal.
  jobs.value = jobs.value.filter((j) => j.phase !== 'done' || j.delay > 0);
  if (!jobs.value.some((j) => j.phase !== 'offline')) { clearInterval(timer); timer = undefined; }
}

function start(version: string, targets: FirmwareTarget[]) {
  const fresh = targets.filter((t) => !jobs.value.some((j) => j.id === t.id));
  jobs.value.push(...fresh.map((t, i): FirmwareJob => ({
    id: t.id, name: t.name, to: version, phase: t.online ? 'wait' : 'offline', pct: 0, delay: 5 + i * 6,
  })));
  if (!timer) timer = setInterval(tick, 400);
}
function cancel(id: string) {
  const job = jobs.value.find((j) => j.id === id);
  if (!job || (job.phase !== 'wait' && job.phase !== 'offline')) return;
  jobs.value = jobs.value.filter((j) => j.id !== id);
  events.value.unshift({ at: Date.now(), device: job.name, text: `取消韌體更新（${job.to}）`, tone: 'muted-2' });
}

export function useFirmware() {
  return {
    jobs, events, installed, start, cancel,
    jobOf: (id: string) => jobs.value.find((j) => j.id === id),
    busy: computed(() => jobs.value.length > 0),
  };
}
