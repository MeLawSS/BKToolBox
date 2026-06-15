import { createAhmedWorkerMessageHandler } from './ahmed-worker-core.js';

const post = (message) => {
  self.postMessage(message);
};

const handleMessage = createAhmedWorkerMessageHandler(post);

self.onmessage = (event) => {
  Promise.resolve(handleMessage(event.data))
    .catch((error) => {
      self.postMessage({
        type: 'run-error',
        runId: event.data?.runId ?? 0,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};
