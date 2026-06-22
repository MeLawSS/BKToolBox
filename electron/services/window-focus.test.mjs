import { describe, expect, it, vi } from 'vitest';
import { raiseAndFocusWindow } from './window-focus.js';

function createWindowStub({ minimized = false } = {}) {
  return {
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    moveTop: vi.fn(),
    setAlwaysOnTop: vi.fn(),
  };
}

describe('raiseAndFocusWindow', () => {
  it('restores a minimized window and uses temporary always-on-top to raise it above other apps', () => {
    const window = createWindowStub({ minimized: true });

    raiseAndFocusWindow(window);

    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true, 'screen-saver');
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.moveTop).toHaveBeenCalledTimes(1);
    expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false);
  });

  it('still raises a non-minimized window without restoring it', () => {
    const window = createWindowStub({ minimized: false });

    raiseAndFocusWindow(window);

    expect(window.restore).not.toHaveBeenCalled();
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.moveTop).toHaveBeenCalledTimes(1);
    expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true, 'screen-saver');
    expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false);
  });
});
