<template>
  <div class="page">
    <div class="page-head">
      <h1>衣物管理</h1>
      <div class="head-btns">
        <router-link to="/sessions" class="ui-btn">查看全部晾衣紀錄</router-link>
        <button type="button" class="ui-btn ui-btn--primary" :aria-expanded="adding" @click="toggleAdd">{{ adding ? '取消新增' : '＋ 新增衣物' }}</button>
      </div>
    </div>

    <p v-if="mock.loadError.value || mock.actionError.value" class="ui-note ui-note--error" role="alert">{{ mock.actionError.value || mock.loadError.value }}</p>

    <form v-if="adding" class="panel add" @submit.prevent="create">
      <h2>新增衣物</h2>
      <div class="add-body">
        <div class="add-figure"><GarmentFigure :garment="draft" uid="new-garment" label="新衣物預覽" /></div>
        <div class="add-form">
          <GarmentForm v-model="draft" id-prefix="gm-new" placeholder="例如：白色班服" />
          <p class="edit-note wa-tx">{{ draftTaken ? `已經有名為「${draft.name.trim()}」的衣物，請換一個名稱` : '' }}</p>
          <div class="btns">
            <button type="submit" class="ui-btn ui-btn--primary ui-btn--lg" :disabled="!draft.name.trim() || draftTaken || saving">{{ saving ? '儲存中…' : '新增' }}</button>
            <button type="button" class="ui-btn ui-btn--ghost" @click="toggleAdd">取消</button>
          </div>
        </div>
      </div>
    </form>

    <div v-if="!mock.state.garments.length" class="panel empty">
      <strong>{{ mock.loaded.value ? '還沒有衣物' : '正在讀取衣物…' }}</strong>
      <p class="muted">按「新增衣物」建立第一件，或在開始晾衣時直接新增。</p>
    </div>

    <ul v-else class="grid" aria-label="衣物列表">
      <li v-for="g in mock.state.garments" :key="g.id" class="card">
        <router-link :to="`/garments/${g.id}`" class="card-link">
          <span class="thumb"><GarmentFigure :garment="g" :uid="`gm-${g.id}`" :label="g.name" /></span>
          <span class="card-text">
            <b class="ellipsis" :title="g.name">{{ g.name }}</b>
            <small class="muted">{{ g.material }} · {{ SHAPES[g.style].label }}</small>
            <small class="muted">{{ g.dryCount ? `晾乾 ${g.dryCount} 次` : '還沒晾乾過' }}{{ g.sessionCount > g.dryCount ? ` · 共 ${g.sessionCount} 筆紀錄` : '' }}</small>
            <span class="tags"><span v-if="g.busy" class="busy">晾衣中</span><DemoTag v-if="g.demo" /></span>
          </span>
        </router-link>
        <button type="button" class="ui-btn ui-btn--ghost del" :disabled="g.sessionCount > 0"
          :title="g.sessionCount > 0 ? `還有 ${g.sessionCount} 筆晾衣紀錄，請先刪除或移到其他衣物` : `刪除「${g.name}」`"
          :aria-label="`刪除「${g.name}」`" @click="remove(g)">刪除</button>
      </li>
    </ul>

    <p class="demo-note">
      還有晾衣紀錄（包含晾衣中）的衣物不能刪除，請先到紀錄裡刪除或改成其他衣物。
      <template v-if="mock.demoEnabled.value">標了「示範」的衣物是示範資料（存在伺服器，以 is_demo 標記），可在設定關閉示範資料。</template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import DemoTag from '../components/clothes/DemoTag.vue';
import GarmentFigure from '../components/clothes/GarmentFigure.vue';
import GarmentForm from '../components/clothes/GarmentForm.vue';
import { SHAPES } from '../constants/garments';
import { useClothesMock, type Garment, type GarmentDraft } from '../composables/useClothesMock';

const mock = useClothesMock();

const blank = (): GarmentDraft => ({ name: '', style: 'tee', color: '#F2F1EC', material: '棉' });
const adding = ref(false);
const saving = ref(false);
const draft = ref<GarmentDraft>(blank());
// New garments from this page are real ones.
const draftTaken = computed(() => mock.garmentNameTaken(draft.value.name, false));

function toggleAdd() {
  adding.value = !adding.value;
  draft.value = blank();
}
async function create() {
  if (!draft.value.name.trim() || draftTaken.value) return;
  saving.value = true;
  const created = await mock.addGarment({ ...draft.value, name: draft.value.name.trim() }, false);
  saving.value = false;
  if (created) { adding.value = false; draft.value = blank(); }
}

async function remove(g: Garment) {
  if (g.sessionCount > 0) return;
  if (window.confirm(`確定要刪除「${g.name}」嗎？刪除後無法復原。`)) await mock.deleteGarment(g.id);
}
</script>

<style scoped>
.head-btns { display: flex; flex-wrap: wrap; gap: 12px; }
.add-body { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.add-figure { flex: 0 0 200px; max-width: 200px; }
.add-form { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.edit-note { min-height: 1.5rem; font-size: 0.9375rem; }
.btns { display: flex; flex-wrap: wrap; gap: 12px; }
.empty { align-items: center; text-align: center; padding: 64px 20px; border-style: dashed; }

.grid { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.card { position: relative; display: flex; flex-direction: column; border: 1px solid var(--bd); background: var(--sf); border-radius: 16px; overflow: hidden; }
.card:hover { border-color: var(--bd2); }
.card-link { display: flex; gap: 16px; align-items: center; padding: 16px 16px 8px; color: var(--tx); text-decoration: none; min-width: 0; }
.thumb { flex: 0 0 84px; width: 84px; height: 104px; display: block; }
.thumb :deep(svg) { width: 100%; height: 100%; }
.card-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.card-text b { font-size: 1.0625rem; }
.card-text small { font-size: 0.8125rem; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; min-height: 1.5rem; align-items: center; }
.busy { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--ac-soft); color: var(--ac-tx); }
.del { align-self: flex-end; margin: 0 12px 12px; font-size: 0.875rem; }
</style>
