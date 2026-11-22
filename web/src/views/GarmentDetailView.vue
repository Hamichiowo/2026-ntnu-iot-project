<template>
  <div v-if="!garment" class="page">
    <router-link to="/garments" class="back">← 衣物管理</router-link>
    <h1>{{ mock.loaded.value ? '找不到這件衣物' : '正在讀取衣物…' }}</h1>
  </div>

  <div v-else class="page">
    <div class="head">
      <router-link to="/garments" class="back">← 衣物管理</router-link>
      <div class="page-head">
        <div class="title">
          <h1 class="ellipsis" :title="garment.name">{{ garment.name }}</h1>
          <DemoTag v-if="garment.demo" />
          <span v-if="garment.busy" class="busy">晾衣中</span>
        </div>
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="garment.sessionCount > 0"
          :title="garment.sessionCount > 0 ? `還有 ${garment.sessionCount} 筆晾衣紀錄，請先刪除或移到其他衣物` : undefined" @click="remove">刪除衣物</button>
      </div>
      <p v-if="mock.loadError.value || mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value || mock.loadError.value }}</p>
    </div>

    <section aria-label="統計" class="ui-stats">
      <div class="ui-stat"><span class="ui-stat__label">晾乾次數</span><span class="ui-stat__value">{{ dried.length }}<small> 次</small></span></div>
      <div class="ui-stat"><span class="ui-stat__label">平均乾燥時間</span><span class="ui-stat__value">{{ avgDry == null ? '—' : shortDuration(avgDry) }}</span></div>
    </section>

    <div class="layout">
      <form class="panel style-panel" @submit.prevent="save">
        <h2>衣物樣式設定</h2>
        <div class="style-body">
          <div class="figure"><GarmentFigure :garment="draft" uid="garment-detail" :label="`${draft.name || garment.name}預覽`" /></div>
          <div class="form">
            <GarmentForm v-model="draft" id-prefix="gd" placeholder="例如：白色班服" />
            <div v-if="changes.length" class="changes">
              <div v-for="ch in changes" :key="ch.label" class="change">
                <span class="muted">{{ ch.label }}</span><span class="from">{{ ch.from }}</span><span aria-hidden="true" class="muted">→</span><strong>{{ ch.to }}</strong>
              </div>
            </div>
            <p class="edit-note wa-tx">{{ note }}</p>
            <div class="btns">
              <button type="submit" class="ui-btn ui-btn--primary ui-btn--lg" :disabled="!dirty || !draft.name.trim() || draftTaken || saving">{{ saving ? '儲存中…' : '儲存' }}</button>
              <button type="button" class="ui-btn ui-btn--lg" :disabled="!dirty" @click="revert">復原</button>
            </div>
          </div>
        </div>
      </form>

      <section class="panel records-panel">
        <h2>晾衣紀錄</h2>
        <div class="ui-table-wrap">
          <table class="ui-table">
            <thead><tr><th scope="col">開始</th><th scope="col">衣夾</th><th scope="col">實際</th><th scope="col">預測</th><th scope="col">結果</th></tr></thead>
            <tbody>
              <tr v-if="!rows.length"><td colspan="5" class="muted">這件衣物還沒有晾衣紀錄</td></tr>
              <tr v-for="row in rows" :key="row.id" class="link-row" tabindex="0" @click="open(row.id)" @keydown.enter="open(row.id)">
                <td><router-link :to="`/sessions/${row.id}`" class="row-link" @click.stop>{{ row.date }}</router-link></td>
                <td>{{ row.clip }}</td>
                <td :class="row.actualTone">{{ row.actual }}</td>
                <td>{{ row.predicted }}</td>
                <td :class="row.resultTone">{{ row.result }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted small">點選紀錄可查看感測曲線、匯出 CSV、修改時間或改成其他衣物。</p>
      </section>
    </div>

    <p class="demo-note">
      改名稱、樣式、顏色或材質，這件衣物所有紀錄裡的衣物設定都會跟著改；每次的實際乾燥時間不變。預測是這件衣物過去「已乾」紀錄的平均，沒有紀錄時用材質預設值。
      <template v-if="garment.demo">這是示範衣物（存在伺服器，以 is_demo 標記），不列入統計頁的數字。</template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import DemoTag from '../components/clothes/DemoTag.vue';
import GarmentFigure from '../components/clothes/GarmentFigure.vue';
import GarmentForm from '../components/clothes/GarmentForm.vue';
import { SHAPES, colorName } from '../constants/garments';
import { useClothesMock, type GarmentDraft } from '../composables/useClothesMock';
import { clock, monthDay, shortDuration } from '../utils/format';

const route = useRoute();
const router = useRouter();
const mock = useClothesMock();

const garment = computed(() => mock.garmentById(String(route.params.id)));
const activeSession = computed(() => garment.value ? mock.state.sessions.find((s) => s.garmentId === garment.value!.id) ?? null : null);
const records = computed(() => garment.value ? mock.state.records.filter((r) => r.garmentId === garment.value!.id) : []);
const dried = computed(() => records.value.filter((r) => r.outcome === 'dry' && r.actualMin != null));
const avgDry = computed(() => dried.value.length ? Math.round(dried.value.reduce((sum, r) => sum + r.actualMin!, 0) / dried.value.length) : null);

// ---------------------------------------------------------------- style form
const fromGarment = (g: GarmentDraft): GarmentDraft => ({ name: g.name, style: g.style, color: g.color, material: g.material });
const draft = ref<GarmentDraft>({ name: '', style: 'tee', color: '#F2F1EC', material: '棉' });
// Load the saved values when the garment opens (or arrives after the first load), not on every poll.
watch(() => garment.value?.id, () => { if (garment.value) draft.value = fromGarment(garment.value); }, { immediate: true });

const saving = ref(false);
const dirty = computed(() => !!garment.value && (['name', 'style', 'color', 'material'] as const).some((k) => draft.value[k] !== garment.value![k]));
const draftTaken = computed(() => !!garment.value && mock.garmentNameTaken(draft.value.name, garment.value.demo, garment.value.id));
// Style or material change the prediction; a garment that is drying gets its session re-predicted.
const predictChanged = computed(() => !!garment.value && (draft.value.style !== garment.value.style || draft.value.material !== garment.value.material));
const changes = computed(() => {
  const d = draft.value, g = garment.value;
  if (!g) return [];
  const out: { label: string; from: string; to: string }[] = [];
  if (d.name.trim() !== g.name) out.push({ label: '名稱', from: g.name, to: d.name.trim() });
  if (d.style !== g.style) out.push({ label: '樣式', from: SHAPES[g.style].label, to: SHAPES[d.style].label });
  if (d.color !== g.color) out.push({ label: '顏色', from: colorName(g.color), to: colorName(d.color) });
  if (d.material !== g.material) out.push({ label: '材質', from: g.material, to: d.material });
  return out;
});
const note = computed(() => {
  if (draftTaken.value) return `已經有名為「${draft.value.name.trim()}」的衣物，請換一個名稱`;
  if (!dirty.value) return '';
  const parts: string[] = [];
  if (garment.value && garment.value.sessionCount > 0) parts.push(`已有 ${garment.value.sessionCount} 筆紀錄會一起改成新的設定`);
  if (predictChanged.value && activeSession.value) parts.push('這次晾衣的預測會重新計算');
  return parts.join('；');
});

async function save() {
  const g = garment.value;
  if (!g || !dirty.value || !draft.value.name.trim() || draftTaken.value) return;
  const reprice = predictChanged.value && activeSession.value;
  saving.value = true;
  try {
    if (!await mock.updateGarment(g.id, { ...draft.value, name: draft.value.name.trim() })) return;
    if (reprice) await mock.swapGarment(reprice.id, g.id);  // re-predict with the new material/style
    draft.value = fromGarment({ ...draft.value, name: draft.value.name.trim() });
  } finally { saving.value = false; }
}
function revert() { if (garment.value) draft.value = fromGarment(garment.value); }

async function remove() {
  const g = garment.value;
  if (!g || g.sessionCount > 0) return;
  if (!window.confirm(`確定要刪除「${g.name}」嗎？刪除後無法復原。`)) return;
  if (await mock.deleteGarment(g.id)) void router.push('/garments');
}

// ---------------------------------------------------------------- records
const clipName = (id: string) => mock.clipById(id)?.name ?? '—';
const when = (at: number) => `${monthDay(at)} ${clock(at)}`;
const rows = computed(() => {
  const out = records.value.map((r) => ({
    id: r.id, at: r.startedAt, date: when(r.startedAt), clip: clipName(r.clipId),
    actual: r.actualMin == null ? '—' : shortDuration(r.actualMin), actualTone: r.actualMin == null ? 'muted' : '',
    predicted: shortDuration(r.predictedMin),
    result: r.outcome === 'dry' ? '已乾' : '提早收起', resultTone: r.outcome === 'dry' ? '' : 'muted',
  }));
  const s = activeSession.value;
  if (s) out.push({ id: s.id, at: s.startedAt, date: when(s.startedAt), clip: clipName(s.clipId), actual: '晾衣中', actualTone: 'ac-tx',
    predicted: shortDuration(s.totalMin), result: '晾衣中', resultTone: 'ac-tx' });
  return out.sort((a, b) => b.at - a.at);
});
const open = (id: string) => { void router.push(`/sessions/${id}`); };
</script>

<style scoped>
.head { display: flex; flex-direction: column; gap: 12px; }
.back { align-self: flex-start; font-size: 0.9375rem; color: var(--tx2); text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; }
.back:hover { color: var(--tx); }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-width: 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.busy { font-size: 0.8125rem; padding: 2px 10px; border-radius: 999px; background: var(--ac-soft); color: var(--ac-tx); }

.layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.style-panel { flex: 1 1 460px; min-width: 0; }
.records-panel { flex: 999 1 520px; min-width: 0; }
.style-body { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.figure { flex: 0 0 180px; max-width: 180px; }
.form { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.changes { display: flex; flex-direction: column; gap: 6px; font-size: 0.9375rem; }
.change { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.from { text-decoration: line-through; color: var(--tx2); }
.edit-note { min-height: 1.5rem; font-size: 0.9375rem; }
.btns { display: flex; flex-wrap: wrap; gap: 12px; }

.link-row { cursor: pointer; }
.link-row:hover td { background: var(--sf2); }
.row-link { color: var(--tx); font-weight: 700; text-decoration: none; }
.small { font-size: 0.875rem; }
</style>
