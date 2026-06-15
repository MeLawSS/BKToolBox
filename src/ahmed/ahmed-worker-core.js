import {
  createAhmedWorkerContext,
  streamAhmedCombinations,
} from './ahmed-compute-core.js';
import { GROUPS } from '../../public/ahmed/ahmed-core.js';

export function createAhmedWorkerMessageHandler(postMessage) {
  const activeRuns = new Map();
  const runContexts = new Map();
  let latestCompletedRunId = 0;

  function cancelRun(runId) {
    const run = activeRuns.get(runId);
    if (run) {
      run.cancelled = true;
      activeRuns.delete(runId);
    }
    runContexts.delete(runId);
    if (latestCompletedRunId === runId) {
      latestCompletedRunId = 0;
    }
  }

  function releasePreviousCompletedRun(nextRunId = 0) {
    if (!latestCompletedRunId || latestCompletedRunId === nextRunId) return;
    runContexts.delete(latestCompletedRunId);
    latestCompletedRunId = 0;
  }

  return async function handleAhmedWorkerMessage(message = {}) {
    if (message.type === 'cancel-run') {
      cancelRun(message.runId);
      return;
    }

    if (message.type === 'release-run') {
      cancelRun(message.runId);
      return;
    }

    if (message.type === 'start-run') {
      const run = { cancelled: false };
      const context = createAhmedWorkerContext(message.computeState);
      releasePreviousCompletedRun(message.runId);
      activeRuns.set(message.runId, run);
      runContexts.set(message.runId, context);

      postMessage({
        type: 'run-started',
        runId: message.runId,
      });

      try {
        const knownSummary = context.getKnownConstraintSummary();
        if (knownSummary.invalid) {
          runContexts.delete(message.runId);
          postMessage({
            type: 'run-invalid',
            runId: message.runId,
            reason: 'known-constraints-invalid',
          });
          return;
        }

        const possible = Object.fromEntries(GROUPS.map((group) => [
          group.key,
          context.getPossibleCountsForGroup(
            group.key,
            message.search?.countsByGroup?.[group.key] ?? null,
            message.search?.totalCellsByGroup?.[group.key] ?? null,
            message.search?.totalCount ?? 0
          ),
        ]));
        const impossibleGroup = GROUPS.find((group) => possible[group.key].length === 0);
        if (impossibleGroup) {
          runContexts.delete(message.runId);
          postMessage({
            type: 'run-no-combination',
            runId: message.runId,
            groupKey: impossibleGroup.key,
          });
          return;
        }

        const result = await streamAhmedCombinations({
          ...message.search,
          possible,
          knownSummary,
          context,
          onRows: async ({ rows, totalMatches }) => {
            if (run.cancelled) return;
            postMessage({
              type: 'run-rows',
              runId: message.runId,
              rows,
              totalMatches,
            });
          },
          onProgress: async ({ red, redEnd, totalMatches, rows }) => {
            if (run.cancelled) return;
            postMessage({
              type: 'run-progress',
              runId: message.runId,
              red,
              redEnd,
              totalMatches,
              rows,
            });
          },
          shouldCancel: () => run.cancelled,
        });

        if (!run.cancelled && !result.cancelled) {
          releasePreviousCompletedRun(message.runId);
          latestCompletedRunId = message.runId;
          postMessage({
            type: 'run-complete',
            runId: message.runId,
            totalMatches: result.totalMatches,
            stoppedEarly: result.stoppedEarly,
          });
        }
      } catch (error) {
        if (!run.cancelled) {
          postMessage({
            type: 'run-error',
            runId: message.runId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        runContexts.delete(message.runId);
      } finally {
        activeRuns.delete(message.runId);
        if (run.cancelled) {
          runContexts.delete(message.runId);
        }
      }
      return;
    }

    if (message.type === 'open-detail') {
      const context = runContexts.get(message.runId);
      if (!context) {
        postMessage({
          type: 'detail-result',
          runId: message.runId,
          requestId: message.requestId,
          row: message.row,
          detail: null,
        });
        return;
      }

      try {
        postMessage({
          type: 'detail-started',
          runId: message.runId,
          requestId: message.requestId,
        });

        const detail = context.getDetailForRow(message.row);
        postMessage({
          type: 'detail-result',
          runId: message.runId,
          requestId: message.requestId,
          row: message.row,
          detail,
        });
      } catch (error) {
        postMessage({
          type: 'detail-error',
          runId: message.runId,
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
