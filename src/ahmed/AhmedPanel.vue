<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '../shared/i18n.js';
import { LEAVE_TOOLS_EVENT } from '../shared/tools-page-lifecycle.js';

const props = defineProps({
  embedded: { type: Boolean, default: false },
  bootController: { type: Boolean, default: true },
});

const { t } = useI18n();
const rootElement = ref(null);
let cleanupController = null;
let isUnmounted = false;

const inputColumns = [
  [
    {
      titleKey: 'ahmed.sections.global',
      subtitleKey: 'ahmed.sections.globalSub',
      fields: [
        { id: 'total-count', labelKey: 'ahmed.fields.totalCount', mode: 'numeric', placeholderKey: 'ahmed.placeholders.totalCount', required: true },
        { id: 'avg-all', labelKey: 'ahmed.fields.avgAll', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optional' },
        { id: 'total-cells-all', labelKey: 'ahmed.fields.totalCellsAll', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
      ],
    },
    {
      titleKey: 'ahmed.sections.wg',
      subtitleKey: 'ahmed.sections.wgSub',
      separated: true,
      fields: [
        { id: 'avg-wg', labelKey: 'ahmed.fields.avgWg', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optionalCountCells' },
        { id: 'count-wg', labelKey: 'ahmed.fields.countWg', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        { id: 'total-cells-wg', labelKey: 'ahmed.fields.totalCellsWg', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        {
          pair: [
            { id: 'avg-price-wg', labelKey: 'ahmed.fields.avgPriceWg', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optional' },
            { id: 'total-price-wg', labelKey: 'ahmed.fields.totalPriceWg', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
          ],
        },
      ],
    },
    {
      titleKey: 'ahmed.sections.blue',
      subtitleKey: 'ahmed.sections.blueSub',
      separated: true,
      fields: [
        { id: 'avg-blue', labelKey: 'ahmed.fields.avgBlue', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optionalCountCells' },
        { id: 'count-blue', labelKey: 'ahmed.fields.countBlue', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        { id: 'total-cells-blue', labelKey: 'ahmed.fields.totalCellsBlue', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        {
          pair: [
            { id: 'avg-price-blue', labelKey: 'ahmed.fields.avgPriceBlue', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optional' },
            { id: 'total-price-blue', labelKey: 'ahmed.fields.totalPriceBlue', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
          ],
        },
      ],
    },
  ],
  [
    {
      titleKey: 'ahmed.sections.rangeRed',
      subtitleKey: 'ahmed.sections.rangeRedSub',
      fields: [
        {
          pair: [
            { id: 'min-cells-all', labelKey: 'ahmed.fields.minCells', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
            { id: 'max-cells-all', labelKey: 'ahmed.fields.maxCells', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
          ],
        },
        { id: 'count-red', labelKey: 'ahmed.fields.countRed', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        { id: 'avg-red', labelKey: 'ahmed.fields.avgRed', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optional' },
      ],
    },
    {
      titleKey: 'ahmed.sections.purple',
      subtitleKey: 'ahmed.sections.purpleSub',
      separated: true,
      fields: [
        { id: 'avg-purple', labelKey: 'ahmed.fields.avgPurple', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optionalCountCells' },
        { id: 'count-purple', labelKey: 'ahmed.fields.countPurple', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        { id: 'total-cells-purple', labelKey: 'ahmed.fields.totalCellsPurple', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        {
          pair: [
            { id: 'avg-price-purple', labelKey: 'ahmed.fields.avgPricePurple', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optional' },
            { id: 'total-price-purple', labelKey: 'ahmed.fields.totalPricePurple', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
          ],
        },
      ],
    },
    {
      titleKey: 'ahmed.sections.orange',
      subtitleKey: 'ahmed.sections.orangeSub',
      separated: true,
      fields: [
        { id: 'avg-orange', labelKey: 'ahmed.fields.avgOrange', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optionalCountCells' },
        { id: 'count-orange', labelKey: 'ahmed.fields.countOrange', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        { id: 'total-cells-orange', labelKey: 'ahmed.fields.totalCellsOrange', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
        {
          pair: [
            { id: 'avg-price-orange', labelKey: 'ahmed.fields.avgPriceOrange', mode: 'decimal', placeholderKey: 'ahmed.placeholders.optional' },
            { id: 'total-price-orange', labelKey: 'ahmed.fields.totalPriceOrange', mode: 'numeric', placeholderKey: 'ahmed.placeholders.optional' },
          ],
        },
      ],
    },
  ],
];

const knownQualityOptions = [
  { value: '白', labelKey: 'ahmed.quality.white' },
  { value: '绿', labelKey: 'ahmed.quality.green' },
  { value: '蓝', labelKey: 'ahmed.quality.blue' },
  { value: '紫', labelKey: 'ahmed.quality.purple' },
  { value: '金', labelKey: 'ahmed.quality.orangeGold' },
  { value: '红', labelKey: 'ahmed.quality.red' },
];

const resultColumns = [
  'ahmed.columns.wg',
  'ahmed.columns.blue',
  'ahmed.columns.purple',
  'ahmed.columns.orange',
  'ahmed.columns.red',
  'ahmed.columns.noRed',
  'ahmed.columns.redItems',
  'ahmed.columns.totalPrice',
  'ahmed.columns.actions',
];

function getFieldKey(field) {
  return field.id || field.pair.map((item) => item.id).join('-');
}

function resetPanelState() {
  cleanupController?.resetState?.();
  if (!rootElement.value) return;

  rootElement.value.querySelector('#combo-form')?.reset();

  const resultLimitInput = rootElement.value.querySelector('#result-limit');
  if (resultLimitInput) {
    resultLimitInput.value = '100';
  }

  const knownWidthInput = rootElement.value.querySelector('#known-width');
  if (knownWidthInput) {
    knownWidthInput.value = '';
  }

  const knownHeightInput = rootElement.value.querySelector('#known-height');
  if (knownHeightInput) {
    knownHeightInput.value = '';
  }

  const knownItemSearchInput = rootElement.value.querySelector('#known-item-search');
  if (knownItemSearchInput) {
    knownItemSearchInput.value = '';
  }

  const knownItemOptions = rootElement.value.querySelector('#known-item-options');
  if (knownItemOptions) {
    knownItemOptions.innerHTML = '';
  }

  const knownList = rootElement.value.querySelector('#known-list');
  if (knownList) {
    knownList.textContent = t('ahmed.noConstraints');
  }

  const resultMeta = rootElement.value.querySelector('#result-meta');
  if (resultMeta) {
    resultMeta.textContent = t('ahmed.waiting');
  }

  const resultBody = rootElement.value.querySelector('#result-body');
  if (resultBody) {
    resultBody.innerHTML = `<tr><td colspan="9" class="empty">${t('ahmed.noResults')}</td></tr>`;
  }

  const outlineModeButton = rootElement.value.querySelector('[data-known-mode="outline"]');
  const exactModeButton = rootElement.value.querySelector('[data-known-mode="exact"]');
  outlineModeButton?.classList.add('active');
  exactModeButton?.classList.remove('active');

  const knownOutlineForm = rootElement.value.querySelector('#known-outline-form');
  const knownExactForm = rootElement.value.querySelector('#known-exact-form');
  if (knownOutlineForm) {
    knownOutlineForm.hidden = false;
  }
  if (knownExactForm) {
    knownExactForm.hidden = true;
  }

  const detailModal = rootElement.value.querySelector('#detail-modal');
  if (detailModal) {
    detailModal.hidden = true;
  }
}

onMounted(async () => {
  window.addEventListener(LEAVE_TOOLS_EVENT, resetPanelState);
  if (!props.bootController) return;

  await import('../../public/page-state.js');
  const { mountAhmedController } = await import('../../public/ahmed/ahmed.js');

  if (isUnmounted || !rootElement.value) return;

  cleanupController = mountAhmedController(rootElement.value);
});

onBeforeUnmount(() => {
  isUnmounted = true;
  window.removeEventListener(LEAVE_TOOLS_EVENT, resetPanelState);
  cleanupController?.();
  cleanupController = null;
});
</script>

<template>
  <div ref="rootElement" class="ahmed-panel-root" data-testid="ahmed-panel-root">
    <main class="page" :class="{ 'page-embedded': embedded }">
      <section class="heading">
        <div class="mark" aria-hidden="true">A</div>
        <div>
          <h1>{{ t('ahmed.title') }}</h1>
          <p>{{ t('ahmed.subtitle') }}</p>
        </div>
      </section>

      <section class="tool" :aria-label="t('ahmed.toolLabel')">
        <form class="inputs" id="combo-form" autocomplete="off">
          <div
            v-for="(column, columnIndex) in inputColumns"
            :key="`column-${columnIndex}`"
            class="input-column"
          >
            <template v-for="section in column" :key="section.titleKey">
              <div v-if="section.separated" class="quality-separator" aria-hidden="true"></div>
              <div class="group-title">
                <strong>{{ t(section.titleKey) }}</strong>
                <span>{{ t(section.subtitleKey) }}</span>
              </div>

              <template v-for="field in section.fields" :key="getFieldKey(field)">
                <div v-if="field.pair" class="field-pair">
                  <label v-for="pairField in field.pair" :key="pairField.id" class="field">
                    <span>{{ t(pairField.labelKey) }}</span>
                    <input
                      :id="pairField.id"
                      type="text"
                      :inputmode="pairField.mode"
                      :placeholder="t(pairField.placeholderKey)"
                    >
                  </label>
                </div>

                <label v-else class="field">
                  <span>{{ t(field.labelKey) }}</span>
                  <input
                    :id="field.id"
                    type="text"
                    :inputmode="field.mode"
                    :placeholder="t(field.placeholderKey)"
                    :required="field.required || undefined"
                  >
                </label>
              </template>
            </template>
          </div>

          <div class="actions">
            <button type="submit" id="calculate-button" disabled>{{ t('ahmed.calculate') }}</button>
            <button type="button" class="secondary" id="clear-results">{{ t('ahmed.clear') }}</button>
          </div>
        </form>

        <section class="results" aria-live="polite">
          <div class="result-head">
            <div class="result-meta" id="result-meta">{{ t('ahmed.waiting') }}</div>
            <label class="result-limit-field">
              <span>{{ t('ahmed.maxResults') }}</span>
              <input id="result-limit" type="text" inputmode="numeric" value="100">
            </label>
          </div>

          <section class="known-panel" :aria-label="t('ahmed.knownLabel')">
            <div class="known-tools">
              <div class="known-mode">
                <button type="button" class="known-tab active" data-known-mode="outline">{{ t('ahmed.outlineMode') }}</button>
                <button type="button" class="known-tab" data-known-mode="exact">{{ t('ahmed.exactMode') }}</button>
              </div>

              <div class="known-form" id="known-outline-form">
                <label>
                  <span>{{ t('ahmed.quality') }}</span>
                  <select id="known-quality">
                    <option
                      v-for="option in knownQualityOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ t(option.labelKey) }}
                    </option>
                  </select>
                </label>
                <label>
                  <span>{{ t('ahmed.width') }}</span>
                  <input id="known-width" type="text" inputmode="numeric" :placeholder="t('ahmed.integer')">
                </label>
                <label>
                  <span>{{ t('ahmed.height') }}</span>
                  <input id="known-height" type="text" inputmode="numeric" :placeholder="t('ahmed.integer')">
                </label>
                <button type="button" class="mini-button" id="add-outline-constraint">{{ t('ahmed.add') }}</button>
              </div>

              <div class="known-form" id="known-exact-form" hidden>
                <label class="known-search">
                  <span>{{ t('ahmed.item') }}</span>
                  <input id="known-item-search" type="text" :placeholder="t('ahmed.itemSearch')">
                </label>
                <button type="button" class="mini-button" id="add-exact-constraint">{{ t('ahmed.add') }}</button>
                <div class="known-suggestions" id="known-item-options"></div>
              </div>
            </div>
            <div class="known-list" id="known-list">{{ t('ahmed.noConstraints') }}</div>
          </section>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th v-for="column in resultColumns" :key="column">{{ t(column) }}</th>
                </tr>
              </thead>
              <tbody id="result-body">
                <tr>
                  <td colspan="9" class="empty">{{ t('ahmed.noResults') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>

    <div class="modal" id="detail-modal" hidden>
      <div class="modal-backdrop" data-close-detail></div>
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <header class="modal-head">
          <div>
            <h2 id="detail-title">{{ t('ahmed.detailTitle') }}</h2>
            <p id="detail-summary"></p>
          </div>
          <button type="button" class="icon-button" id="close-detail" :aria-label="t('ahmed.close')">×</button>
        </header>
        <div class="detail-body" id="detail-body"></div>
      </section>
    </div>
  </div>
</template>

<style src="./ahmed-panel.css"></style>
