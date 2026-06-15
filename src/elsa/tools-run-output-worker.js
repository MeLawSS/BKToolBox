import {
  applySolverOutputMessage,
  buildSolverOutputSnapshot,
  createSolverOutputRunState,
} from './tools-run-output-worker-core.js';

const runs = new Map();

function emitSnapshot(runId, state) {
  self.postMessage({
    type: 'snapshot',
    runId,
    ...buildSolverOutputSnapshot(state),
  });
}

self.onmessage = (event) => {
  const message = event.data ?? {};
  const { type, runId } = message;

  if (type === 'cancel') {
    runs.delete(runId);
    return;
  }

  if (type === 'start') {
    const state = createSolverOutputRunState(message);
    runs.set(runId, state);
    emitSnapshot(runId, state);
    return;
  }

  const current = runs.get(runId);
  if (!current) return;

  const nextState = applySolverOutputMessage(current, message);
  runs.set(runId, nextState);
  emitSnapshot(runId, nextState);
};
