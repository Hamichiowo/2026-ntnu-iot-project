// Drag across a Chart.js line chart to pick a time range; the shaded band is drawn on every chart
// that uses the same plugin. Once picked, the start and end lines have handles that can be dragged
// to adjust either side. Used by the clip detail page and the drying record time editor.
import { ref, watch } from 'vue';
import type { Chart, Plugin } from 'chart.js';
import { useTheme } from './useTheme';

export interface Picked { start: number; end: number }
export interface RangeSelectHooks {
  // While dragging (every move). `resizing` = one edge of an existing selection is being moved.
  onMove?: (picked: Picked, resizing: boolean) => void;
  // When the pointer is released on a real range (not a click).
  onPick?: (picked: Picked, resizing: boolean) => void;
}

const hexAlpha = (hex: string, alpha: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function useRangeSelect(hooks: RangeSelectHooks = {}) {
  const { palette } = useTheme();
  const selection = ref<Picked | null>(null);
  const charts = new Set<Chart>();
  let dragAnchor: number | null = null;  // the side that stays put while the other follows the pointer
  let resizing = false;
  let lastPointer: number | null = null;

  const plugin: Plugin<'line'> = {
    id: 'rangeSelect',
    afterInit: (chart) => { charts.add(chart as Chart); },
    afterDestroy: (chart) => { charts.delete(chart as Chart); },
    afterEvent(chart, args) {
      const event = args.event;
      // chart.update() replays the last event; acting on it would re-select and loop forever.
      if (args.replay) return;
      // A lifted finger (touchend) has no position; finish the drag where it last was.
      const ended = event.type === 'mouseup' || event.type === 'mouseout';
      if (event.x == null || !Number.isFinite(event.x)) { if (!ended || lastPointer === null) return; event.x = lastPointer; }
      lastPointer = event.x;
      const area = chart.chartArea;
      const x = chart.scales.x;
      const value = x.getValueForPixel(Math.min(Math.max(event.x, area.left), area.right)) as number;
      // Which selection edge (if any) the pointer is on; fingers get a wider target than a mouse.
      const reach = (event.native as Event | null)?.type.startsWith('touch') ? 18 : 7;
      const current = selection.value;
      const edge = !current ? null
        : Math.abs(event.x - x.getPixelForValue(current.start)) <= reach ? 'start'
        : Math.abs(event.x - x.getPixelForValue(current.end)) <= reach ? 'end' : null;
      if (event.type === 'mousedown') {
        if (current && edge) { dragAnchor = edge === 'start' ? current.end : current.start; resizing = true; return; }
        dragAnchor = value; resizing = false; selection.value = null; return;
      }
      if (dragAnchor === null) {
        if (event.type === 'mousemove') chart.canvas.style.cursor = edge ? 'ew-resize' : 'crosshair';
        return;
      }
      const picked = { start: Math.min(dragAnchor, value), end: Math.max(dragAnchor, value) };
      if (event.type === 'mousemove') {
        selection.value = picked;
        hooks.onMove?.(picked, resizing);
      } else if (ended) {
        dragAnchor = null;
        if (picked.end - picked.start < 1000) {  // a click, not a drag (or both edges pulled together)
          if (!resizing) selection.value = null;
          resizing = false; return;
        }
        selection.value = picked;
        hooks.onPick?.(picked, resizing);
        resizing = false;
      }
    },
    beforeDatasetsDraw(chart) {
      if (!selection.value) return;
      const { ctx, chartArea: area, scales: { x } } = chart;
      const left = Math.max(area.left, x.getPixelForValue(selection.value.start));
      const right = Math.min(area.right, x.getPixelForValue(selection.value.end));
      if (right <= left) return;
      ctx.save(); ctx.fillStyle = hexAlpha(palette.value.ac, 0.14); ctx.fillRect(left, area.top, right - left, area.bottom - area.top); ctx.restore();
    },
    afterDatasetsDraw(chart) {
      if (!selection.value) return;
      const { ctx, chartArea: area, scales: { x } } = chart;
      const middle = (area.top + area.bottom) / 2;
      ctx.save();
      for (const time of [selection.value.start, selection.value.end]) {
        const px = Math.round(x.getPixelForValue(time)) + 0.5;
        if (px < area.left - 1 || px > area.right + 1) continue;  // edge is outside the visible window
        ctx.strokeStyle = palette.value.ac; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
        // Grip: a small pill with two ridges so the line reads as draggable.
        ctx.fillStyle = palette.value.sf; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(px - 5, middle - 13, 10, 26, 4); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px - 1.5, middle - 6); ctx.lineTo(px - 1.5, middle + 6);
        ctx.moveTo(px + 1.5, middle - 6); ctx.lineTo(px + 1.5, middle + 6); ctx.stroke();
      }
      ctx.restore();
    },
  };

  watch([selection, palette], () => charts.forEach((chart) => { chart.draw(); }));

  return {
    selection, plugin,
    // True while the pointer is held down (a drag writes its own fields; don't echo them back).
    dragging: () => dragAnchor !== null,
  };
}
