import { computed, ref } from 'vue';
import { computeDefaultUnitPrice } from './listing-form.js';

export function useWarehouseAutoSeller({
  warehouseItems,
  listingDefaultPricePercent,
  refreshWarehouseSnapshot,
  runAutoOperationCommand,
}) {
  const phase = ref('idle');
  const currentItemCid = ref(null);
  const currentItemName = ref('');
  const successCount = ref(0);
  const skippedCount = ref(0);
  const lastError = ref('');
  const stopRequested = ref(false);

  let _terminalSkipCids = new Set();
  let _inDllCall = false;

  const isActive = computed(() =>
    ['running', 'retry_wait', 'refreshing_exchange', 'stopping'].includes(phase.value),
  );

  function stop() {
    if (!isActive.value) return;
    stopRequested.value = true;
    if (_inDllCall) phase.value = 'stopping';
  }

  function _checkStop() {
    if (!stopRequested.value) return false;
    phase.value = 'stopped';
    return true;
  }

  async function _bridge(command, args) {
    _inDllCall = true;
    try {
      return await runAutoOperationCommand(command, args ?? {});
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      _inDllCall = false;
    }
  }

  async function _snapshot() {
    _inDllCall = true;
    try {
      return await refreshWarehouseSnapshot();
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      _inDllCall = false;
    }
  }

  async function _cancelableSleep(ms) {
    let remaining = ms;
    while (remaining > 0) {
      if (stopRequested.value) return false;
      // eslint-disable-next-line no-await-in-loop
      const step = Math.min(50, remaining);
      await new Promise((resolve) => { setTimeout(resolve, step); });
      remaining -= step;
    }
    return !stopRequested.value;
  }

  function _getNextCandidate() {
    return warehouseItems.value.find((item) => !_terminalSkipCids.has(item.itemCid)) ?? null;
  }

  async function _handleNonRecoverableSkip(item) {
    skippedCount.value++;
    _terminalSkipCids.add(item.itemCid);
    const snap = await _snapshot();
    if (_checkStop()) return 'stop';
    if (!snap.ok) {
      lastError.value = snap.error ?? 'Warehouse refresh failed';
      return 'failed';
    }
    return 'skipped';
  }

  async function _processItem(item) {
    for (;;) {
      if (_checkStop()) return 'stop';

      currentItemCid.value = item.itemCid;
      currentItemName.value = item.name ?? String(item.itemCid);
      phase.value = 'running';

      const tradeResp = await _bridge('GetItemTradeInfo', { itemCid: item.itemCid });
      if (_checkStop()) return 'stop';

      if (!tradeResp || tradeResp.ok === false) {
        lastError.value = tradeResp?.error ?? 'GetItemTradeInfo failed';
        return _handleNonRecoverableSkip(item);
      }

      const minPrice = Number(tradeResp.value?.minPrice);
      if (!Number.isFinite(minPrice) || minPrice <= 0) {
        lastError.value = 'Invalid minPrice from GetItemTradeInfo';
        return _handleNonRecoverableSkip(item);
      }

      const listPrice = computeDefaultUnitPrice(minPrice, listingDefaultPricePercent.value);
      if (listPrice === null) {
        lastError.value = 'Price calculation failed';
        return _handleNonRecoverableSkip(item);
      }

      const basePrice = Number(item.basePrice);
      if (Number.isFinite(basePrice) && basePrice > 0 && listPrice < basePrice) {
        lastError.value = `List price ${listPrice} below base price ${basePrice}`;
        return _handleNonRecoverableSkip(item);
      }

      const exchResp = await _bridge('ExchangeItem', {
        itemCid: item.itemCid,
        count: item.count,
        unitPrice: listPrice,
      });
      if (_checkStop()) return 'stop';

      if (!exchResp || exchResp.ok !== false) {
        return 'success';
      }

      const errMsg = String(exchResp?.error ?? '');

      if (errMsg === 'ExchangeItem returned false') {
        phase.value = 'retry_wait';
        const sleptOk = await _cancelableSleep(10000);
        if (!sleptOk) { phase.value = 'stopped'; return 'stop'; }

        phase.value = 'refreshing_exchange';
        const refreshResp = await _bridge('RefreshExchangeSellSlots', {});
        if (_checkStop()) return 'stop';

        if (!refreshResp || refreshResp.ok === false) {
          lastError.value = refreshResp?.error ?? 'RefreshExchangeSellSlots failed';
          return 'failed';
        }
        continue; // retry current item
      }

      lastError.value = errMsg || 'ExchangeItem failed';
      return _handleNonRecoverableSkip(item);
    }
  }

  async function start() {
    if (isActive.value) return;

    phase.value = 'running';
    stopRequested.value = false;
    _terminalSkipCids = new Set();
    currentItemCid.value = null;
    currentItemName.value = '';
    successCount.value = 0;
    skippedCount.value = 0;
    lastError.value = '';

    const snap = await _snapshot();
    if (_checkStop()) return;
    if (!snap.ok) {
      lastError.value = snap.error ?? 'Failed to load warehouse';
      phase.value = 'failed';
      return;
    }

    for (;;) {
      if (_checkStop()) return;

      const candidate = _getNextCandidate();
      if (!candidate) {
        phase.value = 'completed';
        return;
      }

      const outcome = await _processItem(candidate);

      if (outcome === 'stop') return;
      if (outcome === 'failed') { phase.value = 'failed'; return; }

      if (outcome === 'success') {
        successCount.value++;
        const snapAfter = await _snapshot();
        if (_checkStop()) return;
        if (!snapAfter.ok) {
          lastError.value = snapAfter.error ?? 'Warehouse refresh failed after success';
          phase.value = 'failed';
          return;
        }
        const slept = await _cancelableSleep(1500);
        if (!slept) { phase.value = 'stopped'; return; }
      }
      // 'skipped': continue to next candidate immediately
    }
  }

  return {
    phase,
    currentItemCid,
    currentItemName,
    successCount,
    skippedCount,
    lastError,
    isActive,
    start,
    stop,
  };
}
