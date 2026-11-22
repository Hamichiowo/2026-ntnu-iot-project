<template>
  <section v-for="s in sensors" :key="s.key" class="panel sensor" :class="{ chosen: s.key === chosen }">
    <div class="sensor-head">
      <h2><i :style="{ background: palette[s.color] }"></i>{{ s.method }} <small class="muted">{{ s.hardware }}</small>
        <em v-if="s.key === chosen" class="chosen-tag">預測使用</em></h2>
      <span v-if="latest !== undefined" class="reading num">{{ formatRaw(latest?.[s.key]) }}<small> 原始計數</small></span>
    </div>
    <p v-if="latest && latest[s.key] === null" class="wa-tx small">本筆讀取失敗</p>
    <div class="chart" :class="{ selectable }" :title="selectable ? '按住拖曳可選取時段' : undefined">
      <Line :data="chartDatasets[s.key]" :options="chartOptions" :plugins="plugins" />
    </div>
    <span class="muted small">{{ s.key }} · {{ s.description }}</span>
  </section>

  <section v-if="airRecords.length" class="panel sensor">
    <div class="sensor-head">
      <h2><i :style="{ background: palette.temp }"></i>環境溫度 <i :style="{ background: palette.humi }"></i>環境濕度</h2>
      <span class="muted small">空氣盒子 {{ airDeviceId ?? '—' }} · 約每分鐘一筆</span>
    </div>
    <div class="chart" :class="{ selectable }" :title="selectable ? '按住拖曳可選取時段' : undefined">
      <Line :data="envChartData" :options="envChartOptions" :plugins="plugins" />
    </div>
  </section>
</template>

<script setup lang="ts">
// Raw sensor curves (weight / resistance / capacitance as raw counts) plus the paired air box's
// temperature and humidity, over a fixed time window. Pass a range-select plugin to make them selectable.
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend, type ChartOptions, type Plugin } from 'chart.js';
import { useTheme } from '../../composables/useTheme';
import { SENSORS, type AirReading, type Field, type Reading, type Sensor } from '../../composables/useClothesData';
import { formatAir, formatRaw, formatTime } from '../../utils/format';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

const props = withDefaults(defineProps<{
  records: Reading[];
  airRecords: AirReading[];
  range: { start: Date; end: Date };
  staleAfterMs: number;
  bucketSeconds?: number;
  sensors?: Sensor[];
  chosen?: Field;
  latest?: Reading | null;  // undefined = no reading in the header
  airDeviceId?: string | null;
  plugins?: Plugin<'line'>[];
}>(), { bucketSeconds: 0, sensors: () => SENSORS, chosen: undefined, latest: undefined, airDeviceId: null, plugins: () => [] });

const { palette } = useTheme();
const selectable = computed(() => props.plugins.length > 0);

const timeTick = (value: number) => {
  const long = props.range.end.getTime() - props.range.start.getTime() > 6 * 60 * 60000;
  return new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false,
    ...(long ? { month: 'numeric', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', ...(long ? {} : { second: '2-digit' }) });
};

function chartData(sensor: Sensor) {
  const points: { x: number; y: number | null }[] = [];
  let previous: number | undefined;
  // Break the line only where data was interrupted (the clip reports about once a minute),
  // or across more than ~2 averaged buckets.
  const gapMs = Math.max(props.staleAfterMs, props.bucketSeconds * 2500);
  for (const record of props.records) {
    const time = new Date(record.timestamp).getTime();
    if (previous !== undefined && time - previous > gapMs) points.push({ x: previous + 1, y: null });
    points.push({ x: time, y: record[sensor.key] });
    previous = time;
  }
  const color = palette.value[sensor.color];
  return { datasets: [{ label: sensor.title, data: points, borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: props.records.length === 1 ? 3 : 0, pointHitRadius: 8, spanGaps: false, tension: 0 }] };
}
// Built once per data change, so typing in a form or dragging never rebuilds the charts.
const chartDatasets = computed(() => Object.fromEntries(SENSORS.map((s) => [s.key, chartData(s)])) as Record<Field, ReturnType<typeof chartData>>);

const envChartData = computed(() => {
  const series = (key: 'temp' | 'humi') => {
    const points: { x: number; y: number | null }[] = [];
    let previous: number | undefined;
    for (const reading of props.airRecords) {
      const time = new Date(reading.timestamp).getTime();
      // The box reports about once a minute; break the line if it went quiet for over 5 minutes.
      if (previous !== undefined && time - previous > 5 * 60000) points.push({ x: previous + 1, y: null });
      points.push({ x: time, y: reading[key] });
      previous = time;
    }
    const color = palette.value[key];
    return { label: key === 'temp' ? '環境溫度' : '環境濕度', data: points, yAxisID: key === 'temp' ? 'y' : 'y1', borderColor: color,
      backgroundColor: color, borderWidth: 2, pointRadius: props.airRecords.length === 1 ? 3 : 0, pointHitRadius: 8, spanGaps: false, tension: 0 };
  };
  return { datasets: [series('temp'), series('humi')] };
});

// Round tick spacing (whole minutes/hours) so labels read 10:00, 12:00 … rather than 10:26.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720].map((m) => m * 60000);
const tickStep = (spanMs: number) => TICK_STEPS.find((step) => spanMs / step <= 7) ?? TICK_STEPS[TICK_STEPS.length - 1];

// Fixed x range: the axis shows the whole requested window, even when data covers only part of it.
const chartOptions = computed<ChartOptions<'line'>>(() => {
  const p = palette.value;
  const { start, end } = props.range;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'nearest', intersect: false },
    events: ['mousemove', 'mouseout', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend'],
    plugins: { legend: { display: false }, tooltip: { backgroundColor: p.tooltip, callbacks: {
      title: (items) => items.length && items[0].parsed.x != null ? formatTime(items[0].parsed.x) : '',
    } } },
    scales: {
      x: { type: 'linear', min: start.getTime(), max: end.getTime(),
        ticks: { color: p.mu, stepSize: tickStep(end.getTime() - start.getTime()), maxTicksLimit: 8,
          callback: (value) => timeTick(Number(value)) }, grid: { display: false }, border: { color: p.bd } },
      y: { title: { display: true, text: '原始計數', color: p.mu }, ticks: { color: p.mu, precision: 0 }, grid: { color: p.grid }, border: { color: p.bd } },
    },
  };
});
const envChartOptions = computed<ChartOptions<'line'>>(() => {
  const p = palette.value;
  return {
    ...chartOptions.value,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: p.tooltip, callbacks: {
      title: (items) => items.length && items[0].parsed.x != null ? formatTime(items[0].parsed.x) : '',
      label: (item) => `${item.dataset.label}：${formatAir(item.parsed.y)} ${item.datasetIndex === 0 ? '°C' : '%'}`,
    } } },
    scales: {
      x: chartOptions.value.scales!.x!,
      y: { position: 'left', title: { display: true, text: '溫度 °C', color: p.temp }, ticks: { color: p.temp }, grid: { color: p.grid } },
      y1: { position: 'right', title: { display: true, text: '濕度 %', color: p.humi }, ticks: { color: p.humi }, grid: { display: false } },
    },
  };
});
</script>

<style scoped>
.sensor.chosen { border-color: var(--ac-bd); }
.sensor-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
.sensor-head h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sensor-head h2 i { width: 12px; height: 12px; flex: 0 0 auto; }
.sensor-head h2 small { font-size: 0.875rem; font-weight: 400; }
.chosen-tag { font-style: normal; font-size: 0.75rem; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--ac-soft); color: var(--ac-tx); }
.reading { font-size: 2.25rem; font-weight: 700; line-height: 1; }
.reading small { font-size: 1rem; color: var(--mu); font-weight: 400; }
.chart { height: 195px; }
.chart.selectable { cursor: crosshair; user-select: none; }
.chart.selectable :deep(canvas) { touch-action: pan-y; }  /* horizontal finger drags select; vertical ones still scroll */
.small { font-size: 0.875rem; }
</style>
