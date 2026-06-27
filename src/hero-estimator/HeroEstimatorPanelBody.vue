<script setup>
import { computed, reactive } from 'vue';
import TopBar from '../shared/TopBar.vue';
import { useHeroEstimatorPanel } from './useHeroEstimatorPanel.js';

const props = defineProps({
  profile: { type: Object, required: true },
  activePage: { type: String, default: '' },
  embedded: { type: Boolean, default: false },
});

const panel = reactive(useHeroEstimatorPanel(props.profile));
const panelMark = computed(() => props.profile.mark ?? String(props.profile.id ?? 'E').slice(0, 1).toUpperCase());
const titleKey = computed(() => props.profile.titleKey);
const subtitleKey = computed(() => props.profile.subtitleKey);
const toolLabelKey = computed(() => props.profile.toolLabelKey);
const inputSubtitleKey = computed(() => props.profile.inputSubtitleKey);
const usesLegacyDomIds = computed(() => props.profile.id === 'ethan' && !props.embedded);
const showsElsaTotalPriceFields = computed(() => props.embedded && props.profile.id === 'elsa');
const rootClass = computed(() => [
  'hero-estimator-panel',
  `hero-estimator-${props.profile.id}`,
  { 'is-embedded': props.embedded },
]);

function domId(base) {
  return usesLegacyDomIds.value ? base : `${props.profile.id}-${base}`;
}

function showsGroupTotalPriceField(groupKey) {
  return showsElsaTotalPriceFields.value && props.profile.totalPriceGroupKeys?.includes(groupKey);
}
</script>

<template>
  <div :class="rootClass">
    <TopBar v-if="!props.embedded" :active-page="props.activePage" />

    <main class="page" :class="{ 'page-embedded': props.embedded }">
      <section class="heading">
        <div class="mark" aria-hidden="true">{{ panelMark }}</div>
        <div>
          <h1>{{ panel.t(titleKey) }}</h1>
          <p>{{ panel.t(subtitleKey) }}</p>
        </div>
      </section>

      <section class="tool" :aria-label="panel.t(toolLabelKey)">
        <form class="inputs" :id="domId('estimate-form')" autocomplete="off" @submit.prevent="panel.handleSubmit">
          <div class="group-title">
            <strong>{{ panel.t(props.profile.globalSectionTitleKey) }}</strong>
            <span>{{ panel.t(inputSubtitleKey) }}</span>
          </div>

          <div class="field-pair">
            <label class="field">
              <span>{{ panel.t(panel.globalFields[0].labelKey) }}</span>
              <select
                v-if="panel.usesTotalCellSelect"
                :id="domId(panel.globalFields[0].id)"
                v-model="panel.selectedTotalCellsValue"
              >
                <option value="">{{ panel.t(panel.heroKey('optional')) }}</option>
                <option
                  v-for="option in panel.totalCellOptions"
                  :key="option.cells"
                  :value="String(option.cells)"
                >
                  {{ panel.t(panel.heroKey('totalCellOption'), { cells: option.cells, count: option.count }) }}
                </option>
              </select>
              <input
                v-else
                :id="domId(panel.globalFields[0].id)"
                v-model="panel.totalCellsInputValue"
                type="text"
                :inputmode="panel.globalFields[0].mode"
                :placeholder="panel.totalCellsPlaceholder"
              >
            </label>
            <label class="field">
              <span>{{ panel.t(panel.globalFields[1].labelKey) }}</span>
              <span class="input-help-row">
                <input
                  :id="domId(panel.globalFields[1].id)"
                  v-model="panel.globalInputs.totalAverage"
                  type="text"
                  :inputmode="panel.globalFields[1].mode"
                  :placeholder="panel.totalAveragePlaceholder"
                  @blur="panel.handleTotalAverageBlur"
                >
                <span class="help-tip">
                  <button
                    type="button"
                    class="help-button"
                    :aria-label="panel.t(panel.heroKey('helpAria'))"
                    :aria-describedby="domId('total-average-help')"
                  >
                    ?
                  </button>
                  <span :id="domId('total-average-help')" class="help-popover" role="tooltip">
                    {{ panel.t(panel.heroKey('totalAverageHelp')) }}
                  </span>
                </span>
              </span>
            </label>
          </div>

          <div class="quality-grid" :id="domId('quality-grid')">
            <section v-for="group in panel.groups" :key="group.key" class="quality-block">
              <div class="quality-head">
                <strong>{{ panel.t(group.labelKey) }}</strong>
                <span>{{ panel.t(group.qualitiesKey) }}</span>
              </div>
              <div class="quality-inputs">
                <label v-for="field in panel.qualityFields" :key="field.key" class="quality-field">
                  <span>{{ panel.t(group.labelKey) }}{{ panel.t(field.suffixKey) }}</span>
                  <input
                    :id="domId(`${field.prefix}-${group.key}`)"
                    v-model="panel.groupInputs[group.key][field.key]"
                    type="text"
                    :inputmode="field.mode"
                    :placeholder="panel.groupPlaceholders[group.key][field.key] || panel.t(panel.heroKey('optional'))"
                  >
                </label>
                <label v-if="showsGroupTotalPriceField(group.key)" class="quality-field">
                  <span>{{ panel.t(panel.heroKey('fields.totalPrice')) }}</span>
                  <input
                    :id="domId(`total-price-${group.key}`)"
                    v-model="panel.groupInputs[group.key].totalPrice"
                    type="text"
                    inputmode="numeric"
                    :placeholder="panel.groupPlaceholders[group.key].totalPrice || panel.t(panel.heroKey('optional'))"
                  >
                </label>
              </div>
            </section>
          </div>

          <div class="actions">
            <button type="submit" :id="domId('calculate-button')" :disabled="panel.isLoading">{{ panel.t(panel.heroKey('estimate')) }}</button>
            <button type="button" :id="domId('reload-button')" :disabled="panel.isLoading" @click="panel.loadData(panel.t(panel.heroKey('meta.dataReloading')))">
              {{ panel.t(panel.heroKey('reload')) }}
            </button>
            <button type="button" :id="domId('clear-button')" @click="panel.handleClear">{{ panel.t(panel.heroKey('clear')) }}</button>
          </div>
        </form>

        <section class="results" aria-live="polite">
          <header class="results-head">
            <div>
              <h2>{{ panel.t(panel.heroKey('resultsTitle')) }}</h2>
              <p :id="domId('result-meta')" :class="panel.metaStatus">{{ panel.metaText }}</p>
            </div>
          </header>

          <div class="summary-grid">
            <div v-for="card in panel.summaryCards" :key="card.id" class="summary-card">
              <span>{{ card.label }}</span>
              <strong :id="domId(card.id)">{{ card.value }}</strong>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th v-for="column in panel.resultColumns" :key="column.key">{{ panel.t(column.labelKey) }}</th>
                </tr>
              </thead>
              <tbody :id="domId('result-body')">
                <tr v-if="panel.tableRows.length === 0">
                  <td colspan="8" class="empty">{{ panel.metaStatus === 'status-error' ? panel.t(panel.heroKey('cannotEstimate')) : panel.t(panel.heroKey('noResults')) }}</td>
                </tr>
                <tr v-for="(row, index) in panel.tableRows" v-else :key="`${row.label}-${index}`">
                  <td>{{ row.label }}</td>
                  <td>{{ row.count ?? '-' }}</td>
                  <td>{{ row.cells ?? '-' }}</td>
                  <td>{{ panel.formatAverage(row.avg) }}</td>
                  <td class="price-cell">{{ panel.formatMoney(row.low) }}</td>
                  <td class="price-cell">{{ panel.formatMoney(row.mean) }}</td>
                  <td class="price-cell">{{ panel.formatMoney(row.high) }}</td>
                  <td :class="row.statusClass">
                    <span>{{ row.status }}</span>
                    <span
                      v-for="tag in row.tags ?? []"
                      :key="tag"
                      class="result-tag"
                    >
                      {{ tag }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <slot name="before-monitor" />

      <section v-if="props.profile.supportsMonitor" class="live-monitor-panel" :aria-label="panel.t(panel.heroKey('monitor.boardAria'))">
        <header class="live-monitor-head">
          <div>
            <h2>{{ panel.t(panel.heroKey('monitor.boardTitle')) }}</h2>
          </div>
          <div class="live-monitor-status">
            <span class="status-dot" :class="{ live: panel.monitorStatus.running }"></span>
            <span>{{ panel.monitorStatusText }}</span>
          </div>
        </header>

        <div class="live-monitor-meta">
          <p v-if="panel.monitorGridState?.revealedTypes?.length" :id="props.profile.monitorIds.types">
            <strong>{{ panel.t(panel.heroKey('monitor.revealedTypes')) }}</strong>
            <span>{{ panel.monitorGridState.revealedTypes.join(' / ') }}</span>
          </p>
          <p v-if="panel.monitorGridState?.gameUid" class="monitor-game-id">{{ panel.t(panel.heroKey('monitor.gameUid'), { uid: panel.monitorGridState.gameUid }) }}</p>
          <p v-if="panel.monitorMinimumOccupied" :id="props.profile.monitorIds.minimum" class="monitor-minimum">
            <strong>{{ panel.t(panel.heroKey('monitor.minimumOccupied')) }}</strong>
            <span>{{ panel.monitorMinimumOccupied.minTotalCells }}</span>
            <span>{{ panel.t(panel.heroKey('monitor.minimumDetail'), {
              count: panel.monitorMinimumOccupied.order.length,
              holes: panel.monitorMinimumOccupied.holeCells.length,
            }) }}</span>
          </p>
          <p v-if="panel.monitorErrorText" class="monitor-error">{{ panel.monitorErrorText }}</p>
          <ul v-if="panel.monitorGridState?.warnings?.length" class="monitor-warnings">
            <li v-for="warning in panel.monitorGridState.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>

        <div class="monitor-board-wrap">
          <div :id="props.profile.monitorIds.board" class="monitor-board" :aria-label="panel.t(panel.heroKey('monitor.boardAria'))">
            <div
              v-for="cell in panel.monitorCells"
              :key="cell.id"
              class="monitor-board-cell"
              :class="panel.monitorCellClassMap.get(cell.id)"
              :style="{
                gridColumn: String(cell.column),
                gridRow: String(cell.row),
              }"
            >
              {{ panel.monitorCellClassMap.has(cell.id) ? '' : cell.id }}
            </div>
            <div
              v-for="outline in panel.monitorGridState?.outlines ?? []"
              :key="`${outline.boxId}-${outline.label}`"
              class="monitor-outline"
              :class="{
                [panel.getMonitorOutlineQualityClass(outline)]: true,
              }"
              :data-outline-box="outline.boxId"
              :data-outline-size="outline.label"
              :data-outline-quality="outline.qualityName"
              :data-outline-price="outline.price ?? undefined"
              role="button"
              tabindex="0"
              :style="{
                gridColumn: `${outline.column} / span ${outline.width}`,
                gridRow: `${outline.row} / span ${outline.height}`,
              }"
              @click="panel.openMonitorOutlineDetail(outline)"
              @keydown.enter.prevent="panel.openMonitorOutlineDetail(outline)"
              @keydown.space.prevent="panel.openMonitorOutlineDetail(outline)"
            >
              <span v-if="panel.formatMonitorOutlineValue(outline)">{{ panel.formatMonitorOutlineValue(outline) }}</span>
            </div>
          </div>
        </div>
      </section>

      <div
        v-if="panel.monitorOutlineDetail"
        class="monitor-outline-detail-backdrop"
        @click.self="panel.closeMonitorOutlineDetail"
      >
        <section
          :id="domId('monitor-outline-detail')"
          class="monitor-outline-detail"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="domId('monitor-outline-detail-title')"
        >
          <header>
            <div>
              <h2 :id="domId('monitor-outline-detail-title')">{{ panel.t(panel.heroKey('monitor.detailTitle')) }}</h2>
              <p>
                {{ panel.monitorOutlineDetail.outline.qualityName || panel.t(panel.heroKey('monitor.unknownQuality')) }}
                · {{ panel.monitorOutlineDetail.outline.label }}
                · {{ panel.t(panel.heroKey('monitor.detailCell'), { boxId: panel.monitorOutlineDetail.outline.boxId }) }}
              </p>
            </div>
            <button type="button" class="detail-close" @click="panel.closeMonitorOutlineDetail">{{ panel.t(panel.heroKey('monitor.close')) }}</button>
          </header>

          <div v-if="panel.monitorOutlineDetail.exactPrice !== undefined" class="outline-stat-grid">
            <div><span>{{ panel.t(panel.heroKey('monitor.exactPrice')) }}</span><strong>{{ panel.formatMoney(panel.monitorOutlineDetail.exactPrice) }}</strong></div>
          </div>
          <div v-else-if="panel.monitorOutlineDetail.stats" class="outline-stat-grid">
            <div><span>{{ panel.t(panel.heroKey('monitor.candidateCount')) }}</span><strong>{{ panel.monitorOutlineDetail.stats.count }}</strong></div>
            <div><span>{{ panel.t(panel.heroKey('monitor.median')) }}</span><strong>{{ panel.formatMoney(panel.monitorOutlineDetail.stats.median) }}</strong></div>
            <div><span>{{ panel.t(panel.heroKey('monitor.mean')) }}</span><strong>{{ panel.formatMoney(panel.monitorOutlineDetail.stats.mean) }}</strong></div>
            <div><span>{{ panel.t(panel.heroKey('monitor.min')) }}</span><strong>{{ panel.formatMoney(panel.monitorOutlineDetail.stats.min) }}</strong></div>
            <div><span>{{ panel.t(panel.heroKey('monitor.max')) }}</span><strong>{{ panel.formatMoney(panel.monitorOutlineDetail.stats.max) }}</strong></div>
            <div><span>{{ panel.t(panel.heroKey('monitor.p25p75')) }}</span><strong>{{ panel.formatMoney(panel.monitorOutlineDetail.stats.p25) }} / {{ panel.formatMoney(panel.monitorOutlineDetail.stats.p75) }}</strong></div>
          </div>
          <p v-else class="outline-detail-empty">{{ panel.t(panel.heroKey('monitor.noCandidates')) }}</p>

          <div v-if="panel.monitorOutlineDetail.candidates.length" class="outline-candidate-wrap">
            <table class="outline-candidate-table">
              <thead>
                <tr>
                  <th>{{ panel.t(panel.heroKey('monitor.columns.item')) }}</th>
                  <th>{{ panel.t(panel.heroKey('monitor.columns.type')) }}</th>
                  <th>{{ panel.t(panel.heroKey('monitor.columns.price')) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="candidate in panel.monitorOutlineDetail.candidates"
                  :key="`${candidate.name}-${candidate.price}`"
                >
                  <td>{{ candidate.name }}</td>
                  <td>{{ candidate.type }}</td>
                  <td>{{ panel.formatMoney(candidate.price) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
