/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset, getState, init, resetTimer, setEnabled } from './inject-scheduler.js';

const ONE_HOUR = 60 * 60 * 1000;

let mockRun;

beforeEach(() => {
  vi.useFakeTimers();
  mockRun = vi.fn().mockResolvedValue({ ok: true });
  init(mockRun);
});

afterEach(() => {
  _reset();
  vi.useRealTimers();
});

describe('inject-scheduler', () => {
  it('is disabled by default', () => {
    expect(getState()).toEqual({ enabled: false, nextRunAt: null });
  });

  it('setEnabled(true) enables and notifies, then schedules after immediate run', async () => {
    const notify = vi.fn();
    setEnabled(true, notify);

    expect(getState().enabled).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));

    // after immediate run completes, nextRunAt is set
    await vi.advanceTimersByTimeAsync(0);
    expect(getState().nextRunAt).toBeGreaterThan(Date.now());
  });

  it('setEnabled(false) cancels timer and notifies', () => {
    const notify = vi.fn();
    setEnabled(true, notify);
    notify.mockClear();

    setEnabled(false, notify);

    expect(getState()).toEqual({ enabled: false, nextRunAt: null });
    expect(notify).toHaveBeenCalledWith({ enabled: false, nextRunAt: null });
  });

  it('runs injection immediately on enable', async () => {
    setEnabled(true, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('does not start duplicate runs or timers when enabled twice while running', async () => {
    const pendingRuns = [];
    mockRun.mockImplementation(() => new Promise(resolve => pendingRuns.push(resolve)));
    init(mockRun);

    setEnabled(true, vi.fn());
    setEnabled(true, vi.fn());

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(pendingRuns).toHaveLength(1);

    pendingRuns[0]({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(1);
  });

  it('schedules next run 1 hour after initial fire', async () => {
    setEnabled(true, vi.fn());
    await vi.advanceTimersByTimeAsync(0); // immediate run
    const { nextRunAt } = getState();
    expect(nextRunAt).toBeGreaterThan(Date.now());
  });

  it('fires again after 1 hour (second total run)', async () => {
    setEnabled(true, vi.fn());
    await vi.advanceTimersByTimeAsync(ONE_HOUR);
    expect(mockRun).toHaveBeenCalledTimes(2); // immediate + 1h
  });

  it('resetTimer restarts 1-hour countdown from now', async () => {
    const notify = vi.fn();
    setEnabled(true, notify);
    await vi.advanceTimersByTimeAsync(0); // let immediate run + scheduleNext finish
    const first = getState().nextRunAt;

    vi.advanceTimersByTime(30 * 60 * 1000);
    notify.mockClear();
    resetTimer(notify);

    expect(getState().nextRunAt).toBeGreaterThan(first);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('resetTimer does nothing when disabled', () => {
    const notify = vi.fn();
    resetTimer(notify);
    expect(notify).not.toHaveBeenCalled();
    expect(getState().nextRunAt).toBeNull();
  });

  it('notifies with new nextRunAt after timer fires and reschedules', async () => {
    const notify = vi.fn();
    setEnabled(true, notify);
    notify.mockClear();
    await vi.advanceTimersByTimeAsync(ONE_HOUR);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, nextRunAt: expect.any(Number) }),
    );
  });
});
