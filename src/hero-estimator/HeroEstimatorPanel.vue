<script setup>
import HeroEstimatorPanelBody from './HeroEstimatorPanelBody.vue';

defineProps({
  profile: { type: Object, required: true },
  activePage: { type: String, default: '' },
  embedded: { type: Boolean, default: false },
});
</script>

<template>
  <HeroEstimatorPanelBody
    :key="profile.id"
    :profile="profile"
    :active-page="activePage"
    :embedded="embedded"
  >
    <template #before-monitor>
      <slot name="before-monitor" />
    </template>
  </HeroEstimatorPanelBody>
</template>
