# Price Chart Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written SVG Price trend chart with a Chart.js-backed Vue component that shows usable time and price ticks.

**Architecture:** Add a focused `PriceTrendChart.vue` component that receives normalized history rows from `src/price/App.vue`. The component uses `vue-chartjs` with Chart.js `CategoryScale` labels, avoiding `TimeScale` and date adapters. Tests mock `vue-chartjs` so Vitest does not need a real Canvas implementation.

**Tech Stack:** Vue 3, Chart.js 4, vue-chartjs 5, Vite, Vitest, happy-dom.

---

## File Structure

- Create `src/price/PriceTrendChart.vue`: owns Chart.js registration, data/options construction, theme-aware colors, and empty chart behavior.
- Modify `src/price/App.vue`: remove hand-written SVG point calculations and render `PriceTrendChart`.
- Modify `src/price/App.test.js`: mock chart rendering and assert the new chart path is used.
- Create `src/price/PriceTrendChart.test.js`: focused component tests for chart config and empty behavior.
- Modify `package.json` and `package-lock.json`: add `chart.js@4` and `vue-chartjs@5`.
- Modify built Price assets under `public/price` after `npm run build:price`.

---

### Task 1: Add Chart Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install dependencies**

Run:

```bash
npm install chart.js@4 vue-chartjs@5
```

Expected:

```text
package-lock.json is updated and npm exits with code 0.
```

- [ ] **Step 2: Verify dependency declarations**

Run:

```bash
node -e "const p=require('./package.json'); console.log(p.dependencies['chart.js']); console.log(p.dependencies['vue-chartjs'])"
```

Expected:

```text
First line starts with ^4.
Second line starts with ^5.
```

- [ ] **Step 3: Commit dependency metadata**

Run:

```bash
git add package.json package-lock.json
git commit -m "chore: add price chart dependencies"
```

Expected: commit succeeds.

---

### Task 2: Build PriceTrendChart With Tests

**Files:**
- Create: `src/price/PriceTrendChart.vue`
- Create: `src/price/PriceTrendChart.test.js`

- [ ] **Step 1: Write failing component tests**

Create `src/price/PriceTrendChart.test.js`:

```js
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import PriceTrendChart from './PriceTrendChart.vue';

const lineProps = [];

vi.mock('vue-chartjs', () => ({
  Line: {
    name: 'MockLine',
    props: ['data', 'options'],
    setup(props) {
      lineProps.push(props);
      return () => null;
    },
  },
}));

describe('PriceTrendChart', () => {
  it('passes formatted labels, prices, and axis titles to the line chart', () => {
    lineProps.length = 0;
    mount(PriceTrendChart, {
      props: {
        history: [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
        ],
        axisTimeLabel: '时间',
        axisPriceLabel: '价格',
        locale: 'zh-CN',
      },
    });

    expect(lineProps).toHaveLength(1);
    expect(lineProps[0].data.datasets[0].data).toEqual([4400, 5000]);
    expect(lineProps[0].data.labels).toHaveLength(2);
    expect(lineProps[0].options.scales.x.title.text).toBe('时间');
    expect(lineProps[0].options.scales.y.title.text).toBe('价格');
    expect(lineProps[0].options.scales.y.ticks.callback(5000)).toBe('5,000');
  });

  it('does not render a chart when fewer than two valid points exist', () => {
    const wrapper = mount(PriceTrendChart, {
      props: {
        history: [
          { observedAt: 'bad-date', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: null },
        ],
        axisTimeLabel: 'Time',
        axisPriceLabel: 'Price',
        locale: 'en-US',
      },
    });

    expect(wrapper.find('[data-testid="price-trend-chart"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- src/price/PriceTrendChart.test.js
```

Expected: FAIL because `src/price/PriceTrendChart.vue` does not exist.

- [ ] **Step 3: Implement the component**

Create `src/price/PriceTrendChart.vue`:

```vue
<script setup>
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
import { computed, onMounted, onUnmounted, ref } from 'vue';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, Tooltip, Filler);

const props = defineProps({
  history: { type: Array, default: () => [] },
  axisTimeLabel: { type: String, required: true },
  axisPriceLabel: { type: String, required: true },
  locale: { type: String, default: 'zh-CN' },
});

const themeTick = ref(0);
let observer = null;

const validRows = computed(() => props.history
  .map((row) => ({
    observedAt: row?.observedAt,
    time: new Date(row?.observedAt).getTime(),
    minPrice: Number(row?.minPrice),
  }))
  .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.minPrice)));

const canRenderChart = computed(() => validRows.value.length >= 2);

const colors = computed(() => {
  themeTick.value;
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--muted').trim() || '#9ca3af',
    grid: styles.getPropertyValue('--border').trim() || 'rgba(148, 163, 184, 0.22)',
    line: styles.getPropertyValue('--accent').trim() || '#38bdf8',
    fill: 'rgba(56, 189, 248, 0.12)',
  };
});

const chartData = computed(() => ({
  labels: validRows.value.map((row) => formatCompactTime(row.observedAt, props.locale)),
  datasets: [{
    label: props.axisPriceLabel,
    data: validRows.value.map((row) => row.minPrice),
    borderColor: colors.value.line,
    backgroundColor: colors.value.fill,
    pointBackgroundColor: colors.value.line,
    pointRadius: 2,
    pointHoverRadius: 4,
    borderWidth: 2,
    tension: 0.25,
    fill: true,
  }],
}));

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title(items) {
          const index = items?.[0]?.dataIndex ?? 0;
          return formatFullTime(validRows.value[index]?.observedAt, props.locale);
        },
        label(item) {
          return `${props.axisPriceLabel}: ${formatNumber(item.parsed.y, props.locale)}`;
        },
      },
    },
  },
  scales: {
    x: {
      title: { display: true, text: props.axisTimeLabel, color: colors.value.text },
      ticks: { color: colors.value.text, maxRotation: 0, autoSkip: true },
      grid: { color: colors.value.grid },
    },
    y: {
      title: { display: true, text: props.axisPriceLabel, color: colors.value.text },
      ticks: {
        color: colors.value.text,
        callback(value) {
          return formatNumber(value, props.locale);
        },
      },
      grid: { color: colors.value.grid },
    },
  },
}));

function formatNumber(value, locale) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString(locale) : '-';
}

function formatCompactTime(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFullTime(value, locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(locale);
}

onMounted(() => {
  observer = new MutationObserver(() => {
    themeTick.value += 1;
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div v-if="canRenderChart" class="trend-chart" data-testid="price-trend-chart">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
```

- [ ] **Step 4: Run component tests to verify green**

Run:

```bash
npm test -- src/price/PriceTrendChart.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit component**

Run:

```bash
git add src/price/PriceTrendChart.vue src/price/PriceTrendChart.test.js
git commit -m "feat: add price trend chart component"
```

Expected: commit succeeds.

---

### Task 3: Wire Chart Into Price Page

**Files:**
- Modify: `src/price/App.vue`
- Modify: `src/price/App.test.js`

- [ ] **Step 1: Update Price page test expectations**

In `src/price/App.test.js`, replace old SVG axis assertions:

```js
expect(wrapper.find('[data-testid="trend-x-axis"]').exists()).toBe(true);
expect(wrapper.find('[data-testid="trend-y-axis"]').exists()).toBe(true);
expect(wrapper.find('[data-testid="trend-x-axis-label"]').text()).toBe('时间');
expect(wrapper.find('[data-testid="trend-y-axis-label"]').text()).toBe('价格');
```

with:

```js
expect(wrapper.find('[data-testid="price-trend-chart"]').exists()).toBe(true);
```

Mock `vue-chartjs` at the top of `src/price/App.test.js`:

```js
vi.mock('vue-chartjs', () => ({
  Line: {
    name: 'MockLine',
    props: ['data', 'options'],
    template: '<div data-testid="mock-line-chart" />',
  },
}));
```

- [ ] **Step 2: Run Price page test to verify red**

Run:

```bash
npm test -- src/price/App.test.js
```

Expected: FAIL because `src/price/App.vue` still renders old SVG test IDs and not `price-trend-chart`.

- [ ] **Step 3: Update App.vue imports and remove SVG computations**

In `src/price/App.vue`, add:

```js
import PriceTrendChart from './PriceTrendChart.vue';
```

Remove the complete `trendPoints` computed declaration and the `trendPolyline` computed declaration:

```js
const trendPoints = computed(() => {
  const rows = selectedHistory.value;
  if (rows.length < 2) return [];
  const times = rows.map((row) => new Date(row.observedAt).getTime());
  const prices = rows.map((row) => Number(row.minPrice));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const width = 640;
  const height = 220;
  const padLeft = 54;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 38;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  return rows.map((row, index) => {
    const timeSpan = maxTime - minTime || 1;
    const priceSpan = maxPrice - minPrice || 1;
    const x = padLeft + ((times[index] - minTime) / timeSpan) * plotWidth;
    const y = padTop + plotHeight - ((prices[index] - minPrice) / priceSpan) * plotHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
});

const trendPolyline = computed(() => trendPoints.value.join(' '));
```

- [ ] **Step 4: Replace SVG template with PriceTrendChart**

Replace the existing SVG chart block, starting with `<svg v-if="trendPoints.length" class="trend-chart"` and ending with `</svg>`, with:

```vue
        <PriceTrendChart
          :history="selectedHistory"
          :axis-time-label="t('price.axisTime')"
          :axis-price-label="t('price.axisPrice')"
          :locale="isEnglish ? 'en-US' : 'zh-CN'"
        />
```

- [ ] **Step 5: Run Price page test to verify green**

Run:

```bash
npm test -- src/price/App.test.js src/price/PriceTrendChart.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit integration**

Run:

```bash
git add src/price/App.vue src/price/App.test.js
git commit -m "feat: render price history with chart component"
```

Expected: commit succeeds.

---

### Task 4: Update Styling And Built Price Assets

**Files:**
- Modify: `src/price/price.css`
- Modify: `public/price/**/*`

- [ ] **Step 1: Adjust chart CSS for canvas container**

In `src/price/price.css`, replace SVG-specific `.trend-chart` descendant rules with:

```css
.trend-chart {
  width: 100%;
  height: 240px;
  margin-top: 18px;
}
```

Remove obsolete rules for:

```css
.trend-chart .chart-axis
.trend-chart .chart-axis-label
.trend-chart polyline
.trend-chart circle
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- src/price/App.test.js src/price/PriceTrendChart.test.js
```

Expected: PASS.

- [ ] **Step 3: Build Price assets**

Run:

```bash
npm run build:price
```

Expected: Vite build succeeds and updates `public/price`.

- [ ] **Step 4: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit final assets**

Run:

```bash
git add src/price/price.css public/price package.json package-lock.json
git commit -m "build: update price chart assets"
```

Expected: commit succeeds.
