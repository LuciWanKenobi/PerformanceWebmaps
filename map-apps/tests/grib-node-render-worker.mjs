import { parentPort } from 'node:worker_threads';
import { createGribWorkerHandler } from '../shared/grib-worker-core.js';
const handler = createGribWorkerHandler(
  (message, transfer = []) => parentPort.postMessage(message, transfer));
parentPort.on('message', (data) => handler({ data }));
