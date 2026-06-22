function raiseAndFocusWindow(targetWindow) {
  if (!targetWindow) {
    return;
  }

  if (typeof targetWindow.isMinimized === 'function' && targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  targetWindow.show?.();
  targetWindow.setAlwaysOnTop?.(true, 'screen-saver');
  targetWindow.focus?.();
  targetWindow.moveTop?.();
  targetWindow.setAlwaysOnTop?.(false);
}

module.exports = {
  raiseAndFocusWindow,
};
