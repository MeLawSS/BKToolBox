<script setup>
import { useWarehouseBatchOp } from '../useWarehouseBatchOp.js';

defineOptions({ name: 'InjectWarehouseBatchOpPanel' });

const { isRunning, log, clearLog, start, stop } = useWarehouseBatchOp();
</script>

<template>
  <section class="listing-advice-panel">
    <header class="section-head">
      <div>
        <h2>仓库自动排序</h2>
        <p>自动对主仓库和所有物品箱执行排序</p>
      </div>
    </header>

    <div class="controller-command-actions">
      <button
        class="command-button"
        type="button"
        :disabled="isRunning"
        @click="start"
      >
        {{ isRunning ? '运行中…' : '开始' }}
      </button>
      <button
        class="command-button"
        type="button"
        :disabled="!isRunning"
        @click="stop"
      >
        停止
      </button>
      <button
        class="command-button"
        type="button"
        :disabled="isRunning"
        @click="clearLog"
      >
        清空日志
      </button>
    </div>

    <pre class="command-result">
      <template v-if="!log.length">（无日志）</template>
      <span
        v-for="(entry, i) in log"
        :key="i"
        :class="['log-line', `is-${entry.level}`]"
      >{{ entry.time }} {{ entry.message }}{{ '\n' }}</span>
    </pre>
  </section>
</template>

<style scoped>
.command-result {
  max-height: 240px;
  overflow-y: auto;
}
.log-line { display: contents; }
.log-line.is-warn { color: var(--color-warn, #e6a817); }
.log-line.is-error { color: var(--color-error, #e05252); }
</style>
