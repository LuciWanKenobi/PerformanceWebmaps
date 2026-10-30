// Node bridge for the production one-shot decoder protocol.
import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { decodeGribRequest } from '../shared/grib-decode-core.js';
import { instantiateGribModule } from '../shared/grib-wasm.js';
import { failureDetails } from '../shared/benchmark/errors.js';
const require = createRequire(import.meta.url);
const createEccodesModule = require('@meri-imperiumi/eccodes-wasm/build/eccodes/eccodes.js');
parentPort.on('message', async (data) => {
  try {
    const result = await decodeGribRequest(data, (module) => instantiateGribModule(createEccodesModule, module), fetch,
      (memory) => parentPort.postMessage({ type: 'memory', memory }));
    parentPort.postMessage({ type: 'decoded', ...result }, [result.grid.values.buffer]);
  } catch (error) { parentPort.postMessage({ type: 'error', ...failureDetails(error) }); }
});
