const selection = document.getElementById('selection');
const hint = document.getElementById('hint');

let dragStart = null;
let latestRect = null;

function normalizeRect(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { left, top, width, height };
}

function renderSelection(rect) {
  if (!rect || rect.width < 1 || rect.height < 1) {
    selection.hidden = true;
    return;
  }

  selection.hidden = false;
  selection.style.left = `${rect.left}px`;
  selection.style.top = `${rect.top}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}

function finishSelection() {
  if (!latestRect || latestRect.width < 4 || latestRect.height < 4) {
    return;
  }

  window.regionSelector.completeSelection(latestRect);
}

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  dragStart = { x: event.clientX, y: event.clientY };
  latestRect = { left: dragStart.x, top: dragStart.y, width: 0, height: 0 };
  renderSelection(latestRect);
  hint.textContent = '松开鼠标完成截图，按 Esc 取消';
});

window.addEventListener('pointermove', (event) => {
  if (!dragStart) {
    return;
  }

  latestRect = normalizeRect(dragStart, { x: event.clientX, y: event.clientY });
  renderSelection(latestRect);
});

window.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !dragStart) {
    return;
  }

  latestRect = normalizeRect(dragStart, { x: event.clientX, y: event.clientY });
  dragStart = null;
  renderSelection(latestRect);
  finishSelection();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  event.preventDefault();
  window.regionSelector.cancelSelection('escape');
});
