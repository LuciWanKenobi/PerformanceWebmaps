import { recordWorkerResource } from './benchmark/network.js';
import { recordAllocation, recordStage } from './benchmark/measurements.js';
import { errorFromDetails } from './benchmark/errors.js';

export const GRIB_DECODE_CONCURRENCY = 4;
export const GRIB_DECODER_POLICY = 'at most 4 temporary independent decoders; terminate after grid transfer; independent render workers';

// Terminating each decode worker releases its entire WASM runtime. Queuing
// startup alone would still leave all decoder memories awaiting collection.
export function createGribDecodeQueue({ loadModule, createWorker, concurrency = GRIB_DECODE_CONCURRENCY,
  timeoutMs = 30000 }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid GRIB decode concurrency.');
  const queue = [];
  let active = 0;
  function pump() {
    while (active < concurrency && queue.length) queue.shift()();
  }
  return (url, layer, signal) => new Promise((resolve, reject) => {
    let worker, timer, started = false, finished = false;
    const allocationId = crypto.randomUUID();
    function finish(error, grid) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      recordAllocation(allocationId, null);
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      if (started) active--;
      if (error) reject(error); else resolve(grid);
      pump();
    }
    const abort = () => finish(signal.reason ?? new DOMException('GRIB decode cancelled.', 'AbortError'));
    function start() {
      if (finished) return;
      started = true; active++;
      timer = setTimeout(() => finish(new Error('GRIB2 decoding timed out after 30 seconds.')), timeoutMs);
      Promise.resolve().then(loadModule).then((module) => {
        if (finished) return;
        worker = createWorker();
        recordAllocation(allocationId, { gribWorker: true });
        worker.onmessage = ({ data }) => {
          if (finished) return;
          if (data.memory) recordAllocation(allocationId, data.memory);
          data.measurements?.forEach(recordStage);
          if (data.type === 'resource') recordWorkerResource(data.entry);
          else if (data.type === 'decoded') finish(null, data.grid);
          else if (data.type === 'error') finish(errorFromDetails(data));
        };
        worker.onerror = (event) => finish(event.error ?? new Error(event.message || 'GRIB2 decoder worker failed.'));
        worker.onmessageerror = () => finish(new Error('Could not read the GRIB2 decoder response.'));
        worker.postMessage({ type: 'decode', url, layer, module });
      }).catch((error) => finish(error));
    }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    queue.push(start); pump();
  });
}
