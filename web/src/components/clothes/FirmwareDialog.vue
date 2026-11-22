<template>
  <dialog ref="dialog" class="fw" aria-labelledby="fw-title" @close="onClose" @click="onBackdrop">
    <form method="dialog" class="fw-body" @submit.prevent="submit">
      <div class="fw-head">
        <h2 id="fw-title">更新衣夾韌體</h2>
        <button type="button" class="ui-btn ui-btn--ghost" aria-label="關閉" @click="dialog?.close()">✕</button>
      </div>

      <section aria-labelledby="fw-file">
        <h3 id="fw-file"><span class="step">1</span>選擇韌體檔</h3>
        <label class="drop" :class="{ over: dragging, picked: file }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <input type="file" accept=".bin" class="sr-only" @change="onPick" />
          <template v-if="file">
            <b class="mono">{{ file.name }}</b>
            <span class="muted">{{ sizeText(file.size) }} · 點一下可換另一個檔案</span>
          </template>
          <template v-else>
            <b>把 .bin 檔拖到這裡，或點一下從電腦選擇</b>
            <span class="muted">ESP-IDF 編譯出來的 build/hx711_scale.bin</span>
          </template>
        </label>
        <p v-if="fileError" class="ui-note ui-note--error" role="alert">{{ fileError }}</p>
        <dl v-else-if="info" class="facts">
          <div><dt>韌體版本</dt><dd class="mono">{{ info.version }}</dd></div>
          <div><dt>編譯時間</dt><dd class="mono">{{ info.built }}</dd></div>
          <div><dt>晶片</dt><dd>{{ info.chip }}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="fw-target">
        <div class="row">
          <h3 id="fw-target"><span class="step">2</span>選擇衣夾</h3>
          <div class="ui-seg" role="group" aria-label="更新對象">
            <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">所有衣夾 {{ clips.length }}</button>
            <button type="button" :aria-pressed="scope === 'pick'" @click="scope = 'pick'">指定衣夾</button>
          </div>
        </div>
        <ul class="clips">
          <li v-for="c in clips" :key="c.device.id">
            <label class="clip" :class="{ on: isChosen(c.device.id), locked: scope === 'all' || c.updating }">
              <input type="checkbox" :checked="isChosen(c.device.id)" :disabled="scope === 'all' || c.updating" @change="togglePick(c.device.id)" />
              <span class="clip-name">{{ c.device.name }} <DemoTag v-if="!c.device.live" /></span>
              <span class="status" :class="`status--${c.status.tone}`"><i></i>{{ c.status.label }}</span>
              <span class="muted mono">{{ c.updating ? '更新中' : c.version }}</span>
            </label>
          </li>
        </ul>
      </section>

      <p class="ui-note ui-note--info">衣夾平常在睡眠，下次醒來回報時（約 1 分鐘內）才會開始下載；離線的衣夾會排著，上線後自動更新。更新時衣夾會重新開機，約 1 分鐘沒有資料。</p>
      <p v-if="chosen.some((c) => !c.device.live)" class="demo-note">標了「示範」的衣夾沒有實體裝置，它們的更新進度是模擬的。</p>
      <p v-if="sendError" class="ui-note ui-note--error" role="alert">{{ sendError }}</p>

      <div class="fw-foot">
        <span class="muted">{{ summary }}</span>
        <button type="button" class="ui-btn" @click="dialog?.close()">取消</button>
        <button type="submit" class="ui-btn ui-btn--primary" :disabled="!info || !chosen.length || sending">{{ sending ? '上傳中…' : '開始更新' }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useClothesMock } from '../../composables/useClothesMock';
import DemoTag from './DemoTag.vue';
import { useFirmware } from '../../composables/useFirmware';

const mock = useClothesMock();
const firmware = useFirmware();
const dialog = ref<HTMLDialogElement>();

const clips = computed(() => mock.devices.value.map((device) => ({
  device, status: mock.clipStatus(device),
  version: firmware.versionOf(device.id) ?? device.fw ?? '未回報',
  updating: ['offline', 'wait', 'down', 'boot'].includes(firmware.jobOf(device.id)?.phase ?? ''),
})));

// ----- the file, checked in the browser against the ESP-IDF image header
const MAX_BYTES = firmware.maxBytes.value;  // one OTA slot
interface ImageInfo { version: string; built: string; chip: string }
const file = ref<File | null>(null);
const info = ref<ImageInfo | null>(null);
const fileError = ref('');
const dragging = ref(false);
const sizeText = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
const CHIPS: Record<number, string> = { 0: 'ESP32', 2: 'ESP32-S2', 5: 'ESP32-C3', 9: 'ESP32-S3', 13: 'ESP32-C6' };

async function readImage(picked: File) {
  file.value = picked; info.value = null; fileError.value = '';
  if (!/\.bin$/i.test(picked.name)) { fileError.value = '請選擇 .bin 檔。'; return; }
  if (picked.size > MAX_BYTES) { fileError.value = `檔案 ${sizeText(picked.size)}，超過衣夾可放的 ${sizeText(MAX_BYTES)}。`; return; }
  const head = new DataView(await picked.slice(0, 288).arrayBuffer());
  // 0xE9 starts every ESP image; esp_app_desc_t (magic 0xABCD5432) follows the first segment header.
  if (head.byteLength < 288 || head.getUint8(0) !== 0xE9 || head.getUint32(32, true) !== 0xABCD5432) {
    fileError.value = '這不是 ESP32 的應用程式韌體（可能選到 bootloader 或分割表）。'; return;
  }
  const text = (from: number, length: number) => {
    let out = '';
    for (let i = from; i < from + length && head.getUint8(i) !== 0; i += 1) out += String.fromCharCode(head.getUint8(i));
    return out;
  };
  const chipId = head.getUint16(12, true);
  if (chipId !== 9) { fileError.value = `這個韌體是給 ${CHIPS[chipId] ?? '其他晶片'} 的，衣夾是 ESP32-S3。`; return; }
  info.value = { version: text(48, 32) || '未標版本', built: `${text(128, 16)} ${text(112, 16)}`.trim(), chip: CHIPS[chipId] };
}
function onPick(event: Event) {
  const chosenFile = (event.target as HTMLInputElement).files?.[0];
  if (chosenFile) void readImage(chosenFile);
}
function onDrop(event: DragEvent) {
  dragging.value = false;
  const dropped = event.dataTransfer?.files[0];
  if (dropped) void readImage(dropped);
}

// ----- which clips
const scope = ref<'all' | 'pick'>('all');
const picked = ref<string[]>([]);
const isChosen = (id: string) => scope.value === 'all' || picked.value.includes(id);
const togglePick = (id: string) => { picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id]; };
const chosen = computed(() => clips.value.filter((c) => isChosen(c.device.id) && !c.updating));
const summary = computed(() => {
  if (!info.value) return '請先選擇韌體檔';
  if (!chosen.value.length) return '請至少選一支衣夾';
  const offline = chosen.value.filter((c) => !c.status.online).length;
  return `${info.value.version} → ${chosen.value.length} 支衣夾${offline ? `（${offline} 支離線，先排著）` : ''}`;
});

const sending = ref(false);
const sendError = ref('');
async function submit() {
  if (!file.value || !info.value || !chosen.value.length || sending.value) return;
  sending.value = true; sendError.value = '';
  try {
    await firmware.start(file.value, info.value.version,
      chosen.value.map((c) => ({ id: c.device.id, name: c.device.name, online: c.status.online, live: c.device.live })));
    dialog.value?.close();
  } catch (error) {
    sendError.value = `沒有開始更新：${(error as Error).message}`;
  } finally { sending.value = false; }
}
function onClose() { file.value = null; info.value = null; fileError.value = ''; sendError.value = ''; }
// A click on the backdrop lands on the <dialog> element itself.
function onBackdrop(event: MouseEvent) { if (event.target === dialog.value) dialog.value?.close(); }

function open() {
  scope.value = 'all';
  picked.value = [];
  dialog.value?.showModal();
}
defineExpose({ open });
</script>

<style scoped>
.fw { width: min(720px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 1px solid var(--bd2); border-radius: 20px; background: var(--sf); color: var(--tx); }
.fw::backdrop { background: rgb(0 0 0 / 0.6); }
.fw-body { display: flex; flex-direction: column; gap: 24px; padding: 28px; }
.fw-head, .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.fw-head h2 { font-size: 1.375rem; }
.fw section { display: flex; flex-direction: column; gap: 12px; }
.fw h3 { font-size: 1.125rem; }
.step { display: inline-grid; place-items: center; width: 28px; height: 28px; margin-right: 10px; border-radius: 50%; background: var(--ac-soft); color: var(--ac-tx); font-size: 0.9375rem; }
.drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 112px; padding: 20px; border: 2px dashed var(--bd2); border-radius: 16px; text-align: center; cursor: pointer; overflow-wrap: anywhere; }
.drop:hover, .drop.over, .drop:focus-within { border-color: var(--ac); background: var(--ac-soft); }
.drop.picked { border-style: solid; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0; }
.facts dt { font-size: 0.875rem; color: var(--mu); }
.facts dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
.clips { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 248px; overflow-y: auto; }
.clip { display: grid; grid-template-columns: 22px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 12px; min-height: 48px; padding: 6px 14px; border: 1px solid var(--bd); border-radius: 12px; cursor: pointer; }
.clip.on { border-color: var(--ac-bd); background: var(--ac-soft); }
.clip.locked { cursor: default; }
.clip input { width: 20px; height: 20px; accent-color: var(--ac); }
.clip-name { font-weight: 700; }
.clip .status { font-size: 0.9375rem; }
.clip .mono { text-align: right; }
.demo-note { margin: 0; }
.fw-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; }
.fw-foot .muted { margin-right: auto; }
@media (max-width: 560px) { .fw-body { padding: 20px; } }
</style>
