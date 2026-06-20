/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { showDesktopNotification } from './desktop-notification.js';

describe('desktop notification', () => {
  it('shows a notification when the environment supports it', () => {
    const show = vi.fn();
    class FakeNotification {
      static isSupported() {
        return true;
      }

      constructor(options) {
        this.options = options;
      }

      show() {
        show(this.options);
      }
    }

    expect(showDesktopNotification(
      { title: 'BKToolBox', body: '需要验证' },
      { Notification: FakeNotification },
    )).toEqual({ ok: true, shown: true });
    expect(show).toHaveBeenCalledWith({ title: 'BKToolBox', body: '需要验证' });
  });

  it('returns a skipped result when notifications are unavailable', () => {
    class FakeNotification {
      static isSupported() {
        return false;
      }
    }

    expect(showDesktopNotification(
      { title: 'BKToolBox', body: '需要验证' },
      { Notification: FakeNotification },
    )).toEqual({ ok: true, shown: false, reason: 'unsupported' });
  });

  it('returns an error result when the title is missing', () => {
    class FakeNotification {
      static isSupported() {
        return true;
      }

      show() {}
    }

    expect(showDesktopNotification(
      { title: '   ', body: '需要验证' },
      { Notification: FakeNotification },
    )).toEqual({ ok: false, error: 'missing title' });
  });

  it('returns an unavailable result when Notification is null', () => {
    expect(showDesktopNotification(
      { title: 'BKToolBox', body: '需要验证' },
      { Notification: null },
    )).toEqual({ ok: true, shown: false, reason: 'unavailable' });
  });
});
