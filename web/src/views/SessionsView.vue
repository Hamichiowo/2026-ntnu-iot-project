<template>
  <div class="page">
    <router-link to="/garments" class="back">← 衣物管理</router-link>
    <div class="page-head">
      <h1>全部晾衣紀錄</h1>
      <button type="button" class="ui-btn" @click="exportCsv">匯出 CSV</button>
    </div>

    <p v-if="mock.loadError.value || mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value || mock.loadError.value }}</p>
    <section class="panel">
      <div class="ui-table-wrap">
        <table class="ui-table">
          <thead><tr><th scope="col">日期</th><th scope="col">衣物</th><th scope="col">實際</th><th scope="col">預測</th><th scope="col">誤差</th></tr></thead>
          <tbody>
            <tr v-if="!rows.length"><td colspan="5" class="muted">還沒有晾衣紀錄</td></tr>
            <tr v-for="row in rows" :key="row.id" class="link-row" tabindex="0" @click="open(row.id)" @keydown.enter="open(row.id)">
              <td><router-link :to="`/sessions/${row.id}`" class="row-link" @click.stop>{{ row.date }}</router-link></td>
              <td class="strong">{{ row.name }} <small class="muted">{{ row.material }}</small> <DemoTag v-if="row.demo" /></td>
              <td :class="row.actualTone">{{ row.actual }}</td>
              <td>{{ row.predicted }}</td>
              <td :class="row.errorTone">{{ row.error }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="predicting" class="demo-note foot">
      <span>標了「示範」的紀錄是示範資料（存在伺服器，以 is_demo 標記），點選一筆可查看詳細內容。{{ hasDemo ? '' : '目前還沒有示範資料，執行 make seed 或按右邊的按鈕建立。' }}可在設定關閉示範資料。</span>
      <button type="button" class="ui-btn ui-btn--ghost" @click="resetDemo">{{ hasDemo ? '重設示範資料' : '建立示範資料' }}</button>
    </div>
    <p v-else class="demo-note">只列出實際的晾衣紀錄（存在伺服器），點選一筆可查看感測曲線、修改或刪除。預測是這件衣物過去的平均乾燥時間，第一次晾用材質預設值；提早收起的紀錄不計算誤差。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import DemoTag from '../components/clothes/DemoTag.vue';
import { useClothesMock } from '../composables/useClothesMock';
import { TAIPEI_MS, monthDay, shortDuration } from '../utils/format';

const mock = useClothesMock();
const router = useRouter();
const open = (id: string) => { void router.push(`/sessions/${id}`); };
// With the demo on, demo rows are listed (labelled) next to the real ones.
const predicting = computed(() => mock.demoEnabled.value);

const hasDemo = computed(() => mock.state.records.some((r) => r.demo) || mock.state.sessions.some((s) => s.demo));
const nameOf = (garmentId: string) => mock.garmentById(garmentId)?.name ?? '已刪除的衣物';
const materialOf = (garmentId: string) => mock.garmentById(garmentId)?.material ?? '—';

const rows = computed(() => {
  const active = mock.state.sessions.map((s) => ({
    id: s.id, demo: s.demo, at: s.startedAt, date: monthDay(s.startedAt), name: nameOf(s.garmentId), material: materialOf(s.garmentId),
    actual: '晾衣中', actualTone: 'ac-tx', predicted: shortDuration(s.totalMin), error: '—', errorTone: 'muted',
  }));
  const done = mock.state.records.map((r) => {
    const err = r.actualMin == null ? null : Math.abs(r.actualMin - r.predictedMin);
    return {
      id: r.id, demo: r.demo, at: r.startedAt, date: monthDay(r.startedAt), name: nameOf(r.garmentId), material: materialOf(r.garmentId),
      actual: r.actualMin == null ? '提早收起' : shortDuration(r.actualMin), actualTone: r.actualMin == null ? 'muted' : '',
      predicted: shortDuration(r.predictedMin),
      error: err == null ? '不列入' : shortDuration(err),
      errorTone: err == null ? 'muted' : err >= 30 ? 'wa-tx strong' : '',
    };
  });
  return [...active, ...done].sort((a, b) => b.at - a.at);
});

function exportCsv() {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['開始時間（台北）', '衣物', '材質', '實際（分）', '預測（分）', '結果', '資料來源'].map(esc).join(',')];
  const all = [
    ...mock.state.sessions.map((s) => ({ at: s.startedAt, g: s.garmentId, actual: '', predicted: s.totalMin, result: '晾衣中', demo: s.demo })),
    ...mock.state.records.map((r) => ({ at: r.startedAt, g: r.garmentId, actual: r.actualMin ?? '', predicted: r.predictedMin, result: r.outcome === 'dry' ? '已乾' : '提早收起', demo: r.demo })),
  ].sort((a, b) => b.at - a.at);
  for (const r of all) {
    const local = new Date(r.at + TAIPEI_MS).toISOString().slice(0, 16).replace('T', ' ');
    lines.push([local, nameOf(r.g), materialOf(r.g), r.actual, r.predicted, r.result, r.demo ? '示範' : '實際'].map(esc).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date(Date.now() + TAIPEI_MS).toISOString().slice(0, 10).replace(/-/g, '');
  const link = Object.assign(document.createElement('a'), { href: url, download: `clothes_sessions${predicting.value ? '_demo' : ''}_${stamp}.csv` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetDemo() {
  if (window.confirm('重設後，示範的衣夾、衣物、晾衣中項目與紀錄都會回到初始內容；實際的紀錄不受影響。確定要重設嗎？')) void mock.reset();
}
</script>

<style scoped>
.back { align-self: flex-start; font-size: 0.9375rem; color: var(--tx2); text-decoration: none; min-height: 32px; display: inline-flex; align-items: center; }
.back:hover { color: var(--tx); }
.link-row { cursor: pointer; }
.link-row:hover td { background: var(--sf2); }
.row-link { color: inherit; text-decoration: none; }
.row-link:hover { text-decoration: underline; }
.ui-table td { padding: 16px 12px; }
.strong { font-weight: 700; }
.strong small { font-weight: 400; font-size: 0.8125rem; margin-left: 4px; }
.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
</style>
