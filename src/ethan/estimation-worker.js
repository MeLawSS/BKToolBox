import {
  appendStreamRunSource,
  calculateEstimationResult,
  createStreamRun,
  finishStreamRun,
  runPriceMatchPhase,
} from './estimation-worker-core.js';

const activeStreamRuns = new Map();

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type === 'start-stream-run') {
    activeStreamRuns.set(message.runId, createStreamRun(message));
    return;
  }

  if (message?.type === 'append-source') {
    const streamRun = activeStreamRuns.get(message.runId);
    if (!streamRun) return;
    try {
      const rows = appendStreamRunSource(streamRun, message.text);
      rows.forEach((row, index) => {
        self.postMessage({
          type: 'stream-row',
          runId: message.runId,
          streamMode: streamRun.streamMode,
          groupKey: streamRun.config.groupKey,
          count: streamRun.rows.length - rows.length + index + 1,
          row,
        });
      });
    } catch (error) {
      activeStreamRuns.delete(message.runId);
      self.postMessage({
        type: 'error',
        runId: message.runId,
        error: error?.message || String(error),
      });
      self.postMessage({ type: 'done', runId: message.runId });
    }
    return;
  }

  if (message?.type === 'finish-stream-run') {
    const streamRun = activeStreamRuns.get(message.runId);
    if (!streamRun) return;
    try {
      const result = finishStreamRun(streamRun, message.reason);
      if (result.finalRow) {
        self.postMessage({
          type: 'stream-row',
          runId: message.runId,
          streamMode: streamRun.streamMode,
          groupKey: streamRun.config.groupKey,
          count: streamRun.rows.length,
          row: result.finalRow,
        });
      }
      self.postMessage({
        type: 'stream-complete',
        runId: message.runId,
        ...result,
      });
      self.postMessage({ type: 'done', runId: message.runId });
    } catch (error) {
      activeStreamRuns.delete(message.runId);
      self.postMessage({
        type: 'error',
        runId: message.runId,
        error: error?.message || String(error),
      });
      self.postMessage({ type: 'done', runId: message.runId });
    } finally {
      activeStreamRuns.delete(message.runId);
    }
    return;
  }

  if (message?.type === 'cancel') {
    activeStreamRuns.delete(message.runId);
    return;
  }

  if (message?.type !== 'start') return;

  const { runId } = message;
  try {
    const result = calculateEstimationResult(message);
    if (result.type === 'combined' || result.type === 'single') {
      const { type: mode, rows, ...startPayload } = result;
      self.postMessage({ type: 'start', runId, mode, ...startPayload, count: rows.length });
      rows.forEach((row, index) => {
        self.postMessage({
          type: 'row',
          runId,
          mode,
          index: index + 1,
          groupKeys: result.groupKeys,
          groupKey: result.groupKey,
          ...row,
        });
      });
      runPriceMatchPhase({
        result,
        state: message.state,
        collectibleItemsByGroup: message.collectibleItemsByGroup,
        predictionGroupKeys: message.predictionGroupKeys,
        profile: message.profile,
        runId,
        postMessage: self.postMessage.bind(self),
      });
      self.postMessage({ type: 'done', runId });
      return;
    }

    self.postMessage({ type: 'result', runId, result });
    runPriceMatchPhase({
      result,
      state: message.state,
      collectibleItemsByGroup: message.collectibleItemsByGroup,
      predictionGroupKeys: message.predictionGroupKeys,
      profile: message.profile,
      runId,
      postMessage: self.postMessage.bind(self),
    });
    self.postMessage({ type: 'done', runId });
  } catch (error) {
    self.postMessage({
      type: 'error',
      runId,
      error: error?.message || String(error),
    });
  }
};
