import { computed, onMounted, onUnmounted, ref } from 'vue';

export function useInjectionSchedule() {
  const scheduleEnabled = ref(false);

  const canSchedule = computed(() =>
    Boolean(
      window.bidkingDesktop?.isDesktop &&
      typeof window.bidkingDesktop?.setScheduleEnabled === 'function',
    ),
  );

  let removeListener = null;

  onMounted(async () => {
    if (!canSchedule.value) return;

    try {
      const state = await window.bidkingDesktop.getScheduleState?.();
      scheduleEnabled.value = state?.enabled ?? false;
    } catch (_) {}

    removeListener = window.bidkingDesktop.onScheduleState?.(state => {
      scheduleEnabled.value = state?.enabled ?? false;
    }) ?? null;
  });

  onUnmounted(() => {
    removeListener?.();
  });

  async function toggleSchedule() {
    const next = !scheduleEnabled.value;
    scheduleEnabled.value = next;
    try {
      await window.bidkingDesktop?.setScheduleEnabled?.(next);
    } catch (_) {}
  }

  return { scheduleEnabled, canSchedule, toggleSchedule };
}
