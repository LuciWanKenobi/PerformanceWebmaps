import { decodeGrib } from './grib-decoder.js';
import { epochNow } from './benchmark/measurements.js';

export async function decodeGribRequest(data, createModule, fetchFile = fetch, onMemory = () => {}) {
  const layer = data.layer;
  const [module, response] = await Promise.all([Promise.resolve().then(() => createModule(data.module)).then((module) => {
    onMemory({ wasmCapacityBytes: module.HEAPU8.byteLength, gribWorker: true });
    return module;
  }), fetchFile(data.url, layer.requestKey ? { cache: 'no-store' } : undefined)]);
  if (!response.ok) throw new Error(`GRIB2 server returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const startEpochMs = epochNow();
  const grid = decodeGrib(module, bytes, layer.message, layer.nodata);
  const measurements = [{ kind: 'decode', durationMs: epochNow() - startEpochMs, startEpochMs,
    status: 'completed', mode: 'grib', mapIndex: layer.mapIndex ?? null, layerId: layer.id }];
  if (grid.width !== layer.width || grid.height !== layer.height || grid.units !== layer.units ||
      grid.bounds.some((v, i) => Math.abs(v - layer.bounds[i]) > 0.000001)) {
    throw new Error('GRIB2 metadata differs from the catalog. Regenerate the catalog and reload weather.');
  }
  return { grid, measurements, memory: { workerGridBytes: grid.values.byteLength,
    wasmCapacityBytes: module.HEAPU8.byteLength, gribWorker: true } };
}
