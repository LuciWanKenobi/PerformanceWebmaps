import { createGribWorkerHandler } from './grib-worker-core.js';
import { observeWorkerResources } from './benchmark/network.js';

const flushResources = observeWorkerResources((message) => self.postMessage(message));

self.onmessage = createGribWorkerHandler(
  (message, transfer = []) => { flushResources(); self.postMessage(message, transfer); },
);
