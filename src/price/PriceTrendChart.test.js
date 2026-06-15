/* @vitest-environment happy-dom */
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toRaw } from 'vue';
import PriceTrendChart from './PriceTrendChart.vue';

const lineProps = vi.hoisted(() => []);

vi.mock('vue-chartjs', () => ({
  Line: {
    name: 'Line',
    props: {
      data: { type: Object, required: true },
      options: { type: Object, required: true },
    },
    mounted() {
      const data = toRaw(this.data);
      lineProps.push({
        data: {
          labels: [...data.labels],
          datasets: data.datasets.map((dataset) => ({
            ...dataset,
            data: [...dataset.data],
          })),
        },
        options: this.options,
      });
    },
    template: '<div data-testid="mock-line"></div>',
  },
}));

describe('PriceTrendChart', () => {
  beforeEach(() => {
    lineProps.length = 0;
    document.documentElement.style.removeProperty('--primary-strong');
  });

  it('passes formatted labels, prices, and axis titles to the Line chart for valid history', () => {
    mount(PriceTrendChart, {
      props: {
        axisTimeLabel: '时间',
        axisPriceLabel: '价格',
        chartLabel: '历史趋势',
        locale: 'zh-CN',
        history: [
          { observedAt: 'not a date', minPrice: 3900 },
          { observedAt: '2026-05-28T12:10:00.000Z', minPrice: null },
          { observedAt: '2026-05-28T12:15:00.000Z', minPrice: '' },
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: '5000' },
          { observedAt: '2026-05-28T12:40:00.000Z', minPrice: Number.NaN },
        ],
      },
    });

    expect(lineProps).toHaveLength(1);
    expect(lineProps[0].data.datasets[0].data).toEqual([4400, 5000]);
    expect(lineProps[0].data.labels).toHaveLength(2);
    expect(lineProps[0].options.scales.x.title.text).toBe('时间');
    expect(lineProps[0].options.scales.y.title.text).toBe('价格');
    expect(lineProps[0].options.scales.y.ticks.callback(5000)).toBe('5,000');
    expect(lineProps[0].options.plugins.tooltip.callbacks.title([{ dataIndex: 1 }]))
      .toBe(new Date('2026-05-28T12:31:02.000Z').toLocaleString('zh-CN'));
    expect(lineProps[0].options.plugins.tooltip.callbacks.label({ parsed: { y: 5000 } }))
      .toBe('价格: 5,000');
  });

  it('formats axis titles, ticks, and tooltip labels for English locale', () => {
    mount(PriceTrendChart, {
      props: {
        axisTimeLabel: 'Time',
        axisPriceLabel: 'Price',
        chartLabel: 'History Trend',
        locale: 'en-US',
        history: [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
        ],
      },
    });

    expect(lineProps).toHaveLength(1);
    expect(lineProps[0].options.scales.x.title.text).toBe('Time');
    expect(lineProps[0].options.scales.y.title.text).toBe('Price');
    expect(lineProps[0].options.scales.y.ticks.callback(5000)).toBe('5,000');
    expect(lineProps[0].options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]))
      .toBe(new Date('2026-05-28T12:20:00.000Z').toLocaleString('en-US'));
    expect(lineProps[0].options.plugins.tooltip.callbacks.label({ parsed: { y: 5000 } }))
      .toBe('Price: 5,000');
  });

  it('applies alpha to rgb color strings', () => {
    document.documentElement.style.setProperty('--primary-strong', 'rgb(22, 141, 125)');

    mount(PriceTrendChart, {
      props: {
        axisTimeLabel: '时间',
        axisPriceLabel: '价格',
        history: [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
        ],
      },
    });

    expect(lineProps[0].data.datasets[0].backgroundColor).toBe('rgba(22, 141, 125, 0.16)');
  });

  it('labels the chart wrapper for assistive technology', () => {
    const wrapper = mount(PriceTrendChart, {
      props: {
        axisTimeLabel: '时间',
        axisPriceLabel: '价格',
        chartLabel: '历史趋势',
        history: [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 5000 },
        ],
      },
    });

    const chart = wrapper.find('[data-testid="price-trend-chart"]');
    expect(chart.attributes('role')).toBe('img');
    expect(chart.attributes('aria-label')).toBe('历史趋势');
  });

  it('does not render a chart with fewer than two valid points', () => {
    const wrapper = mount(PriceTrendChart, {
      props: {
        axisTimeLabel: '时间',
        axisPriceLabel: '价格',
        history: [
          { observedAt: '2026-05-28T12:20:00.000Z', minPrice: 4400 },
          { observedAt: 'invalid', minPrice: 5000 },
        ],
      },
    });

    expect(wrapper.find('[data-testid="price-trend-chart"]').exists()).toBe(false);
  });
});
