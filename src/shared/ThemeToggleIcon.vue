<script setup>
defineProps({
  theme: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <span class="theme-toggle-icon">
    <svg
      v-if="theme === 'light'"
      data-theme-icon="sun"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
    <svg
      v-else
      data-theme-icon="moon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20.8 14.6A8.5 8.5 0 0 1 9.4 3.2a7 7 0 1 0 11.4 11.4Z"></path>
    </svg>
  </span>
</template>
