import createEccodesModule from 'virtual:eccodes-worker-loader';
import { decodeGribRequest } from './grib-decode-core.js';
import { instantiateGribModule } from './grib-wasm.js';
import { observeWorkerResources } from './benchmark/network.js';
import { failureDetails } from './benchmark/errors.js';

const flushResources = observeWorkerResources((message) => self.postMessage(message));
self.onmessage = async ({ data }) => {
  try {
    const result = await decodeGribRequest(data,
      (module) => instantiateGribModule(createEccodesModule, module), fetch,
      (memory) => self.postMessage({ type: 'memory', memory }));
    flushResources();
    self.postMessage({ type: 'decoded', ...result }, [result.grid.values.buffer]);
  } catch (error) {
    flushResources();
    self.postMessage({ type: 'error', ...failureDetails(error) });
  }
};
