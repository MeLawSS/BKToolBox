import { describe, expect, it } from 'vitest';
import { run } from './solver.js';

class FakeWorker {
  constructor(workerFile, options) {
    this.workerFile = workerFile;
    this.options = options;
    this.handlers = {};
    FakeWorker.instances.push(this);
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  emit(event, value) {
    const handler = this.handlers[event];
    if (handler) handler(value);
  }

  message(value) {
    this.emit('message', value);
  }

  error(message) {
    this.emit('error', new Error(message));
  }

  exit(code) {
    this.emit('exit', code);
  }

  static reset() {
    FakeWorker.instances = [];
  }
}

FakeWorker.instances = [];

describe('solver run orchestration', () => {
  it('exits cleanly when no counts are valid', () => {
    const logs = [];
    const exits = [];

    run([], [], 'worker.js', {
      headerLabel: () => '',
      lineLabel: () => '',
    }, {
      Worker: FakeWorker,
      log: (line) => logs.push(line),
      exit: (code) => exits.push(code),
    });

    expect(logs).toEqual(['No valid count found.']);
    expect(exits).toEqual([0]);
  });

  it('buffers out-of-order worker output until earlier counts finish', () => {
    FakeWorker.reset();
    const logs = [];
    const exits = [];

    run(
      [
        { n: 1, total: 10, dedupeGoldRed: true },
        { n: 2, total: 20 },
      ],
      [{ id: 1 }],
      'worker.js',
      {
        headerLabel: (n, total) => `Count=${n}, Total=${total}`,
        lineLabel: (msg) => `n=${msg.n}, totalCells=${msg.totalCells}, totalPrice=${msg.totalPrice}`,
      },
      {
        Worker: FakeWorker,
        concurrency: 2,
        globalLimit: 9,
        log: (line) => logs.push(line),
        exit: (code) => exits.push(code),
        getLimit: (n) => n * 3,
      }
    );

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].options.workerData.limit).toBe(3);
    expect(FakeWorker.instances[0].options.workerData.dedupeGoldRed).toBe(true);
    expect(FakeWorker.instances[1].options.workerData.limit).toBe(6);
    expect(FakeWorker.instances[1].options.workerData.dedupeGoldRed).toBeUndefined();

    const first = FakeWorker.instances[0];
    const second = FakeWorker.instances[1];

    second.message({ type: 'combo', n: 2, totalCells: 20, totalPrice: 200 });
    second.message({ type: 'done', n: 2 });
    first.message({ type: 'combo', n: 1, totalCells: 10, totalPrice: 100 });
    first.message({ type: 'done', n: 1 });

    expect(logs).toEqual([
      '\x1b[36mCount=1, Total=10\x1b[0m',
      '  n=1, totalCells=10, totalPrice=100',
      '\x1b[36mCount=2, Total=20\x1b[0m',
      '  n=2, totalCells=20, totalPrice=200',
    ]);
    expect(exits).toEqual([0]);
  });

  it('uses solver concurrency from the environment', () => {
    FakeWorker.reset();

    run(
      [
        { n: 1, total: 10 },
        { n: 2, total: 20 },
      ],
      [{ id: 1 }],
      'worker.js',
      {
        headerLabel: () => '',
        lineLabel: () => '',
      },
      {
        Worker: FakeWorker,
        env: { SOLVER_CONCURRENCY: '1' },
        log: () => {},
        exit: () => {},
      }
    );

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].options.workerData.n).toBe(1);
  });

  it('reports worker errors and exits non-zero', () => {
    FakeWorker.reset();
    const logs = [];
    const exits = [];

    run(
      [{ n: 1, total: 10 }],
      [{ id: 1 }],
      'worker.js',
      {
        headerLabel: (n, total) => `Count=${n}, Total=${total}`,
        lineLabel: () => 'line',
      },
      {
        Worker: FakeWorker,
        log: (line) => logs.push(line),
        exit: (code) => exits.push(code),
      }
    );

    FakeWorker.instances[0].error('boom');
    expect(logs).toContain('    [worker error] boom');
    expect(exits).toEqual([1]);
  });
});
