<template>
  <div class="overview">
    <section class="hero" aria-label="晾衣狀態">
      <div class="hero-inner">
        <div class="page-head">
          <h1>{{ items.length ? `晾衣中 · ${items.length} 件` : '今天的晾衣狀況' }}</h1>
          <router-link v-if="items.length" to="/start" class="ui-btn ui-btn--primary">開始新一次晾衣</router-link>
        </div>
        <p v-if="mock.actionError.value || mock.loadError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value || mock.loadError.value }}</p>

        <!-- ===== someone is drying ===== -->
        <div v-if="items.length && cur" class="stage">
          <div class="carousel">
            <div class="track-wrap">
              <svg class="line" aria-hidden="true" width="100%" height="60" viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M0,15 Q50,30 100,15" fill="none" :stroke="palette.tx2" stroke-width="2.5" vector-effect="non-scaling-stroke" /></svg>
              <div class="track" :style="{ transform: `translateX(-${idx * 100}%)` }">
                <div v-for="(item, i) in items" :key="item.session.id" class="slide" :aria-hidden="i !== idx">
                  <GarmentFigure :uid="item.session.id" :garment="item.garment"
                    :moist="item.moist" :label="item.moist == null ? item.garment.name : `${item.garment.name}，剩餘水分 ${item.moist}%`" />
                </div>
              </div>
            </div>
            <template v-if="items.length > 1">
              <button type="button" class="nav-btn prev" aria-label="上一件" :disabled="idx === 0" @click="go(idx - 1)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
              <button type="button" class="nav-btn next" aria-label="下一件" :disabled="idx === items.length - 1" @click="go(idx + 1)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
            </template>
            <div class="dots">
              <button v-for="(item, i) in items" :key="item.session.id" type="button" :aria-label="`切換到${item.garment.name}`"
                :aria-current="i === idx" @click="go(i)"><span :class="{ on: i === idx }"></span></button>
            </div>
          </div>

          <div class="side">
            <!-- view -->
            <div v-if="panel === 'view'" class="view">
              <div class="view-top">
                <span class="meta"><i :style="{ background: cur.garment.color }"></i><DemoTag v-if="cur.session.demo" /><span class="ellipsis">{{ cur.garment.material }} · {{ SHAPES[cur.garment.style].label }} · <router-link :to="`/clips/${cur.clip.id}`" class="clip-link" title="衣夾詳細">{{ cur.clip.name }}</router-link></span></span>
                <div class="btns">
                  <button type="button" class="ui-btn" @click="panel = 'swap'">更換衣物</button>
                  <button type="button" class="ui-btn" @click="editGarment">編輯衣物</button>
                  <button type="button" class="ui-btn ui-btn--primary" @click="panel = 'end'">結束晾衣</button>
                </div>
              </div>
              <h2 class="name ellipsis" :title="cur.garment.name">{{ cur.garment.name }}</h2>
              <div>
                <span class="label">預計乾燥時間</span>
                <span class="dry">
                  <span class="dry-time num" :class="{ none: cur.dryTime == null }">{{ cur.dryText }}</span>
                  <span class="left">{{ cur.leftText || '\u00a0' }}</span>
                </span>
              </div>
              <div class="box-row">
                <label for="ov-airbox">室內環境來自</label>
                <AirboxSelect id="ov-airbox" small />
              </div>
              <div class="tiles">
                <div class="tile">
                  <span class="label">剩餘水分</span>
                  <span v-if="cur.moist != null" class="num big">{{ cur.moist }}<small> %</small></span>
                  <span v-else class="num big muted">NONE</span>
                </div>
                <div class="tile"><span class="label">已晾</span><span class="big">{{ cur.elapsedText }}</span></div>
                <div v-for="t in airTiles" :key="t.label" class="tile">
                  <span class="label">{{ t.label }}</span>
                  <span v-if="t.value != null" class="num big">{{ formatAir(t.value) }}<small> {{ t.unit }}</small></span>
                  <span v-else class="big muted">無數據</span>
                </div>
              </div>
              <p class="air-note muted">{{ airNote || '\u00a0' }}</p>
              <div class="weather">
                <svg width="28" height="28" viewBox="0 0 56 56" fill="none" aria-hidden="true"><circle cx="28" cy="28" r="11" :stroke="palette.wa" stroke-width="4" /><path d="M28 6v6M28 44v6M6 28h6M44 28h6M12.4 12.4l4.2 4.2M39.4 39.4l4.2 4.2M12.4 43.6l4.2-4.2M39.4 16.6l4.2-4.2" :stroke="palette.wa" stroke-width="4" stroke-linecap="round" /></svg>
                <span class="ellipsis">{{ weatherText }}</span>
                <select v-if="counties.length" v-model="county" class="weather-select" aria-label="戶外天氣縣市">
                  <option v-for="name in counties" :key="name" :value="name">{{ name }}</option>
                </select>
                <select v-if="districts.length" v-model="district" class="weather-select" aria-label="戶外天氣行政區">
                  <option v-for="name in districts" :key="name" :value="name">{{ name }}</option>
                </select>
                <router-link to="/weather" class="weather-detail">詳細</router-link>
              </div>
              <div role="status" aria-live="polite" class="alert-slot">
                <div v-if="alerts.length" class="alert">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z" :stroke="palette.wa" stroke-width="2" stroke-linejoin="round" /><path d="M12 10v5M12 18h.01" :stroke="palette.wa" stroke-width="2" stroke-linecap="round" /></svg>
                  <span class="alert-text">{{ alerts[0].msg }}<strong class="wa-tx">{{ alerts[0].action }}</strong><span v-if="alerts.length > 1" class="more">（另有 {{ alerts.length - 1 }} 則提醒）</span></span>
                </div>
                <div v-else class="alert calm">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" /><path d="M8 12.5l2.6 2.6L16 9.6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  <span>目前沒有需要注意的狀況</span>
                </div>
              </div>
            </div>

            <!-- swap -->
            <div v-else-if="panel === 'swap'" class="card-panel">
              <h2>更換衣物</h2>
              <p class="muted-2">這次晾的不是「{{ cur.garment.name }}」？選擇正確的衣物。開始時間和感測資料會保留，預測會依新衣物重新計算，兩件衣物的設定都不會被改動。</p>
              <div class="library">
                <button v-for="g in swapChoices" :key="g.id" type="button" class="lib-item"
                  :class="{ on: g.id === cur.garment.id }" :disabled="g.id !== cur.garment.id && busyGarmentIds.has(g.id)"
                  :aria-pressed="g.id === cur.garment.id" @click="swapTo(g.id)">
                  <i :style="{ background: g.color }"></i>
                  <span class="lib-text"><b class="ellipsis" :title="g.name">{{ g.name }}</b><small>{{ g.material }} · {{ SHAPES[g.style].label }}{{ dryCount(g.id) ? ` · 晾過 ${dryCount(g.id)} 次` : ' · 新衣物' }}</small></span>
                  <span class="tag">{{ g.id === cur.garment.id ? '目前' : busyGarmentIds.has(g.id) ? '晾衣中' : '' }}</span>
                </button>
              </div>
              <div class="btns">
                <button type="button" class="ui-btn ui-btn--lg ui-btn--dashed" @click="addNew">＋ 新增衣物</button>
                <button type="button" class="ui-btn ui-btn--ghost push" @click="closePanel">返回</button>
              </div>
            </div>

            <!-- end -->
            <div v-else-if="panel === 'end'" class="card-panel">
              <h2 class="ellipsis" :title="cur.garment.name">結束晾衣：{{ cur.garment.name }}</h2>
              <button type="button" class="choice" @click="finish('dry')"><strong>已乾，收衣</strong><span>記錄結束時間，並更新這件衣物的平均乾燥時間</span></button>
              <button type="button" class="choice" @click="finish('early')"><strong>還沒乾，先收起來</strong><span>例如要下雨。保留紀錄，但不列入預測準確度</span></button>
              <button type="button" class="choice warn" @click="finish('cancel')"><strong class="wa-tx">取消這次晾衣</strong><span>開錯了，刪除這筆紀錄</span></button>
              <button type="button" class="ui-btn ui-btn--ghost start" @click="closePanel">返回</button>
            </div>
          </div>
        </div>

        <!-- ===== nothing is drying (05) ===== -->
        <div v-else class="stage">
          <div class="carousel">
            <div class="track-wrap">
              <svg class="line" aria-hidden="true" width="100%" height="60" viewBox="0 0 100 60" preserveAspectRatio="none"><path d="M0,15 Q50,30 100,15" fill="none" :stroke="palette.tx2" stroke-width="2.5" vector-effect="non-scaling-stroke" /></svg>
              <GarmentFigure uid="idle" :garment="null" />
            </div>
          </div>
          <div class="side view">
            <div class="idle-intro">
              <h2 class="idle-title">目前沒有在晾的衣服</h2>
              <p class="muted-2">選一個衣夾和要晾的衣物，就會開始追蹤乾燥進度並預測收衣時間。</p>
              <router-link to="/start" class="ui-btn ui-btn--primary ui-btn--lg">開始晾衣</router-link>
            </div>
            <div class="tiles">
              <div v-for="t in airTiles" :key="t.label" class="tile">
                <span class="label">{{ t.label }}</span>
                <span v-if="t.value != null" class="num big">{{ formatAir(t.value) }}<small> {{ t.unit }}</small></span>
                <span v-else class="big muted">無數據</span>
              </div>
            </div>
            <p class="air-note muted">{{ airNote || '\u00a0' }}</p>
            <div class="forecast">
              <span class="label">現在晾出，預計乾燥時間</span>
              <div v-for="f in idleForecast" :key="f.material" class="forecast-row"><span>{{ f.material }}</span><strong :class="f.tone">{{ f.text }}</strong></div>
            </div>
            <div class="weather">
              <svg width="28" height="28" viewBox="0 0 56 56" fill="none" aria-hidden="true"><circle cx="28" cy="28" r="11" :stroke="palette.wa" stroke-width="4" /><path d="M28 6v6M28 44v6M6 28h6M44 28h6M12.4 12.4l4.2 4.2M39.4 39.4l4.2 4.2M12.4 43.6l4.2-4.2M39.4 16.6l4.2-4.2" :stroke="palette.wa" stroke-width="4" stroke-linecap="round" /></svg>
              <span class="ellipsis">{{ weatherText }}</span>
              <select v-if="counties.length" v-model="county" class="weather-select" aria-label="戶外天氣縣市">
                <option v-for="name in counties" :key="name" :value="name">{{ name }}</option>
              </select>
              <select v-if="districts.length" v-model="district" class="weather-select" aria-label="戶外天氣行政區">
                <option v-for="name in districts" :key="name" :value="name">{{ name }}</option>
              </select>
              <router-link to="/weather" class="weather-detail">詳細</router-link>
            </div>
          </div>
        </div>

        <a href="#more" class="more-link">往下查看更多<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
      </div>
    </section>

    <div id="more" class="page">
      <section v-if="cur" class="panel">
        <div class="curve-head">
          <h2 class="ellipsis" :title="cur.garment.name">乾燥曲線 · {{ cur.garment.name }}</h2>
          <div class="legend" :style="{ visibility: cur.moist != null ? 'visible' : 'hidden' }" :aria-hidden="cur.moist == null">
            <span><i class="sw solid"></i>實測</span>
            <span><i class="sw dash"></i>預測</span>
            <span><i class="sw thr"></i>乾燥門檻</span>
          </div>
        </div>
        <div v-if="cur.moist != null" class="curve-scroll">
          <DryingCurve :started-at="cur.session.startedAt" :now="mock.now.value" :moist-now="cur.moist" :dry-time="cur.dryTime" />
        </div>
        <div v-else class="no-curve">
          <p>{{ cur.clip.name }} 的剩餘水分尚未實作，目前沒有乾燥曲線；預計乾燥時間是依這件衣物過去的乾燥時間（沒有紀錄時用材質）估算。三個感測器的原始值曲線可以到衣夾詳細查看。</p>
          <router-link :to="`/clips/${cur.clip.id}`" class="ui-btn">查看原始值曲線</router-link>
        </div>
      </section>

      <div class="lower">
        <section v-if="items.length" class="panel grow">
          <div class="row-head"><h2>晾衣中</h2><router-link to="/devices" class="ac-tx">全部設備</router-link></div>
          <button v-for="(item, i) in items" :key="item.session.id" type="button" class="drying-row" @click="go(i); scrollTop()">
            <span class="drying-top"><span>{{ item.garment.name }} <small class="muted">{{ item.clip.name }}</small> <DemoTag v-if="item.session.demo" /></span>
              <span :class="item.clip.issue ? 'wa-tx' : 'ac-tx'">{{ item.clip.issue ? '重量感測異常' : item.dryText }}</span></span>
            <span class="ui-bar"><span :style="{ width: item.moist == null ? '0%' : `${100 - item.moist}%`, background: item.clip.issue ? 'var(--wa)' : undefined }"></span></span>
          </button>
        </section>
        <section class="panel grow">
          <div class="row-head"><h2>上次晾衣</h2><router-link to="/sessions" class="ac-tx">全部紀錄</router-link></div>
          <div v-if="lastRecord" class="last">
            <div class="last-top"><span>{{ lastRecord.name }} <DemoTag v-if="lastRecord.demo" /></span><span>{{ lastRecord.duration }}</span></div>
            <span class="muted">{{ lastRecord.when }}</span>
          </div>
          <p v-else class="muted">還沒有晾衣紀錄</p>
          <div class="avail"><span>可用衣夾</span><strong class="ac-tx">{{ availableClips }} 個待命中</strong></div>
        </section>
      </div>

      <p v-if="mock.demoEnabled.value" class="demo-note">標了「示範」的衣物與晾衣是示範資料，剩餘水分、乾燥曲線與降雨時間為模擬；戶外溫濕度來自氣象署。衣夾-01 的晾衣、衣物與紀錄是實際資料，存在伺服器；它的預計乾燥時間依這件衣物過去的乾燥時間估算，剩餘水分尚未實作。空氣盒子溫濕度為實際資料。可在設定關閉示範資料。</p>
      <p v-else class="demo-note">衣物與晾衣紀錄存在伺服器；預計乾燥時間依這件衣物過去的乾燥時間估算（第一次晾用材質預設值）。空氣盒子與氣象署戶外溫濕度為實際資料；剩餘水分與降雨預測尚未實作。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import GarmentFigure from '../components/clothes/GarmentFigure.vue';
import DryingCurve from '../components/clothes/DryingCurve.vue';
import DemoTag from '../components/clothes/DemoTag.vue';
import AirboxSelect from '../components/clothes/AirboxSelect.vue';
import { BASE_MINUTES, SHAPES, type Material } from '../constants/garments';
import { useTheme } from '../composables/useTheme';
import { useClothesLive } from '../composables/useClothesData';
import { dryAt, moistureAt, useClothesMock } from '../composables/useClothesMock';
import { useOutdoorWeather } from '../composables/useOutdoorWeather';
import { DAY_MS, TAIPEI_MS, clock, dayLabel, formatAir, minutesText, shortDuration } from '../utils/format';

const { palette } = useTheme();
const { air } = useClothesLive();
const mock = useClothesMock();
const { weather: demoWeather, busyGarmentIds, dryCount, garmentById, clipById } = mock;
const { counties, county, districts, district, outdoor, loading: weatherLoading, error: weatherError } = useOutdoorWeather();
const MIN = 60000;

const items = computed(() => mock.state.sessions.flatMap((session) => {
  const garment = garmentById(session.garmentId);
  const clip = clipById(session.clipId);
  if (!garment || !clip) return [];
  const t = mock.now.value;
  // Every session has a predicted drying time from the server (this garment's average, or the
  // material default). Remaining moisture is only simulated for demo sessions; the real clip has
  // no moisture estimate yet, so it shows NONE instead of a demo number.
  const moist = session.demo ? moistureAt(session, t) : null;
  const dryTime = dryAt(session);
  const done = moist != null && (moist <= 5 || dryTime <= t);
  // Without a moisture reading the real clip cannot tell it is dry; past the estimate it only says so.
  const overdue = moist == null && dryTime <= t;
  return [{
    session, garment, clip, moist, dryTime,
    dryText: done ? '已乾' : clock(dryTime),
    leftText: done ? '可以收了' : overdue ? '已超過預計時間，請確認' : `還要約 ${minutesText((dryTime - t) / MIN)}`,
    elapsedText: minutesText((t - session.startedAt) / MIN),
  }];
}));

const idx = ref(0);
const cur = computed(() => items.value[Math.min(idx.value, items.value.length - 1)] ?? null);
watch(() => items.value.length, (n) => { if (idx.value >= n) idx.value = Math.max(0, n - 1); });
onMounted(() => {
  const focus = mock.state.focus;
  if (focus) {
    const i = items.value.findIndex((it) => it.session.id === focus);
    if (i >= 0) idx.value = i;
    mock.clearFocus();
  }
});

type Panel = 'view' | 'swap' | 'end';
const panel = ref<Panel>('view');
function go(i: number) {
  // Stops at the first and last garment instead of wrapping around.
  idx.value = Math.max(0, Math.min(items.value.length - 1, i));
  closePanel();
}
function closePanel() { panel.value = 'view'; }
const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// Garment style, colour and material are edited on the garment page (衣物管理).
const router = useRouter();
function editGarment() {
  if (cur.value) void router.push(`/garments/${cur.value.garment.id}`);
}
// Only garments of the same kind (real or demo) as this session can be swapped in.
const swapChoices = computed(() => cur.value ? mock.state.garments.filter((g) => g.demo === cur.value!.session.demo) : []);
async function swapTo(garmentId: string) {
  if (!cur.value) return;
  if (garmentId !== cur.value.garment.id && !await mock.swapGarment(cur.value.session.id, garmentId)) return;
  closePanel();
}
async function addNew() {
  if (!cur.value) return;
  const { session } = cur.value;
  // Names must be unique, so pick 新衣物, 新衣物 2, … whichever is still free.
  let name = '新衣物';
  for (let n = 2; mock.garmentNameTaken(name, session.demo); n++) name = `新衣物 ${n}`;
  const g = await mock.addGarment({ name, style: 'tee', color: '#F2F1EC', material: '棉' }, session.demo);
  if (!g || !await mock.swapGarment(session.id, g.id)) return;
  void router.push(`/garments/${g.id}`);  // set its name and style there
}
async function finish(how: 'dry' | 'early' | 'cancel') {
  if (!cur.value) return;
  if (await mock.endSession(cur.value.session.id, how)) closePanel();
}

const alerts = computed(() => {
  const c = cur.value;
  if (!c) return [];
  const out: { msg: string; action: string }[] = [];
  // The weather is demo data, so it only warns about demo sessions.
  const w = c.session.demo ? demoWeather.value : null;
  if (w && c.dryTime && c.dryTime > w.rainAt && w.rainAt - mock.now.value < DAY_MS / 2)
    out.push({ msg: `${c.garment.name}預計 ${clock(c.dryTime)} 才乾，但 ${clock(w.rainAt)} 起降雨機率 ${w.rainChance}%，`, action: `建議 ${clock(w.rainAt - 30 * MIN)} 前收進室內` });
  const humi = shownAir.value?.humi;
  if (humi != null && humi > 75)
    out.push({ msg: `室內濕度 ${formatAir(humi)}%，乾燥速度變慢，`, action: '建議開除濕機或電風扇' });
  if (c.clip.issue) out.push({ msg: `${c.clip.name}${c.clip.issue}，`, action: '預測可能不準' });
  return out;
});

// Air box readings older than an hour are hidden instead of shown as if current.
const AIR_SHOW_MAX_MS = 60 * MIN;
const shownAir = computed(() => {
  const a = air.value;
  return a && a.age_ms != null && a.age_ms <= AIR_SHOW_MAX_MS ? a : null;
});
const airTiles = computed(() => [
  { label: '室內溫度', value: shownAir.value?.temp ?? null, unit: '°C' },
  { label: '室內濕度', value: shownAir.value?.humi ?? null, unit: '%' },
]);
const airNote = computed(() => {
  if (shownAir.value?.stale) return '空氣盒子超過 5 分鐘未更新';
  if (air.value && air.value.age_ms != null && !shownAir.value) return '空氣盒子超過 1 小時沒有更新';
  return '';
});


// ----- idle state
// Same layout either way: without the demo there is no prediction yet, so each row shows NONE.
const weatherText = computed(() => {
  const value = outdoor.value;
  if (value) return `戶外 ${value.temp == null ? '—' : `${value.temp}°C`} · ${value.hum == null ? '—' : `${Math.round(value.hum)}%RH`} · ${value.station_name}`;
  if (weatherLoading.value) return '正在取得氣象署戶外天氣';
  return weatherError.value || '戶外天氣無數據';
});
const idleForecast = computed(() => (['聚酯纖維', '棉', '牛仔布'] as Material[]).map((material) => {
  if (!demoWeather.value) return { material, text: 'NONE', tone: 'muted' };
  const t = mock.now.value + BASE_MINUTES[material] * MIN;
  const local = new Date(t + TAIPEI_MS);
  const nextDay = Math.floor((t + TAIPEI_MS) / DAY_MS) !== Math.floor((mock.now.value + TAIPEI_MS) / DAY_MS);
  if (nextDay || local.getUTCHours() >= 21) return { material, text: '建議明天再晾', tone: 'wa-tx' };
  if (t > demoWeather.value.rainAt) return { material, text: `${clock(t)} · 會碰到雨`, tone: 'wa-tx' };
  return { material, text: clock(t), tone: '' };
}));

const lastRecord = computed(() => {
  const done = mock.state.records.filter((r) => r.outcome === 'dry' && r.actualMin != null).sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!done) return null;
  const g = garmentById(done.garmentId);
  const end = done.startedAt + done.actualMin! * MIN;
  return { name: g?.name ?? '已刪除的衣物', demo: done.demo, duration: shortDuration(done.actualMin!),
    when: `${dayLabel(done.startedAt)} ${clock(done.startedAt)} 晾出，${clock(end)} 收衣` };
});
const availableClips = computed(() => mock.devices.value.filter((d) => !mock.activeClipIds.value.has(d.id) && mock.clipStatus(d).online).length);
</script>

<style scoped>
.hero { background: var(--sf); border-bottom: 1px solid var(--bd); }
.hero-inner { max-width: 1320px; margin: 0 auto; padding: 36px 24px 24px; display: flex; flex-direction: column; gap: 24px; }
.hero h1 { font-size: 1.75rem; }
.stage { display: flex; flex-wrap: wrap; align-items: center; gap: 40px 64px; min-height: 620px; }
.carousel { flex: 1 1 520px; min-width: 0; position: relative; }
/* Scales with the garment (60 of its 370 units) so the line always runs through the hanger hook. */
.line { position: absolute; left: 0; top: 0; display: block; height: 16.216%; }
.track-wrap { position: relative; overflow: hidden; }
.track { position: relative; display: flex; transition: transform 0.55s cubic-bezier(0.22, 0.8, 0.24, 1); }  /* above the clothesline */
.slide { flex: 0 0 100%; display: flex; justify-content: center; }
.nav-btn { position: absolute; top: 50%; transform: translateY(-50%); width: 52px; height: 52px; border-radius: 50%; border: 1px solid var(--bd2); background: var(--sf); color: var(--tx); display: grid; place-items: center; cursor: pointer; }
.nav-btn.prev { left: 0; } .nav-btn.next { right: 0; }
.nav-btn:disabled { opacity: 0.3; cursor: default; }
.dots { display: flex; justify-content: center; gap: 2px; margin-top: 8px; }
.dots button { width: 44px; height: 44px; border: 0; background: transparent; display: grid; place-items: center; cursor: pointer; }
.dots span { display: block; width: 8px; height: 8px; border-radius: 4px; background: var(--bd2); transition: width 0.3s; }
.dots span.on { width: 28px; background: var(--ac); }

.side { flex: 1 1 420px; min-width: 0; }
.view { display: flex; flex-direction: column; gap: 24px; }
/* One row: the buttons keep their size, the meta text gives way. */
.view-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.view-top .btns { flex: 0 0 auto; flex-wrap: nowrap; }
.meta { display: inline-flex; align-items: center; gap: 10px; min-width: 0; color: var(--tx2); }
.meta i { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--bd2); }
.ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btns { display: flex; flex-wrap: wrap; gap: 8px 10px; }
.push { margin-left: auto; }
.clip-link { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.clip-link:hover { color: var(--tx); }
.name { font-size: 3rem; font-weight: 900; line-height: 1.15; }
.label { display: block; font-size: 0.9375rem; color: var(--mu); }
.view > div > .label { font-size: 1.0625rem; }
/* Every slot below keeps one line and a fixed line height whatever the data is, so switching
   garments never moves the layout (NONE / 無數據 use the same size as real values). */
.dry { display: flex; align-items: baseline; gap: 8px 16px; min-width: 0; }
.dry-time { flex: 0 0 auto; font-size: 5.5rem; font-weight: 700; line-height: 1; white-space: nowrap; color: var(--ac-tx); }
.dry-time.none { color: var(--mu); }
.left { min-width: 0; font-size: 1.375rem; line-height: 1.3; color: var(--tx2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.box-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.box-row label { font-size: 0.9375rem; color: var(--mu); }
.no-curve { height: 320px; box-sizing: border-box; overflow: hidden; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 24px; border-radius: 14px; border: 1px dashed var(--bd2); color: var(--tx2); }
.no-curve p { flex: 1 1 360px; }
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: -12px; }
.tile { padding: 18px 20px; border-radius: 14px; background: var(--sf2); }
.big { display: block; font-size: 2rem; font-weight: 700; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.big small { font-size: 1.125rem; color: var(--mu); }
.air-note { margin-top: -16px; font-size: 0.875rem; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; color: var(--tx2); }
.weather .ellipsis { flex: 1; min-width: 0; }
.weather-select { max-width: 8rem; border: 1px solid var(--bd2); border-radius: 6px; background: var(--sf2); color: var(--tx); padding: 6px 8px; font: inherit; }
.weather-detail { flex: 0 0 auto; color: var(--ac); font-size: 0.82rem; font-weight: 700; text-decoration: none; }
.weather-detail:hover { text-decoration: underline; }
.alert-slot { height: 92px; }
.alert { height: 100%; display: flex; align-items: center; gap: 14px; padding: 0 20px; border-radius: 12px; line-height: 1.45; background: var(--wa-soft); border: 1px solid var(--wa-bd); }
.alert svg { flex: 0 0 auto; }
.alert-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.alert.calm { background: transparent; border: 1px dashed var(--bd2); color: var(--mu); }
.more { color: var(--tx2); }

.card-panel { display: flex; flex-direction: column; gap: 20px; padding: 28px; border-radius: 20px; border: 1px solid var(--bd); background: var(--bg); }
.card-panel h2 { font-size: 1.5rem; }
.muted-2 { color: var(--tx2); }
.library { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }
.lib-item { flex: 0 0 auto; display: flex; align-items: center; gap: 14px; min-height: 60px; padding: 8px 16px; border-radius: 12px; border: 1px solid var(--bd); background: var(--sf); text-align: left; cursor: pointer; }
.lib-item.on { border: 2px solid var(--ac); }
.lib-item:disabled { opacity: 0.45; cursor: not-allowed; }
.lib-item i { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--bd2); }
.lib-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lib-text b { font-size: 1.0625rem; }
.lib-text small { font-size: 0.875rem; color: var(--mu); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-size: 0.875rem; color: var(--tx2); }
.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px 18px; border-radius: 12px; border: 1px solid var(--bd2); background: var(--sf); text-align: left; cursor: pointer; }
.choice:hover { background: var(--sf2); }
.choice strong { font-size: 1.125rem; }
.choice span { font-size: 0.9375rem; color: var(--tx2); }
.choice.warn { border-color: var(--wa-bd); background: transparent; }
.start { align-self: flex-start; }

.idle-intro { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
.idle-title { font-size: 2.25rem; font-weight: 900; line-height: 1.2; }
.forecast { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; border-radius: 14px; border: 1px solid var(--bd); }
.forecast-row { display: flex; justify-content: space-between; gap: 12px; font-size: 1.0625rem; }

.more-link { align-self: center; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; font-size: 0.9375rem; color: var(--mu); text-decoration: none; }

.curve-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.curve-head h2 { flex: 1 1 240px; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; font-size: 0.9375rem; color: var(--tx2); }
.legend span { display: inline-flex; align-items: center; gap: 8px; }
.sw { display: inline-block; width: 22px; height: 0; }
.sw.solid { border-top: 3px solid var(--ac); }
.sw.dash { border-top: 3px dashed var(--wa); }
.sw.thr { border-top: 2px dashed var(--mu); }
.curve-scroll { overflow-x: auto; }

.lower { display: flex; flex-wrap: wrap; gap: 24px; }
.grow { flex: 1 1 380px; }
.row-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.row-head a { font-size: 0.9375rem; }
.drying-row { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: 14px; background: var(--sf2); border: 0; text-align: left; cursor: pointer; }
.drying-row:hover { background: var(--grid); }
.drying-top { display: flex; justify-content: space-between; gap: 12px; font-size: 1.0625rem; font-weight: 700; }
.drying-top small { font-weight: 400; font-size: 0.875rem; }
.last { display: flex; flex-direction: column; gap: 4px; padding: 16px; border-radius: 14px; background: var(--sf2); }
.last-top { display: flex; justify-content: space-between; gap: 12px; font-size: 1.0625rem; font-weight: 700; }
.avail { display: flex; justify-content: space-between; gap: 12px; padding: 16px; border-radius: 14px; border: 1px solid var(--bd); }

/* Desktop: everything above 往下查看更多 fits in one screen. The two columns keep fixed
   positions, the garment scales with the height, and tall panels scroll inside the side. */
@media (min-width: 901px) and (min-height: 600px) {
  .hero-inner {
    height: calc(100dvh - 65px);  /* NavBar: 64px bar + 1px border */
    padding: clamp(12px, 3vh, 36px) 24px 0;
    gap: clamp(6px, 1.6vh, 20px);
  }
  .hero h1 { font-size: clamp(1.375rem, 3.2vh, 1.75rem); }
  .page-head { flex: 0 0 auto; }
  .stage {
    flex: 1 1 auto; min-height: 0;
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: stretch;
    gap: 0 clamp(32px, 4vw, 64px);
  }
  /* Clothesline, garment and dots stay together and are centred in the column. */
  .carousel { display: flex; flex-direction: column; justify-content: center; min-height: 0; container-type: inline-size; }
  /* Never taller than the column can show at 300:370, so the garment is not squeezed sideways. */
  .track-wrap { flex: 0 1 min(600px, 123.33cqw); min-height: 0; }
  .track, .slide { height: 100%; }
  .slide { align-items: flex-start; }
  .track-wrap :deep(.garment) { width: auto; max-width: 100%; height: 100%; aspect-ratio: 300 / 370; }
  .dots { flex: 0 0 auto; margin-top: 0; }
  .dots button { height: 36px; }
  .side { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
  .side > * { margin-block: auto; }  /* centred when it fits, scrolls from the top when not */
  .view { gap: clamp(8px, 1.8vh, 24px); }
  .view-top .ui-btn { min-height: clamp(36px, 5vh, 44px); }
  .name { font-size: clamp(1.75rem, 4.6vh, 3rem); }
  .dry-time { font-size: clamp(2.5rem, 7.5vh, 5.5rem); }
  .left { font-size: clamp(1rem, 2.4vh, 1.375rem); }
  .view > div > .label { font-size: clamp(0.875rem, 2vh, 1.0625rem); }
  .tiles { margin-top: 0; gap: clamp(8px, 1.4vh, 12px); }
  .tile { padding: clamp(6px, 1.4vh, 18px) 20px; }
  .big { font-size: clamp(1.375rem, 3.4vh, 2rem); }
  .air-note { margin-top: calc(-0.5 * clamp(8px, 1.8vh, 24px)); }
  .alert-slot { height: clamp(56px, 7vh, 92px); }
  .alert { padding: 6px 20px; }
  .card-panel { padding: clamp(16px, 2.6vh, 28px); gap: clamp(10px, 2vh, 20px); }
  .idle-title { font-size: clamp(1.625rem, 4.4vh, 2.25rem); }
  .more-link { flex: 0 0 auto; min-height: 36px; }
}

/* Short laptop screens: tighter still, so a two-line alert fits too. */
@media (min-width: 901px) and (min-height: 600px) and (max-height: 780px) {
  .view { gap: clamp(6px, 1.1vh, 8px); }
  .dry-time { font-size: clamp(2.25rem, 6vh, 3rem); }
  .tile { padding: clamp(4px, 0.8vh, 6px) 16px; }
  .air-note { margin-top: -4px; font-size: 0.8125rem; }
  .alert { font-size: 0.9375rem; line-height: 1.35; }
}

@media (max-width: 640px) {
  .hero-inner { padding: 28px 16px 16px; }
  .view-top { flex-wrap: wrap; }
  .meta { flex: 1 1 100%; }
  .stage { min-height: 0; gap: 24px; }
  .name { font-size: 2.25rem; }
  .dry-time { font-size: 4rem; }
  .dry { flex-direction: column; align-items: flex-start; gap: 4px; }
  .idle-title { font-size: 1.75rem; }
  .nav-btn { width: 44px; height: 44px; }
}
</style>
