<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../shared/i18n.js';
import {
  addDraftCollectible,
  buildSavedListSnapshotItems,
  filterCollectiblesForDraftSearch,
} from './stock-move-saved-list-draft.js';

const props = defineProps({
  collectibles: {
    type: Array,
    default: () => [],
  },
  initialDraftItems: {
    type: Array,
    default: () => [],
  },
  currentSelectedItems: {
    type: Array,
    default: () => [],
  },
  initialName: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['close', 'saved']);

const { t } = useI18n();

const nameInput = ref(props.initialName);
const searchQuery = ref('');
const draftItems = ref(Array.isArray(props.initialDraftItems) ? [...props.initialDraftItems] : []);
const saveError = ref('');
const isSaving = ref(false);

const searchResults = computed(() => filterCollectiblesForDraftSearch(props.collectibles, searchQuery.value));
const canSave = computed(() => Boolean(nameInput.value.trim() && draftItems.value.length && !isSaving.value));

function getItemCid(collectible) {
  const value = Number(collectible?.itemCid ?? collectible?.cid);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function addCollectible(collectible) {
  draftItems.value = addDraftCollectible(draftItems.value, collectible);
}

function importCurrentSelectedItems() {
  let nextDraftItems = draftItems.value;
  for (const collectible of props.currentSelectedItems || []) {
    nextDraftItems = addDraftCollectible(nextDraftItems, collectible);
  }
  draftItems.value = nextDraftItems;
}

function removeDraftCollectible(itemCid) {
  draftItems.value = draftItems.value.filter((item) => getItemCid(item) !== itemCid);
}

async function save() {
  if (!canSave.value) return;

  const bridge = window.bidkingDesktop;
  if (!bridge?.isDesktop || typeof bridge.saveStockMoveList !== 'function') {
    saveError.value = t('inject.failed');
    return;
  }

  const items = buildSavedListSnapshotItems(draftItems.value);
  const payload = {
    name: nameInput.value.trim(),
    itemCids: items.map((item) => item.itemCid),
    items,
  };

  isSaving.value = true;
  saveError.value = '';

  try {
    const response = await bridge.saveStockMoveList(payload);
    if (response?.ok === false) {
      throw new Error(response.error || t('inject.failed'));
    }
    emit('saved', payload);
  } catch (error) {
    saveError.value = error?.message || t('inject.failed');
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div
    class="listing-overlay stock-move-list-editor-overlay"
    data-testid="stock-move-list-editor-modal"
    @click.self="emit('close')"
  >
    <div
      class="listing-dialog themed-dialog stock-move-list-editor-dialog"
      data-testid="stock-move-list-editor-dialog"
    >
      <header class="stock-move-list-editor-header">
        <div>
          <h3>{{ t('inject.stockMoveListEditorTitle') }}</h3>
          <p>{{ t('inject.stockMoveListEditorSubtitle') }}</p>
        </div>
      </header>

      <label class="stock-move-list-editor-field">
        <span>{{ t('inject.stockMoveSavedListName') }}</span>
        <input
          v-model="nameInput"
          type="text"
          :placeholder="t('inject.stockMoveSavedListNamePlaceholder')"
          data-testid="stock-move-list-editor-name"
        >
      </label>

      <section class="stock-move-list-editor-section">
        <div class="stock-move-list-editor-section-head">
          <h4 data-testid="stock-move-list-editor-search-title">{{ t('inject.stockMoveListEditorSearchTitle') }}</h4>
        </div>
        <input
          v-model="searchQuery"
          class="stock-move-list-editor-search"
          type="search"
          :placeholder="t('inject.stockMoveSearchAllCollectibles')"
          data-testid="stock-move-list-editor-search"
        >
        <div class="stock-move-list-editor-results">
          <button
            v-for="collectible in searchResults"
            :key="getItemCid(collectible) || collectible.name"
            class="stock-move-list-editor-result"
            type="button"
            :data-testid="`stock-move-list-editor-add-${getItemCid(collectible)}`"
            :title="t('inject.stockMoveAddCollectible')"
            @click="addCollectible(collectible)"
          >
            <strong>{{ collectible.name || t('inject.stockMoveUnknownItem') }}</strong>
            <span>{{ getItemCid(collectible) }} · {{ collectible.quality || '-' }} · {{ collectible.type || '-' }}</span>
          </button>
        </div>
      </section>

      <section class="stock-move-list-editor-section">
        <div class="stock-move-list-editor-section-head">
          <h4>{{ t('inject.stockMoveDraftTitle') }}</h4>
          <button
            class="command-button"
            type="button"
            data-testid="stock-move-list-editor-import-current"
            @click="importCurrentSelectedItems"
          >
            {{ t('inject.stockMoveImportSelected') }}
          </button>
        </div>

        <p
          v-if="!draftItems.length"
          class="empty-cell stock-move-list-editor-empty"
          data-testid="stock-move-list-editor-empty"
        >
          {{ t('inject.stockMoveDraftEmpty') }}
        </p>

        <div v-else class="stock-move-list-editor-draft-list">
          <article
            v-for="collectible in draftItems"
            :key="getItemCid(collectible)"
            class="stock-move-list-editor-draft-item"
            :data-testid="`stock-move-list-editor-draft-item-${getItemCid(collectible)}`"
          >
            <div>
              <strong>{{ collectible.name || t('inject.stockMoveUnknownItem') }}</strong>
              <p>{{ getItemCid(collectible) }} · {{ collectible.quality || '-' }} · {{ collectible.type || '-' }}</p>
            </div>
            <button
              class="ghost-button danger-button"
              type="button"
              :data-testid="`stock-move-list-editor-remove-${getItemCid(collectible)}`"
              :title="t('inject.stockMoveRemoveCollectible')"
              @click="removeDraftCollectible(getItemCid(collectible))"
            >
              {{ t('inject.stockMoveRemoveCollectible') }}
            </button>
          </article>
        </div>
      </section>

      <p v-if="saveError" class="status-text is-error" data-testid="stock-move-list-editor-error">
        {{ saveError }}
      </p>

      <footer class="stock-move-list-editor-footer">
        <button
          class="ghost-button"
          type="button"
          data-testid="stock-move-list-editor-cancel"
          @click="emit('close')"
        >
          {{ t('inject.stockMoveCancelDraft') }}
        </button>
        <button
          class="primary-button"
          type="button"
          data-testid="stock-move-list-editor-save"
          :disabled="!canSave"
          @click="save"
        >
          {{ isSaving ? t('inject.stockMoveListEditorSaving') : t('inject.stockMoveSaveDraft') }}
        </button>
      </footer>
    </div>
  </div>
</template>
