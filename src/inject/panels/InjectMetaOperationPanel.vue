<script setup>
import { useI18n } from '../../shared/i18n.js';

defineOptions({ name: 'InjectMetaOperationPanel' });

defineProps({
  commandLoading: {
    type: String,
    default: '',
  },
});

defineEmits(['command-loading-change']);

const { t } = useI18n();
</script>

<template>
  <section class="listing-advice-panel" data-testid="meta-operation-panel">
    <header class="section-head">
      <div>
        <h2 data-testid="meta-operation-title">{{ t('inject.metaOperationTitle') }}</h2>
        <p>{{ t('inject.metaOperationSubtitle') }}</p>
      </div>
    </header>

    <div class="command-grid">
      <button
        class="command-button"
        type="button"
        disabled
        data-testid="meta-operation-command-GoToBattlePrev"
      >
        {{ t('inject.metaOperationGoToBattlePrev') }}
      </button>
    </div>
  </section>
</template>
