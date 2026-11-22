<template>
  <div v-if="!device" class="page">
    <router-link to="/devices" class="back">← 設備狀況</router-link>
    <h1>{{ mock.loaded.value ? '找不到這個衣夾' : '正在讀取衣夾…' }}</h1>
  </div>

  <div v-else class="page">
    <div class="head">
      <router-link to="/devices" class="back">← 設備狀況</router-link>
      <div class="page-head">
        <div class="title">
          <h1>{{ device.name }} <DemoTag v-if="device.demo" /></h1>
          <span class="status" :class="`status--${status.tone}`"><i></i>{{ status.label }}</span>
          <span v-if="device.live" class="conn muted">{{ connectionText }}</span>
        </div>
        <div role="group" aria-label="預測使用的感測法" class="method">
          <span class="muted">預測使用</span>
          <div class="ui-seg">
            <button v-for="s in SENSORS" :key="s.key" type="button" :aria-pressed="method === s.key" @click="pickMethod(s.key)">{{ s.method }}</button>
          </div>
        </div>
      </div>
      <p v-if="(device.live && data.clipSettingError.value) || mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value || data.clipSettingError.value }}</p>
    </div>

    <!-- ================= real clip ================= -->
    <template v-if="device.live">
      <p v-if="error" class="ui-note ui-note--error" role="alert">{{ error }}　畫面保留最後成功取得的資料。</p>
      <p v-if="ingestionError" class="ui-note ui-note--error" role="alert">資料寫入失敗，請檢查後端與資料庫。</p>

      <div class="layout">
        <div class="main-col">
          <section class="panel range-panel" aria-label="時間範圍">
            <div class="range-row">
              <h2>原始值歷史曲線</h2>
              <div class="ui-seg" role="group" aria-label="歷史時間範圍">
                <button v-for="p in PRESETS" :key="p.minutes" type="button" :aria-pressed="mode === String(p.minutes)" @click="mode = String(p.minutes)">{{ p.label }}</button>
                <button type="button" :aria-pressed="mode === 'custom'" @click="mode = 'custom'">自訂</button>
              </div>
            </div>
            <form v-if="mode === 'custom'" class="inline-form" @submit.prevent="applyCustom">
              <div class="ui-field"><label for="cd-start">開始（台北）</label><input id="cd-start" v-model="customStart" class="ui-input ui-input--sm" type="datetime-local" required /></div>
              <div class="ui-field"><label for="cd-end">結束（台北）</label><input id="cd-end" v-model="customEnd" class="ui-input ui-input--sm" type="datetime-local" required /></div>
              <button type="submit" class="ui-btn ui-btn--primary">查詢</button>
              <span class="muted hint">最長 24 小時</span>
            </form>
            <p class="muted hint">各感測器使用獨立刻度；缺值或資料中斷顯示為斷線。按住曲線拖曳可選取時段，再拖曳兩側直線微調。</p>
            <p v-if="rangeError" class="ui-note ui-note--error" role="alert">{{ rangeError }}</p>
            <p v-if="historyError" class="ui-note ui-note--error" role="alert">{{ historyError }}</p>
            <p v-if="truncated" class="ui-note">資料較多，目前顯示最近 5,000 筆。</p>
            <p v-if="bucketSeconds" class="ui-note">範圍較長，曲線以每 {{ bucketSeconds }} 秒的平均值顯示。</p>
            <div v-if="selection" class="sel-row">
              <span class="ac-tx">已選取 {{ pickedText(selection) }}</span>
              <button type="button" class="ui-btn" @click="zoomToSelection">放大到選取範圍</button>
              <button type="button" class="ui-btn ui-btn--ghost" @click="clearSelection">清除選取</button>
            </div>
          </section>

          <div v-if="!records.length" class="panel empty">
            <strong>{{ historyLoading ? '正在讀取歷史資料…' : '這段時間還沒有資料' }}</strong>
            <p class="muted">衣夾送出資料並成功儲存後，曲線會自動出現。</p>
          </div>

          <template v-else>
            <RawCharts :records="records" :air-records="airRecords" :range="range" :stale-after-ms="staleAfterMs" :bucket-seconds="bucketSeconds"
              :sensors="orderedSensors" :chosen="method" :latest="latest" :air-device-id="air?.device_id" :plugins="[selectPlugin]" />
          </template>

          <p class="muted small">
            {{ formatTime(range.start) }} – {{ formatTime(range.end) }} · 已載入 {{ records.length.toLocaleString() }} 筆 ·
            {{ mode === 'custom' ? '自訂時間不自動更新' : `歷史曲線每 ${refreshSeconds} 秒更新` }}
          </p>
        </div>

        <aside class="side-col">
          <section class="panel panel--sm">
            <h2>最新訊息</h2>
            <pre class="json mono">{{ latestJson }}</pre>
            <span class="muted small">{{ latest ? `${formatTime(latest.timestamp)} 收到` : '尚未收到資料' }}</span>
          </section>

          <form class="panel panel--sm" @submit.prevent="downloadCsv">
            <h2>匯出原始資料</h2>
            <p class="muted small">原始資料（不再平均），附空氣盒子溫溼度，台北時間，最長 {{ EXPORT_MAX_DAYS }} 天。可在曲線上拖曳選取時段。</p>
            <div class="ui-field"><label for="ex-start">開始</label><input id="ex-start" v-model="exportStart" class="ui-input ui-input--sm" type="datetime-local" step="1" required /></div>
            <div class="ui-field"><label for="ex-end">結束</label><input id="ex-end" v-model="exportEnd" class="ui-input ui-input--sm" type="datetime-local" step="1" required /></div>
            <div class="stack">
              <button type="button" class="ui-btn" @click="useChartRange">使用目前圖表範圍</button>
              <button type="submit" class="ui-btn ui-btn--primary" :disabled="exporting">{{ exporting ? '匯出中…' : '下載 CSV' }}</button>
            </div>
            <p v-if="exportMessage" class="small" :class="exportFailed ? 'err' : 'ac-tx'" role="status">{{ exportMessage }}</p>
          </form>

          <section class="panel panel--sm">
            <h2>裝置</h2>
            <dl class="kv">
              <div><dt>晶片</dt><dd>{{ device.chip }}</dd></div>
              <div><dt>MQTT topic</dt><dd class="mono">{{ device.topic }}</dd></div>
              <div><dt>MQTT broker</dt><dd>{{ mqttConnected ? '已連線' : '未連線' }}</dd></div>
              <div><dt>最後回報</dt><dd>{{ status.lastSeenMs == null ? '—' : agoText(status.lastSeenMs) }}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <p class="demo-note">原始數值為感測器直接讀值，尚未換算重量、電阻或電容。乾燥預測之後會依選擇的衣物計算，目前尚未實作；「預測使用」的切換目前只影響顯示順序。</p>
    </template>

    <!-- ================= demo clip ================= -->
    <template v-else>
      <p class="ui-note ui-note--info">這是示範衣夾，沒有連接實體感測器，以下數值與曲線為前端模擬。</p>
      <div class="layout">
        <div class="main-col">
          <section v-for="s in orderedSensors" :key="s.key" class="panel sensor" :class="{ chosen: s.key === method }">
            <div class="sensor-head">
              <h2><i :style="{ background: palette[s.color] }"></i>{{ s.method }} <em v-if="s.key === method" class="chosen-tag">預測使用</em></h2>
              <span class="reading num">{{ DEMO[s.key].value }}<small> {{ DEMO[s.key].unit }}</small></span>
            </div>
            <svg width="100%" height="140" viewBox="0 0 600 140" preserveAspectRatio="none" role="img" :aria-label="DEMO[s.key].aria" class="demo-chart">
              <line v-if="s.key === 'hx711_raw'" x1="0" y1="116" x2="600" y2="116" :stroke="palette.mu" stroke-dasharray="5 5" vector-effect="non-scaling-stroke" />
              <polyline :points="DEMO[s.key].points" fill="none" :stroke="palette[s.color]" stroke-width="3" vector-effect="non-scaling-stroke" />
            </svg>
            <div class="axis muted small"><span>{{ sessionStart }}</span><span v-if="s.key === 'hx711_raw'">虛線為乾布重量 381 g</span><span>現在</span></div>
          </section>
        </div>
        <aside class="side-col">
          <section v-if="device.issue && status.online" class="panel panel--sm warn-panel">
            <h2>需要注意</h2>
            <p>{{ device.issue }}</p>
          </section>
          <section class="panel panel--sm">
            <h2>裝置</h2>
            <dl class="kv">
              <div><dt>晶片</dt><dd>{{ device.chip }}</dd></div>
              <div><dt>IP</dt><dd class="mono">{{ device.ip ?? '—' }}</dd></div>
              <div><dt>韌體</dt><dd>{{ device.fw ?? '—' }}</dd></div>
              <div><dt>訊號</dt><dd>{{ status.online ? device.signal : '—' }}</dd></div>
              <div><dt>MQTT topic</dt><dd class="mono">{{ device.topic }}</dd></div>
              <div><dt>最後回報</dt><dd>{{ status.lastSeenMs == null ? '—' : agoText(status.lastSeenMs) }}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
      <p class="demo-note">示範資料：此衣夾的感測數值、曲線與裝置資訊為前端模擬。</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTheme } from '../composables/useTheme';
import DemoTag from '../components/clothes/DemoTag.vue';
import RawCharts from '../components/clothes/RawCharts.vue';
import { useRangeSelect, type Picked } from '../composables/useRangeSelect';
import { PRESETS, SENSORS, useClothesHistory, withClip, type Field } from '../composables/useClothesData';
import { useClothesMock, type Method } from '../composables/useClothesMock';
import { apiFetch } from '../composables/useAuth';
import { DAY_MS, agoText, clock, formatTime, fromTaipeiInput, toTaipeiInput } from '../utils/format';

const route = useRoute();
const { palette } = useTheme();
const mock = useClothesMock();
const data = useClothesHistory();
const {
  latest, error, ingestionError, mqttConnected, air, connectionText, staleAfterMs,
  records, airRecords, historyError, historyLoading, truncated, bucketSeconds,
  mode, customStart, customEnd, rangeError, range, refreshSeconds, applyCustom,
} = data;

const device = computed(() => mock.clipById(String(route.params.id)));
const status = computed(() => device.value ? mock.clipStatus(device.value) : { online: false, tone: 'off' as const, label: '離線', lastSeenMs: null, uptimeMin: null });
// Each clip's method is a server setting (clips.predict_method), demo clips included.
const method = computed<Method>(() => (device.value ? mock.methodOf(device.value.id) : 'hx711_raw'));
function pickMethod(key: Method) {
  if (device.value) void mock.setMethod(device.value.id, key);
}
const orderedSensors = computed(() => [...SENSORS].sort((a, b) => Number(b.key === method.value) - Number(a.key === method.value)));

const latestJson = computed(() => latest.value
  ? `{\n  "hx711_raw":   ${latest.value.hx711_raw ?? 'null'},\n  "ads1115_raw": ${latest.value.ads1115_raw ?? 'null'},\n  "touch_raw":   ${latest.value.touch_raw ?? 'null'}\n}`
  : '—');

// ---------------------------------------------------------------- CSV export
// Own start/end so exporting never changes what the charts show.
const EXPORT_MAX_DAYS = 7;
const exportStart = ref(toTaipeiInput(range.value.start, true));
const exportEnd = ref(toTaipeiInput(range.value.end, true));
const exporting = ref(false);
const exportMessage = ref('');
const exportFailed = ref(false);
const setExportRange = (start: Date, end: Date) => {
  exportStart.value = toTaipeiInput(start, true); exportEnd.value = toTaipeiInput(end, true);
};
function useChartRange() {
  setExportRange(range.value.start, range.value.end);
  exportFailed.value = false; exportMessage.value = '已套用目前圖表的時間範圍。';
}
const exportNotice = (text: string, failed = false) => { exportMessage.value = text; exportFailed.value = failed; };

async function downloadCsv() {
  const start = fromTaipeiInput(exportStart.value), end = fromTaipeiInput(exportEnd.value);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return exportNotice('請輸入開始與結束時間。', true);
  if (start >= end) return exportNotice('結束時間必須晚於開始時間。', true);
  if (end.getTime() - start.getTime() > EXPORT_MAX_DAYS * DAY_MS) return exportNotice(`一次最多匯出 ${EXPORT_MAX_DAYS} 天。`, true);
  exporting.value = true; exportNotice('');
  try {
    const params = withClip(new URLSearchParams({ start: start.toISOString(), end: end.toISOString() }));
    const response = await apiFetch(`/api/v1/clothes/export?${params}`, { cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const text = await blob.text();
    let rows = -1;  // the header line is not a reading
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) rows++;
    if (rows <= 0) return exportNotice('這段時間沒有資料，未下載檔案。', true);
    const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'clothes_raw.csv';
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportNotice(`已下載 ${name}（${rows.toLocaleString()} 筆）。`);
  } catch (err) {
    exportNotice(`匯出失敗：${(err as Error).message}`, true);
  } finally { exporting.value = false; }
}

// ---------------------------------------------------------------- drag-to-select
// Drag across any chart to pick an export range (useRangeSelect); the edges can then be adjusted.
const pickedText = (picked: Picked) => `${formatTime(picked.start)} – ${formatTime(picked.end)}`;
const { selection, plugin: selectPlugin, dragging } = useRangeSelect({
  onMove: (picked, resizing) => { if (resizing) setExportRange(new Date(picked.start), new Date(picked.end)); },
  onPick: (picked, resizing) => {
    setExportRange(new Date(picked.start), new Date(picked.end));
    exportNotice(`已${resizing ? '調整' : '從圖表選取'} ${pickedText(picked)}，可拖曳兩側直線微調，或直接下載。`);
  },
});
// Typing a valid range in the export fields moves the lines too, so both stay in agreement.
watch([exportStart, exportEnd], ([startText, endText]) => {
  if (dragging()) return;  // the drag itself is writing these fields
  const start = fromTaipeiInput(startText).getTime(), end = fromTaipeiInput(endText).getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && start < end) selection.value = { start, end };
});
function clearSelection() { selection.value = null; exportNotice(''); }

async function zoomToSelection() {
  const picked = selection.value;
  if (!picked) return;
  if (picked.end - picked.start > DAY_MS) return exportNotice('選取範圍超過 24 小時，無法放大檢視，但仍可匯出。', true);
  mode.value = 'custom';
  await nextTick();  // let the mode watcher fill its defaults first, then override them
  customStart.value = toTaipeiInput(new Date(picked.start));
  customEnd.value = toTaipeiInput(new Date(picked.end + 59999));  // round the end up to the whole minute
  applyCustom();
}

// ---------------------------------------------------------------- demo clip
const DEMO: Record<Field, { value: string; unit: string; points: string; aria: string }> = {
  hx711_raw: { value: '412', unit: 'g', points: '0,20 60,26 120,36 180,48 240,60 300,72 360,82 420,92 480,100 540,106 600,110', aria: '重量持續下降，接近乾布重量' },
  ads1115_raw: { value: '2.0', unit: 'MΩ', points: '0,120 60,118 120,114 180,108 240,96 300,84 360,70 420,56 480,46 540,40 600,36', aria: '布料電阻隨變乾而上升' },
  touch_raw: { value: '34,210', unit: '計數', points: '0,30 50,34 100,28 150,44 200,50 250,46 300,62 350,70 400,66 450,82 500,90 550,88 600,96', aria: '觸控計數隨水分減少而下降' },
};
const sessionStart = computed(() => {
  const s = device.value && mock.state.sessions.find((x) => x.clipId === device.value!.id);
  return s ? clock(s.startedAt) : '開始';
});
</script>

<style scoped>
.head { display: flex; flex-direction: column; gap: 12px; }
.back { align-self: flex-start; font-size: 0.9375rem; color: var(--tx2); text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; }
.back:hover { color: var(--tx); }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
.conn { font-size: 0.875rem; }
.method { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.method > span { font-size: 0.9375rem; }


.layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.main-col { flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }
.side-col { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 24px; }

.range-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.inline-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
.inline-form .ui-field { flex: 1 1 200px; }
.hint { font-size: 0.875rem; }
.sel-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 0.9375rem; }
.empty { align-items: center; text-align: center; padding: 64px 20px; border-style: dashed; }

.sensor.chosen { border-color: var(--ac-bd); }
.sensor-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
.sensor-head h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sensor-head h2 i { width: 12px; height: 12px; flex: 0 0 auto; }
.sensor-head h2 small { font-size: 0.875rem; font-weight: 400; }
.chosen-tag { font-style: normal; font-size: 0.75rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--ac-soft); color: var(--ac-tx); }
.reading { font-size: 2.25rem; font-weight: 700; line-height: 1; }
.reading small { font-size: 1rem; color: var(--mu); font-weight: 400; }
.small { font-size: 0.875rem; }
.demo-chart { display: block; }
.axis { display: flex; justify-content: space-between; gap: 12px; }

.json { margin: 0; padding: 16px; border-radius: 12px; background: var(--code); font-size: 0.875rem; line-height: 1.8; color: var(--tx2); overflow-x: auto; white-space: pre; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.err { color: var(--err-tx); }
.kv { display: flex; flex-direction: column; gap: 10px; }
.kv div { display: flex; justify-content: space-between; gap: 12px; }
.kv dt { color: var(--mu); }
.kv dd { text-align: right; overflow-wrap: anywhere; }
.warn-panel { border-color: var(--wa-bd); background: var(--wa-card); }

</style>
