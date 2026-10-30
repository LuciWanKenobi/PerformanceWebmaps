import { recordWorkerResource } from './benchmark/network.js';
import { createGribModuleLoader } from './grib-wasm.js';
import { recordStage, recordAllocation } from './benchmark/measurements.js';
import { createGribDecodeQueue } from './grib-decode-queue.js';
import { errorFromDetails } from './benchmark/errors.js';

// Lazy, page-wide promise: concurrent layers and later trials reuse this code.
const loadDecoderModule = createGribModuleLoader(async () =>
  (await import('@meri-imperiumi/eccodes-wasm/build/eccodes/eccodes.wasm?url')).default);
const decode = createGribDecodeQueue({ loadModule: loadDecoderModule,
  createWorker: () => new Worker(new URL('./grib-decode.worker.js', import.meta.url), { type: 'module' }) });

export function createGribReader(url, layer, { decodeGrid = decode,
  createWorker = () => new Worker(new URL('./grib.worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker;
  const controller = new AbortController();
  const pending = new Map();
  const allocationId = crypto.randomUUID();
  const memoryTimer = setInterval(() => { if (worker && !disposed && !failed) worker.postMessage({ type: 'metrics' }); }, 250);
  let sequence = 0, disposed = false, failed;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // render() and the overlay status both observe the same initialization error.
  ready.catch(() => {});
  function fail(error) {
    if (failed) return;
    failed = error;
    controller.abort(error);
    worker?.terminate();
    clearInterval(memoryTimer); recordAllocation(allocationId, null);
    rejectReady(error);
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  }
  const receive = ({ data }) => {
    if (disposed || failed) return;
    if (data.memory) recordAllocation(allocationId, data.memory);
    data.measurements?.forEach(recordStage);
    if (data.type === 'metrics') return;
    if (data.type === 'resource') { recordWorkerResource(data.entry); return; }
    if (data.type === 'ready') { resolveReady(); return; }
    const job = pending.get(data.id);
    if (data.type === 'error') {
      const error = errorFromDetails(data);
      if (job) { pending.delete(data.id); job.reject(error); }
      else fail(error);
    } else if (job && (data.type === 'pixels' || data.type === 'styled')) {
      pending.delete(data.id); job.resolve(data.pixels);
    }
  };
  decodeGrid(url, layer, controller.signal).then((grid) => {
    if (disposed || failed) return;
    worker = createWorker();
    recordAllocation(allocationId, { gribWorker: true, workerGridBytes: grid.values.byteLength });
    worker.onmessage = receive;
    worker.onerror = (event) => fail(event.error ?? new Error(event.message || 'GRIB2 render worker failed.'));
    worker.onmessageerror = () => fail(new Error('Could not read the GRIB2 worker response.'));
    worker.postMessage({ type: 'init-grid', grid, layer }, [grid.values.buffer]);
  }).catch((error) => { if (!disposed && !failed) fail(error); });
  return {
    ready,
    dispose() {
      disposed = true;
      fail(new DOMException('Weather layer removed.', 'AbortError'));
    },
    async restyle(style) {
      await ready;
      if (disposed || failed) throw failed || new DOMException('Weather layer removed.', 'AbortError');
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'style', id, style });
      });
    },
    async render(bbox, width, height) {
      await ready;
      if (disposed || failed) throw failed || new DOMException('Weather layer removed.', 'AbortError');
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'render', id, bbox, width, height });
      });
    },
  };
}
