/* @vitest-environment happy-dom */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import InjectMetaOperationPanel from './InjectMetaOperationPanel.vue';
import {
  __resetAutoOperationAgentSwitchRuntimeForTest,
  AGENT_CONNECTED_STORAGE_KEY,
} from '../../shared/useAutoOperationAgentSwitch.js';

const ROOM_OPTIONS = [
  { value: '101', label: '快递盲盒堆' },
  { value: '102', label: '废弃仓库' },
  { value: '103', label: '航运集装箱' },
  { value: '104', label: '空置别墅' },
  { value: '105', label: '沉船密封仓' },
  { value: '106', label: '隐秘拍卖会' },
  { value: '304', label: '幽静别墅' },
  { value: '305', label: '深海沉船' },
];

async function mountPanel(props = {}) {
  const wrapper = mount(InjectMetaOperationPanel, {
    attachTo: document.body,
    props,
  });

  await flushPromises();
  await nextTick();
  return wrapper;
}

function setupConnectedDesktop(runAutoOperationCommand = vi.fn().mockResolvedValue({ ok: true })) {
  window.sessionStorage.setItem(AGENT_CONNECTED_STORAGE_KEY, 'true');
  window.bidkingDesktop = {
    isDesktop: true,
    startAutoOperationAgent: vi.fn(),
    runAutoOperationCommand,
  };
  return runAutoOperationCommand;
}

describe('InjectMetaOperationPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    __resetAutoOperationAgentSwitchRuntimeForTest();
    window.sessionStorage.clear();
    delete window.bidkingDesktop;
    vi.restoreAllMocks();
  });

  it('renders all seven actions, Chinese room names, default selected room 101, and the empty latest-result placeholder', async () => {
    setupConnectedDesktop();

    const wrapper = await mountPanel();

    expect(wrapper.get('[data-testid="meta-operation-command-GoToBattlePrev"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-EnterRoom"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-OpenSkillConfig"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-SelectRole"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-StartAction"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-GetBidState"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-PlaceBid"]').exists()).toBe(true);

    const roomSelect = wrapper.get('[data-testid="meta-operation-room-select"]');
    expect(roomSelect.element.value).toBe('101');
    expect(
      roomSelect
        .findAll('option')
        .map((option) => ({
          value: option.element.value,
          label: option.text(),
        })),
    ).toEqual(ROOM_OPTIONS);
    expect(roomSelect.text()).toContain('快递盲盒堆');
    expect(roomSelect.text()).toContain('深海沉船');
    expect(roomSelect.text()).not.toContain('101 快递盲盒堆');

    expect(wrapper.get('[data-testid="meta-operation-latest-result-empty"]').text()).toContain('尚无结果');
  });

  it('dispatches EnterRoom with a numeric roomId after selecting room 102', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn().mockResolvedValue({ ok: true, entered: true, roomId: 102 }),
    );

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-room-select"]').setValue('102');
    await wrapper.get('[data-testid="meta-operation-command-EnterRoom"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('EnterRoom', { roomId: 102 });
  });

  it('dispatches zero-arg operations and preserves a clicked:false payload in the latest result JSON', async () => {
    const response = {
      ok: true,
      clicked: false,
      reason: 'Auction scene not ready',
    };
    const runAutoOperationCommand = setupConnectedDesktop(vi.fn().mockResolvedValue(response));

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-command-GoToBattlePrev"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GoToBattlePrev', {});
    expect(wrapper.get('[data-testid="meta-operation-latest-command"]').text()).toContain(
      'GoToBattlePrev',
    );
    expect(
      JSON.parse(wrapper.get('[data-testid="meta-operation-latest-result-payload"]').text()),
    ).toEqual(response);
  });

  it('disables the actions and room select when transport is not ready or the shared lock is held', async () => {
    let wrapper = await mountPanel();

    expect(wrapper.get('[data-testid="meta-operation-room-select"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-EnterRoom"]').element.disabled).toBe(
      true,
    );
    expect(
      wrapper.get('[data-testid="meta-operation-command-GoToBattlePrev"]').element.disabled,
    ).toBe(true);

    wrapper.unmount();
    setupConnectedDesktop();

    wrapper = await mountPanel({ commandLoading: 'Shared command lock' });

    expect(wrapper.get('[data-testid="meta-operation-room-select"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="meta-operation-command-EnterRoom"]').element.disabled).toBe(
      true,
    );
    expect(wrapper.get('[data-testid="meta-operation-command-PlaceBid"]').element.disabled).toBe(
      true,
    );
  });

  it('emits the shared lock on bridge errors and writes a synthetic latest-result payload', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn().mockRejectedValue(new Error('bridge exploded')),
    );

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-command-PlaceBid"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('PlaceBid', {});
    expect(wrapper.emitted('command-loading-change').slice(-2)).toEqual([['PlaceBid'], ['']]);
    expect(wrapper.get('[data-testid="meta-operation-error"]').text()).toContain('bridge exploded');
    expect(
      JSON.parse(wrapper.get('[data-testid="meta-operation-latest-result-payload"]').text()),
    ).toEqual({
      ok: false,
      error: 'bridge exploded',
    });
  });
});
