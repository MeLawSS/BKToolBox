export const LEAVE_INJECT_EVENT = 'bidking:leave-inject';

export function dispatchLeaveInjectEvent(target = window) {
  if (!target || typeof target.dispatchEvent !== 'function') return;
  target.dispatchEvent(new CustomEvent(LEAVE_INJECT_EVENT));
}
