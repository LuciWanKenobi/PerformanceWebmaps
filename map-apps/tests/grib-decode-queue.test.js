import test from 'node:test';
import assert from 'node:assert/strict';
import { createGribDecodeQueue } from '../shared/grib-decode-queue.js';
import { sampleMemory } from '../shared/benchmark/measurements.js';
import { failureDetails } from '../shared/benchmark/errors.js';

const tick = () => new Promise(setImmediate);
function harness(options = {}) {
  const workers = [];
  let live = 0, peak = 0;
  const decode = createGribDecodeQueue({ loadModule: async () => 'compiled', ...options,
    createWorker: () => {
      live++; peak = Math.max(peak, live);
      const worker = { terminated: false,
        postMessage(data) { this.request = data; },
        terminate() { assert.equal(this.terminated, false); this.terminated = true; live--; },
        complete() { this.onmessage({ data: { type: 'decoded', grid: { id: this.request.url } } }); },
      };
      workers.push(worker); return worker;
    } });
  return { decode, workers, live: () => live, peak: () => peak };
}

test('80 independent GRIB loads use at most four live decoders and terminate each before starting another', async () => {
  const h = harness();
  const results = Array.from({ length: 80 }, (_, index) => h.decode(`/grid-${index}`, { mapIndex: index + 1 }));
  for (let batch = 0; batch < 20; batch++) {
    await tick();
    assert.equal(h.live(), 4);
    h.workers.filter((worker) => !worker.terminated).forEach((worker) => worker.complete());
  }
  const grids = await Promise.all(results);
  assert.equal(h.peak(), 4); assert.equal(h.live(), 0);
  assert.deepEqual(grids.map(({ id }) => id), Array.from({ length: 80 }, (_, index) => `/grid-${index}`));
  assert.equal(sampleMemory().gribWorkerCount, 0);
});

test('removing queued and active layers cancels requests, releases capacity and never starts removed layers', async () => {
  const h = harness({ concurrency: 1 });
  const active = new AbortController(), queued = new AbortController();
  const first = h.decode('/active', {}, active.signal), second = h.decode('/queued', {}, queued.signal);
  const third = h.decode('/remaining', {});
  const firstRejected = assert.rejects(first, /active removed/), secondRejected = assert.rejects(second, /queued removed/);
  await tick();
  queued.abort(new Error('queued removed')); active.abort(new Error('active removed'));
  await Promise.all([firstRejected, secondRejected]); await tick();
  assert.equal(h.workers.length, 2);
  assert.equal(h.workers[1].request.url, '/remaining');
  h.workers[1].complete(); await third;
  assert.equal(h.live(), 0);
});

test('decoder errors retain worker stack/cause and release the next queued load', async () => {
  const h = harness({ concurrency: 1 });
  const error = new RangeError('WASM allocation failed', { cause: new Error('memory unavailable') });
  const failed = h.decode('/failed', {}), next = h.decode('/next', {});
  const rejected = assert.rejects(failed, (actual) => {
    assert.equal(actual.name, 'RangeError'); assert.equal(actual.stack, error.stack);
    assert.equal(actual.cause.message, 'memory unavailable'); return true;
  });
  await tick(); h.workers[0].onmessage({ data: { type: 'error', ...failureDetails(error) } });
  await rejected; await tick(); h.workers[1].complete(); await next;
  assert.equal(h.live(), 0);
});

test('hung decoders time out and failed module loads leave no workers or allocations', async () => {
  const h = harness({ timeoutMs: 15 });
  await assert.rejects(h.decode('/hung', {}), /decoding timed out/);
  assert.equal(h.live(), 0);
  const broken = harness({ loadModule: async () => { throw new Error('compile failed'); } });
  await assert.rejects(broken.decode('/grid', {}), /compile failed/);
  assert.equal(broken.workers.length, 0);
  assert.equal(sampleMemory().gribWorkerCount, 0);
});
