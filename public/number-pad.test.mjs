/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';

function focusIn(target) {
  target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

function clickPadButton(selector) {
  document.querySelector(selector).click();
}

describe('number pad helper', () => {
  it('shows the pad for numeric inputs and edits the active input', async () => {
    document.body.innerHTML = `
      <input id="numeric" inputmode="numeric" value="">
      <input id="decimal" inputmode="decimal" value="">
      <input id="plain" value="">
    `;
    await import('./number-pad.js');

    const numeric = document.querySelector('#numeric');
    const inputEvents = [];
    numeric.addEventListener('input', () => inputEvents.push(numeric.value));

    focusIn(numeric);

    const pad = document.querySelector('.number-pad');
    expect(pad).not.toBeNull();
    expect(pad.hidden).toBe(false);
    expect(numeric.getAttribute('autocomplete')).toBe('off');

    clickPadButton('[data-number-key="1"]');
    clickPadButton('[data-number-key="2"]');
    clickPadButton('[data-number-key="."]');

    expect(numeric.value).toBe('12');
    expect(inputEvents).toEqual(['1', '12']);

    clickPadButton('[data-number-action="backspace"]');
    expect(numeric.value).toBe('1');

    clickPadButton('[data-number-action="clear"]');
    expect(numeric.value).toBe('');

    const decimal = document.querySelector('#decimal');
    focusIn(decimal);
    clickPadButton('[data-number-key="1"]');
    clickPadButton('[data-number-key="."]');
    clickPadButton('[data-number-key="."]');
    clickPadButton('[data-number-key="5"]');

    expect(decimal.value).toBe('1.5');

    const plain = document.querySelector('#plain');
    focusIn(plain);
    expect(document.querySelector('.number-pad').hidden).toBe(true);

    numeric.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(document.querySelector('.number-pad').hidden).toBe(true);

    focusIn(numeric);
    window.dispatchEvent(new Event('blur'));
    expect(document.querySelector('.number-pad').hidden).toBe(true);
  });
});
