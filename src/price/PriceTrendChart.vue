<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'vue-chartjs';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Filler);

const props = defineProps({
  history: { type: Array, default: () => [] },
  axisTimeLabel: { type: String, required: true },
  axisPriceLabel: { type: String, required: true },
  chartLabel: { type: String, default: '' },
  locale: { type: String, default: 'zh-CN' },
});

const themeTick = ref(0);
let themeObserver = null;

const validRows = computed(() => props.history
  .map((row) => {
    const observedAt = new Date(row?.observedAt);
    const rawMinPrice = row?.minPrice;
    if (rawMinPrice === null || rawMinPrice === undefined) return null;
    if (typeof rawMinPrice === 'string' && rawMinPrice.trim() === '') return null;
    const minPrice = Number(rawMinPrice);
    if (Number.isNaN(observedAt.getTime()) || !Number.isFinite(minPrice)) return null;
    return {
      observedAt,
      minPrice,
      label: formatDateTime(observedAt, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      fullLabel: formatDateTime(observedAt),
    };
  })
  .filter(Boolean));

const canRenderChart = computed(() => validRows.value.length >= 2);

const chartColors = computed(() => {
  // Reading this ref makes theme color options recompute after data-theme changes.
  themeTick.value;
  return {
    grid: readCssVariable('--line', '#303940'),
    text: readCssVariable('--muted', '#9aa8b1'),
    pointFill: readCssVariable('--surface', '#191d20'),
    stroke: readCssVariable('--primary-strong', '#39a895'),
    fill: withAlpha(readCssVariable('--primary-strong', '#39a895'), 0.16),
  };
});

const chartData = computed(() => ({
  labels: validRows.value.map((row) => row.label),
  datasets: [
    {
      label: props.axisPriceLabel,
      data: validRows.value.map((row) => row.minPrice),
      borderColor: chartColors.value.stroke,
      backgroundColor: chartColors.value.fill,
      pointBackgroundColor: chartColors.value.pointFill,
      pointBorderColor: chartColors.value.stroke,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
      fill: true,
      tension: 0.25,
    },
  ],
}));

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title(items) {
          const index = items?.[0]?.dataIndex;
          return validRows.value[index]?.fullLabel || '';
        },
        label(context) {
          const value = context.parsed?.y ?? context.raw;
          return `${props.axisPriceLabel}: ${formatNumber(value)}`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { color: chartColors.value.grid },
      ticks: { color: chartColors.value.text },
      title: {
        display: true,
        text: props.axisTimeLabel,
        color: chartColors.value.text,
      },
    },
    y: {
      grid: { color: chartColors.value.grid },
      ticks: {
        color: chartColors.value.text,
        callback: (value) => formatNumber(value),
      },
      title: {
        display: true,
        text: props.axisPriceLabel,
        color: chartColors.value.text,
      },
    },
  },
}));

function formatDateTime(value, options) {
  return value.toLocaleString(props.locale, options);
}

function formatNumber(value) {
  return Number(value).toLocaleString(props.locale);
}

function readCssVariable(name, fallback) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return fallback;
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function withAlpha(color, alpha) {
  const rgbMatch = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }

  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const fullHex = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex;
    const intValue = Number.parseInt(fullHex, 16);
    if (Number.isFinite(intValue)) {
      const red = (intValue >> 16) & 255;
      const green = (intValue >> 8) & 255;
      const blue = intValue & 255;
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
  }
  return color;
}

onMounted(() => {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  themeObserver = new MutationObserver(() => {
    themeTick.value += 1;
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});
</script>

<template>
  <div
    v-if="canRenderChart"
    class="trend-chart"
    role="img"
    :aria-label="chartLabel || axisPriceLabel"
    data-testid="price-trend-chart"
  >
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
