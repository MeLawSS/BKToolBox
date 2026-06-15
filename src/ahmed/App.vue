<script setup>
import AhmedPanel from './AhmedPanel.vue';
import TopBar from '../shared/TopBar.vue';

defineProps({
  bootController: {
    type: Boolean,
    default: true,
  },
});
</script>

<template>
  <TopBar />
  <AhmedPanel :boot-controller="bootController" />
</template>
