(function () {
  const numericSelector = 'input[inputmode="numeric"], input[inputmode="decimal"], input[data-number-pad]';
  let activeInput = null;
  let hideTimer = null;
  let pad = null;

  function disableInputHistory(input) {
    if (!(input instanceof HTMLInputElement)) return;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
  }

  function disableAllInputHistory() {
    document.querySelectorAll('input').forEach(disableInputHistory);
  }

  function isNumericInput(target) {
    return target instanceof HTMLInputElement && target.matches(numericSelector);
  }

  function ensurePad() {
    if (pad) return pad;

    pad = document.createElement('div');
    pad.className = 'number-pad';
    pad.hidden = true;
    pad.innerHTML = `
      <button type="button" data-number-key="7">7</button>
      <button type="button" data-number-key="8">8</button>
      <button type="button" data-number-key="9">9</button>
      <button type="button" data-number-action="backspace">⌫</button>
      <button type="button" data-number-key="4">4</button>
      <button type="button" data-number-key="5">5</button>
      <button type="button" data-number-key="6">6</button>
      <button type="button" data-number-action="clear">清空</button>
      <button type="button" data-number-key="1">1</button>
      <button type="button" data-number-key="2">2</button>
      <button type="button" data-number-key="3">3</button>
      <button type="button" data-number-action="done">完成</button>
      <button type="button" data-number-key="0" class="wide">0</button>
      <button type="button" data-number-key=".">.</button>
    `;

    pad.addEventListener('pointerdown', event => {
      event.preventDefault();
    });

    pad.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !activeInput) return;

      if (button.dataset.numberKey !== undefined) {
        insertText(button.dataset.numberKey);
        return;
      }

      if (button.dataset.numberAction === 'backspace') {
        backspace();
      } else if (button.dataset.numberAction === 'clear') {
        setValue('');
      } else if (button.dataset.numberAction === 'done') {
        activeInput.blur();
        hidePad();
      }
    });

    document.body.appendChild(pad);
    return pad;
  }

  function dispatchInput() {
    if (!activeInput) return;
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setValue(value) {
    if (!activeInput) return;
    activeInput.value = value;
    activeInput.setSelectionRange(value.length, value.length);
    dispatchInput();
  }

  function insertText(text) {
    if (!activeInput) return;
    if (text === '.' && activeInput.inputMode !== 'decimal' && activeInput.dataset.numberPad !== 'decimal') return;
    if (text === '.' && activeInput.value.includes('.')) return;

    const start = activeInput.selectionStart ?? activeInput.value.length;
    const end = activeInput.selectionEnd ?? activeInput.value.length;
    const next = `${activeInput.value.slice(0, start)}${text}${activeInput.value.slice(end)}`;
    activeInput.value = next;
    const cursor = start + text.length;
    activeInput.setSelectionRange(cursor, cursor);
    dispatchInput();
  }

  function backspace() {
    if (!activeInput) return;
    const value = activeInput.value;
    const start = activeInput.selectionStart ?? value.length;
    const end = activeInput.selectionEnd ?? value.length;

    if (start !== end) {
      const next = `${value.slice(0, start)}${value.slice(end)}`;
      activeInput.value = next;
      activeInput.setSelectionRange(start, start);
      dispatchInput();
      return;
    }

    if (start === 0) return;
    const next = `${value.slice(0, start - 1)}${value.slice(start)}`;
    activeInput.value = next;
    activeInput.setSelectionRange(start - 1, start - 1);
    dispatchInput();
  }

  function positionPad() {
    if (!activeInput || !pad || pad.hidden) return;

    const rect = activeInput.getBoundingClientRect();
    const gap = 8;
    const padRect = pad.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredTop = rect.bottom + gap;
    const fallbackTop = rect.top - padRect.height - gap;
    const top = preferredTop + padRect.height <= viewportHeight
      ? preferredTop
      : Math.max(gap, fallbackTop);
    const left = Math.min(
      Math.max(gap, rect.left),
      Math.max(gap, viewportWidth - padRect.width - gap)
    );

    pad.style.left = `${left}px`;
    pad.style.top = `${top}px`;
  }

  function showPad(input) {
    clearTimeout(hideTimer);
    hidePad();
    activeInput = input;
    ensurePad();
    pad.style.display = 'grid';
    pad.style.gridAutoFlow = 'row';
    pad.style.gridTemplateColumns = 'repeat(4, 48px)';
    pad.style.width = '228px';
    pad.style.minWidth = '228px';
    pad.style.maxWidth = '228px';
    pad.hidden = false;
    pad.classList.toggle('decimal', input.inputMode === 'decimal' || input.dataset.numberPad === 'decimal');
    positionPad();
  }

  function hidePad() {
    if (!pad) return;
    pad.hidden = true;
    pad.style.display = 'none';
    pad.style.removeProperty('left');
    pad.style.removeProperty('top');
    pad.style.removeProperty('width');
    pad.style.removeProperty('min-width');
    pad.style.removeProperty('max-width');
    activeInput = null;
  }

  document.addEventListener('focusin', event => {
    if (event.target instanceof HTMLInputElement) {
      disableInputHistory(event.target);
    }

    if (!isNumericInput(event.target)) {
      hidePad();
      return;
    }

    if (isNumericInput(event.target)) {
      showPad(event.target);
    }
  });

  document.addEventListener('focusout', event => {
    clearTimeout(hideTimer);
    hidePad();
  });

  window.addEventListener('blur', () => {
    hidePad();
  });

  window.addEventListener('resize', positionPad);
  window.addEventListener('scroll', positionPad, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', disableAllInputHistory);
  } else {
    disableAllInputHistory();
  }
}());
