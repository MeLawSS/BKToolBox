function showDesktopNotification(payload = {}, deps = {}) {
  const Notification = deps.Notification;
  if (!Notification || typeof Notification !== 'function') {
    return { ok: true, shown: false, reason: 'unavailable' };
  }
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' };
  }

  const title = String(payload.title || '').trim();
  if (!title) {
    return { ok: false, error: 'missing title' };
  }

  const body = String(payload.body || '');
  const notification = new Notification({ title, body });
  notification.show();
  return { ok: true, shown: true };
}

module.exports = {
  showDesktopNotification,
};
