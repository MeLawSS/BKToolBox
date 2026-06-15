/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ListingModal from './ListingModal.vue';
import realCollectibles from '../../public/data/collectibles.json';

function getCollectibleCid(collectible) {
  const explicitCid = collectible?.itemCid ?? collectible?.cid ?? collectible?.id;
  if (explicitCid !== undefined && explicitCid !== null && explicitCid !== '') return Number(explicitCid);
  const match = String(collectible?.image || '').match(/icon_(\d+)\.png/);
  return match ? Number(match[1]) : null;
}

const realItem = realCollectibles.find((item) => getCollectibleCid(item) === 1022002);

function mockBridge(handlers = {}) {
  const runAutoOperationCommand = vi.fn(async (command, args) => {
    if (command === 'GetItemTradeInfo') {
      return handlers.tradeInfo
        ? handlers.tradeInfo(args)
        : { ok: true, value: { itemCid: args.itemCid, minPrice: 1600, totalCount: 7, tiers: [{ price: 1600, count: 2 }, { price: 1700, count: 5 }] } };
    }
    if (command === 'ExchangeItem') {
      return handlers.exchange ? handlers.exchange(args) : { ok: true, value: {} };
    }
    throw new Error(`unexpected command: ${command}`);
  });
  window.bidkingDesktop = { isDesktop: true, runAutoOperationCommand };
  return runAutoOperationCommand;
}

async function mountModal(props = {}) {
  const wrapper = mount(ListingModal, {
    attachTo: document.body,
    props: {
      itemCid: 1022002,
      name: realItem.name,
      quality: realItem.quality,
      ownedCount: 12,
      defaultPricePercent: 98,
      ...props,
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('ListingModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.bidkingDesktop;
  });

  afterEach(() => {
    delete window.bidkingDesktop;
  });

  it('fetches trade info on open, renders the ladder, and defaults the unit price from the configured percentage', async () => {
    const run = mockBridge();
    const wrapper = await mountModal({ defaultPricePercent: 98.5 });

    expect(run).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1022002 });
    const tiersText = wrapper.find('[data-testid="listing-tiers"]').text();
    expect(tiersText).toContain('1600');
    expect(tiersText).toContain('1700');
    expect(wrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1576');
    expect(wrapper.find('[data-testid="listing-count"]').element.value).toBe('12');
  });

  it('floors the computed default at 1 and leaves it blank when there are no listings', async () => {
    mockBridge({ tradeInfo: () => ({ ok: true, value: { minPrice: 8, totalCount: 1, tiers: [{ price: 8, count: 1 }] } }) });
    const lowWrapper = await mountModal({ defaultPricePercent: 1 });
    expect(lowWrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('1');

    document.body.innerHTML = '';
    mockBridge({ tradeInfo: () => ({ ok: true, value: { minPrice: 0, totalCount: 0, tiers: [] } }) });
    const emptyWrapper = await mountModal();
    expect(emptyWrapper.find('[data-testid="listing-unit-price"]').element.value).toBe('');
    expect(emptyWrapper.find('[data-testid="listing-tiers"]').text()).toContain('当前无挂单');
  });

  it('shows the live total and disables confirm when the count exceeds the owned amount', async () => {
    mockBridge();
    const wrapper = await mountModal();

    expect(wrapper.find('[data-testid="listing-total"]').text()).toContain('18,816');

    await wrapper.find('[data-testid="listing-count"]').setValue('13');
    await nextTick();
    expect(wrapper.find('[data-testid="listing-confirm"]').attributes('disabled')).toBeDefined();
  });

  it('lists with the entered count and unit price, then emits listed', async () => {
    const run = mockBridge();
    const wrapper = await mountModal();

    await wrapper.find('[data-testid="listing-unit-price"]').setValue('1590');
    await wrapper.find('[data-testid="listing-count"]').setValue('3');
    await nextTick();
    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(run).toHaveBeenCalledWith('ExchangeItem', { itemCid: 1022002, count: 3, unitPrice: 1590 });
    expect(wrapper.emitted('listed')?.[0]?.[0]).toEqual({ itemCid: 1022002, count: 3, unitPrice: 1590 });
  });

  it('shows an error and stays open when listing fails', async () => {
    mockBridge({ exchange: () => ({ ok: false, error: '余额不足' }) });
    const wrapper = await mountModal();

    await wrapper.find('[data-testid="listing-confirm"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="listing-submit-error"]').text()).toContain('余额不足');
    expect(wrapper.emitted('listed')).toBeUndefined();
    expect(wrapper.find('[data-testid="listing-modal"]').exists()).toBe(true);
  });

  it('shows a load error when fetching trade info fails', async () => {
    mockBridge({ tradeInfo: () => ({ ok: false, error: '行情服务不可用' }) });
    const wrapper = await mountModal();
    expect(wrapper.find('[data-testid="listing-load-error"]').text()).toContain('行情服务不可用');
  });

  it('uses the price theme dialog and action classes', async () => {
    mockBridge();
    const wrapper = await mountModal();

    expect(wrapper.find('[data-testid="listing-modal"]').classes()).toContain('listing-overlay');
    expect(wrapper.find('.listing-dialog').classes()).toContain('themed-dialog');
    expect(wrapper.find('[data-testid="listing-cancel"]').classes()).toContain('ghost-button');
    expect(wrapper.find('[data-testid="listing-confirm"]').classes()).toContain('primary-button');
  });
});
