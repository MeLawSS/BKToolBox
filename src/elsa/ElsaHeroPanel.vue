<script setup>
import HeroEstimatorPanel from '../hero-estimator/HeroEstimatorPanel.vue';
import ElsaAutoOperationPanel from './ElsaAutoOperationPanel.vue';
import { elsaProfile } from '../hero-estimator/hero-profiles.js';
</script>

<template>
  <HeroEstimatorPanel :profile="elsaProfile" embedded>
    <template #before-monitor>
      <ElsaAutoOperationPanel />
    </template>
  </HeroEstimatorPanel>
</template>
