/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import realCollectibles from '../../public/data/collectibles.json';
import StockMoveListEditorModal from './StockMoveListEditorModal.vue';

function getCollectibleCid(collectible) {
  const explicitCid = collectible?.itemCid ?? collectible?.cid ?? collectible?.id;
  if (explicitCid !== undefined && explicitCid !== null && explicitCid !== '') return Number(explicitCid);
  const match = String(collectible?.image || '').match(/icon_(\d+)\.png/);
  return match ? Number(match[1]) : null;
}

function findCollectible(itemCid) {
  const collectible = realCollectibles.find((item) => getCollectibleCid(item) === itemCid);
  if (!collectible) throw new Error(`missing collectible fixture for itemCid ${itemCid}`);
  return collectible;
}

const dataCable = findCollectible(1011001);
const glucoseMeter = findCollectible(1022002);
const boots = findCollectible(1032006);
const vehiclePart = findCollectible(1083009);

async function mountModal(props = {}) {
  const wrapper = mount(StockMoveListEditorModal, {
    attachTo: document.body,
    props: {
      collectibles: [dataCable, glucoseMeter, boots, vehiclePart],
      initialDraftItems: [boots],
      currentSelectedItems: [boots],
      initialName: '现有清单',
      ...props,
    },
  });
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe('StockMoveListEditorModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.bidkingDesktop = {
      isDesktop: true,
      saveStockMoveList: vi.fn(async (payload) => ({ ok: true, value: payload })),
    };
  });

  afterEach(() => {
    delete window.bidkingDesktop;
  });

  it('searches the full collectibles catalog and deduplicates repeated adds into the draft', async () => {
    const wrapper = await mountModal({
      initialDraftItems: [boots],
    });

    expect(wrapper.find(`[data-testid="stock-move-list-editor-draft-item-${getCollectibleCid(vehiclePart)}"]`).exists())
      .toBe(false);

    await wrapper.find('[data-testid="stock-move-list-editor-search"]').setValue(vehiclePart.name);
    await nextTick();

    const addButton = wrapper.get(`[data-testid="stock-move-list-editor-add-${getCollectibleCid(vehiclePart)}"]`);
    await addButton.trigger('click');
    await addButton.trigger('click');
    await flushPromises();
    await nextTick();

    const rows = wrapper.findAll('[data-testid^="stock-move-list-editor-draft-item-"]');
    expect(rows).toHaveLength(2);
    expect(wrapper.get(`[data-testid="stock-move-list-editor-draft-item-${getCollectibleCid(vehiclePart)}"]`).text())
      .toContain(vehiclePart.name);
  });

  it('imports the current source-stock selection into the existing draft without clearing entries', async () => {
    const wrapper = await mountModal({
      initialDraftItems: [vehiclePart],
      currentSelectedItems: [dataCable, boots],
    });

    await wrapper.get('[data-testid="stock-move-list-editor-import-current"]').trigger('click');
    await flushPromises();
    await nextTick();

    const draftCids = wrapper
      .findAll('[data-testid^="stock-move-list-editor-draft-item-"]')
      .map((node) => Number(node.attributes('data-testid').replace('stock-move-list-editor-draft-item-', '')));
    expect(draftCids).toEqual([vehiclePart.itemCid, dataCable.itemCid, boots.itemCid]);
  });

  it('removes draft collectibles', async () => {
    const wrapper = await mountModal({
      initialDraftItems: [dataCable, boots],
    });

    await wrapper.get(`[data-testid="stock-move-list-editor-remove-${getCollectibleCid(boots)}"]`).trigger('click');
    await nextTick();

    expect(wrapper.find(`[data-testid="stock-move-list-editor-draft-item-${getCollectibleCid(boots)}"]`).exists())
      .toBe(false);
    expect(wrapper.findAll('[data-testid^="stock-move-list-editor-draft-item-"]')).toHaveLength(1);
  });

  it('saves through the desktop bridge with snapshot items and emits saved', async () => {
    const saveStockMoveList = vi.fn(async (payload) => ({ ok: true, value: payload }));
    window.bidkingDesktop = {
      isDesktop: true,
      saveStockMoveList,
    };
    const wrapper = await mountModal({
      initialDraftItems: [boots, vehiclePart],
      initialName: '运输件',
    });

    await wrapper.get('[data-testid="stock-move-list-editor-name"]').setValue('新清单');
    await nextTick();
    await wrapper.get('[data-testid="stock-move-list-editor-save"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(saveStockMoveList).toHaveBeenCalledWith({
      name: '新清单',
      itemCids: [boots.itemCid, vehiclePart.itemCid],
      items: [
        {
          itemCid: boots.itemCid,
          name: boots.name,
          quality: boots.quality,
          type: boots.type,
          sizeKey: boots.size.key,
        },
        {
          itemCid: vehiclePart.itemCid,
          name: vehiclePart.name,
          quality: vehiclePart.quality,
          type: vehiclePart.type,
          sizeKey: vehiclePart.size.key,
        },
      ],
    });
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual({
      name: '新清单',
      itemCids: [boots.itemCid, vehiclePart.itemCid],
      items: [
        {
          itemCid: boots.itemCid,
          name: boots.name,
          quality: boots.quality,
          type: boots.type,
          sizeKey: boots.size.key,
        },
        {
          itemCid: vehiclePart.itemCid,
          name: vehiclePart.name,
          quality: vehiclePart.quality,
          type: vehiclePart.type,
          sizeKey: vehiclePart.size.key,
        },
      ],
    });
  });

  it('emits close when the overlay itself or cancel button is clicked', async () => {
    const wrapper = await mountModal();

    await wrapper.get('[data-testid="stock-move-list-editor-modal"]').trigger('click');
    await wrapper.get('[data-testid="stock-move-list-editor-cancel"]').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(2);
  });

  it('uses dialog-style classes on the modal root and dialog while keeping inject-local classes', async () => {
    const wrapper = await mountModal();

    expect(wrapper.get('[data-testid="stock-move-list-editor-modal"]').classes())
      .toContain('listing-overlay');
    expect(wrapper.get('[data-testid="stock-move-list-editor-modal"]').classes())
      .toContain('stock-move-list-editor-overlay');
    expect(wrapper.get('[data-testid="stock-move-list-editor-dialog"]').classes())
      .toContain('listing-dialog');
    expect(wrapper.get('[data-testid="stock-move-list-editor-dialog"]').classes())
      .toContain('themed-dialog');
    expect(wrapper.get('[data-testid="stock-move-list-editor-dialog"]').classes())
      .toContain('stock-move-list-editor-dialog');
    expect(wrapper.get('[data-testid="stock-move-list-editor-search-title"]').text()).toBe('搜索藏品');
    expect(wrapper.get('[data-testid="stock-move-list-editor-search"]').attributes('placeholder'))
      .toBe('按名称 / CID / 品质 / 类型搜索全部藏品');
  });

  it('shows an error when save is unavailable in the current environment', async () => {
    delete window.bidkingDesktop;
    const wrapper = await mountModal({
      initialDraftItems: [boots],
      initialName: '新清单',
    });

    await wrapper.get('[data-testid="stock-move-list-editor-save"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="stock-move-list-editor-error"]').text()).toBe('获取失败');
    expect(wrapper.emitted('saved')).toBeFalsy();
  });

  it('shows an error when the desktop bridge rejects the save request', async () => {
    window.bidkingDesktop = {
      isDesktop: true,
      saveStockMoveList: vi.fn(async () => ({ ok: false, error: 'save failed' })),
    };
    const wrapper = await mountModal({
      initialDraftItems: [boots],
      initialName: '新清单',
    });

    await wrapper.get('[data-testid="stock-move-list-editor-save"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="stock-move-list-editor-error"]').text()).toBe('save failed');
    expect(wrapper.emitted('saved')).toBeFalsy();
  });
});
