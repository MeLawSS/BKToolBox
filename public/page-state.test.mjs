/* @vitest-environment happy-dom */
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';

describe('BidKingPageState', () => {
  beforeAll(async () => {
    await import('./page-state.js');
  });

  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('saves, loads, and clears page state under the page key', () => {
    const state = window.BidKingPageState.create('test-page');

    state.save({ value: 12 });

    expect(state.load()).toMatchObject({ value: 12 });
    expect(state.load().savedAt).toEqual(expect.any(String));

    state.clear();
    expect(state.load()).toBeNull();
  });

  it('returns null for invalid stored JSON', () => {
    window.localStorage.setItem('bidking-page-state:v1:bad-json', '{');

    expect(window.BidKingPageState.create('bad-json').load()).toBeNull();
  });

  it('collects and restores input, select, textarea, checkbox, and radio controls', () => {
    document.body.innerHTML = `
      <input id="name" value="old">
      <input id="enabled" type="checkbox" checked>
      <input name="mode" type="radio" value="a">
      <input name="mode" type="radio" value="b" checked>
      <select id="choice"><option value="one">One</option><option value="two" selected>Two</option></select>
      <textarea id="notes">hello</textarea>
      <input id="ignored" value="skip" disabled>
    `;

    const state = window.BidKingPageState.create('controls');
    const controls = state.collectControls();

    expect(controls).toMatchObject({
      name: { type: 'value', value: 'old' },
      enabled: { type: 'checkbox', checked: true },
      mode: { type: 'radio', value: 'b' },
      choice: { type: 'value', value: 'two' },
      notes: { type: 'value', value: 'hello' },
    });
    expect(controls.ignored).toBeUndefined();

    document.querySelector('#name').value = '';
    document.querySelector('#enabled').checked = false;
    document.querySelector('input[name="mode"][value="a"]').checked = true;
    document.querySelector('#choice').value = 'one';
    document.querySelector('#notes').value = '';

    state.restoreControls(controls);

    expect(document.querySelector('#name').value).toBe('old');
    expect(document.querySelector('#enabled').checked).toBe(true);
    expect(document.querySelector('input[name="mode"][value="b"]').checked).toBe(true);
    expect(document.querySelector('#choice').value).toBe('two');
    expect(document.querySelector('#notes').value).toBe('hello');
  });
});
