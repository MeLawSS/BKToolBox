/* @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';

describe('theme helper', () => {
  it('applies stored theme state and toggles through the theme button', async () => {
    const mediaListeners = [];
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (event, handler) => {
        if (event === 'change') mediaListeners.push(handler);
      },
    }));
    window.localStorage.setItem('bidking-theme', 'light');
    document.body.innerHTML = `
      <button type="button" data-theme-toggle aria-label="切换主题">
        <span class="theme-toggle-icon"></span>
      </button>
    `;

    await import('./theme.js');

    const button = document.querySelector('[data-theme-toggle]');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('light');
    expect(button.classList.contains('is-light')).toBe(true);
    expect(button.dataset.nextTheme).toBe('dark');
    expect(button.querySelector('.theme-toggle-icon').textContent).toBe('☀');
    expect(document.documentElement.dataset.themeSwitching).toBeUndefined();

    button.click();

    expect(window.localStorage.getItem('bidking-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeSwitching).toBe('true');
    expect(button.classList.contains('is-light')).toBe(false);
    expect(button.dataset.nextTheme).toBe('light');
    expect(button.querySelector('.theme-toggle-icon').textContent).toBe('☾');
  });
});
