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
    expect(wrapper.text()).toContain('选择艾莎');

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

  it('dispatches zero-arg operations and shows both the operator label and command id in the latest result header', async () => {
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
    const latestHeader = wrapper.get('[data-testid="meta-operation-latest-command"]').text();
    expect(latestHeader).toContain('前往房间页');
    expect(latestHeader).toContain('GoToBattlePrev');
    expect(
      JSON.parse(wrapper.get('[data-testid="meta-operation-latest-result-payload"]').text()),
    ).toEqual(response);
  });

  it('dispatches the remaining zero-arg meta-operations with empty args', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(vi.fn().mockResolvedValue({ ok: true }));
    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-command-OpenSkillConfig"]').trigger('click');
    await wrapper.get('[data-testid="meta-operation-command-StartAction"]').trigger('click');
    await wrapper.get('[data-testid="meta-operation-command-GetBidState"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(1, 'GetAutoCollectCabinetRewardState', {});
    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(2, 'OpenSkillConfig', {});
    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(3, 'StartAction', {});
    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(4, 'GetBidState', {});
  });

  it('loads auto collect scheduler state on mount and renders the enabled status', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: true,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: 3600000,
            lastCheckAtUnixMs: 0,
            lastResultCode: 'never_run',
            lastResultMessage: '',
            lastObservedScreen: '',
          },
        }),
    );

    const wrapper = await mountPanel();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetAutoCollectCabinetRewardState', {});
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-toggle"]').element.checked).toBe(
      true,
    );
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-status"]').text()).toContain(
      '未运行',
    );
  });

  it('toggles the scheduler through the existing command bridge and respects the shared lock', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: true,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: 1000,
            lastCheckAtUnixMs: 0,
            lastResultCode: 'never_run',
            lastResultMessage: '',
            lastObservedScreen: '',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: false,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: null,
            lastCheckAtUnixMs: 1710000000123,
            lastResultCode: 'never_run',
            lastResultMessage: '',
            lastObservedScreen: '',
          },
        }),
    );

    const wrapper = await mountPanel();
    const toggle = wrapper.get('[data-testid="meta-operation-auto-collect-toggle"]');

    await toggle.setValue(false);
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(
      2,
      'SetAutoCollectCabinetRewardEnabled',
      { enabled: false },
    );
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-status"]').text()).toContain(
      '已关闭',
    );

    wrapper.unmount();
    const lockedWrapper = await mountPanel({ commandLoading: 'CollectCabinetReward' });
    expect(
      lockedWrapper.get('[data-testid="meta-operation-auto-collect-toggle"]').element.disabled,
    ).toBe(true);
  });

  it('retries loading auto collect scheduler state after the shared command lock is released', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn().mockResolvedValue({
        ok: true,
        value: {
          enabled: false,
          running: false,
          intervalMs: 10800000,
          nextCheckInMs: null,
          lastCheckAtUnixMs: 1710000000123,
          lastResultCode: 'disabled',
          lastResultMessage: 'disabled by user',
          lastObservedScreen: 'main_lobby',
        },
      }),
    );

    const wrapper = await mountPanel({ commandLoading: 'CollectCabinetReward' });

    expect(runAutoOperationCommand).not.toHaveBeenCalled();

    await wrapper.setProps({ commandLoading: '' });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetAutoCollectCabinetRewardState', {});
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-status"]').text()).toContain(
      '已关闭',
    );
  });

  it('retries loading auto collect scheduler state after an empty or failed probe response', async () => {
    const runAutoOperationCommand = setupConnectedDesktop(
      vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error('probe failed'))
        .mockResolvedValueOnce({
          ok: true,
          value: {
            enabled: true,
            running: false,
            intervalMs: 10800000,
            nextCheckInMs: 3600000,
            lastCheckAtUnixMs: 0,
            lastResultCode: 'never_run',
            lastResultMessage: '',
            lastObservedScreen: '',
          },
        }),
    );

    const wrapper = await mountPanel();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(1, 'GetAutoCollectCabinetRewardState', {});
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-status"]').text()).toContain(
      '未运行',
    );

    await wrapper.setProps({ commandLoading: 'CollectCabinetReward' });
    await flushPromises();
    await nextTick();
    await wrapper.setProps({ commandLoading: '' });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(2, 'GetAutoCollectCabinetRewardState', {});

    await wrapper.setProps({ commandLoading: 'PlaceBid' });
    await flushPromises();
    await nextTick();
    await wrapper.setProps({ commandLoading: '' });
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenNthCalledWith(3, 'GetAutoCollectCabinetRewardState', {});
    expect(wrapper.get('[data-testid="meta-operation-auto-collect-toggle"]').element.checked).toBe(
      true,
    );
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

  it('shows the error banner for resolved native failures and preserves the raw resolved error payload', async () => {
    const response = {
      ok: false,
      error: 'native command rejected',
      code: 'E_NATIVE',
    };
    const runAutoOperationCommand = setupConnectedDesktop(vi.fn().mockResolvedValue(response));

    const wrapper = await mountPanel();

    await wrapper.get('[data-testid="meta-operation-command-SelectRole"]').trigger('click');
    await flushPromises();
    await nextTick();

    expect(runAutoOperationCommand).toHaveBeenCalledWith('SelectRole', {});
    const latestHeader = wrapper.get('[data-testid="meta-operation-latest-command"]').text();
    expect(latestHeader).toContain('选择艾莎');
    expect(latestHeader).toContain('SelectRole');
    expect(wrapper.get('[data-testid="meta-operation-error"]').text()).toContain(
      'native command rejected',
    );
    expect(
      JSON.parse(wrapper.get('[data-testid="meta-operation-latest-result-payload"]').text()),
    ).toEqual(response);
  });
});
