import { projectRaster } from './cog-reader.js';
import { epochNow } from './benchmark/measurements.js';
import { failureDetails } from './benchmark/errors.js';

// Kept separate from the browser entry so the actual worker protocol can also
// be checked in a Node worker against native ecCodes output.
export function createGribWorkerHandler(postMessage) {
  let grid, layer;
  const memory = () => ({ workerGridBytes: grid?.values.byteLength ?? 0,
    wasmCapacityBytes: 0, gribWorker: true });
  return async ({ data }) => {
    const { id, type } = data;
    try {
      if (type === 'init-grid') {
        layer = data.layer;
        grid = data.grid;
        postMessage({ type: 'ready', memory: memory() });
      } else if (type === 'style') {
        if (!grid) throw new Error('GRIB2 worker is not initialized.');
        const style = data.style;
        if (!style || !Number.isFinite(style.min) || !Number.isFinite(style.max) || style.max <= style.min ||
            !Array.isArray(style.colors) || style.colors.length < 2 || style.colors.length > 256 ||
            !style.colors.every((rgb) => Array.isArray(rgb) && rgb.length === 3 &&
              rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) ||
            !['nearest', 'bilinear'].includes(style.resampling)) throw new Error('Invalid GRIB color table.');
        layer = { ...layer, style };
        postMessage({ type: 'styled', id });
      } else if (type === 'render') {
        if (!grid) throw new Error('GRIB2 worker is not initialized.');
        const { bbox, width, height } = data;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
            width > 2048 || height > 2048 || !Array.isArray(bbox) || bbox.length !== 4 ||
            !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
          throw new Error('Invalid worker render dimensions or bounds.');
        }
        const startEpochMs = epochNow();
        const pixels = projectRaster(grid.values, [0, 0, grid.width, grid.height], grid.origin,
          grid.resolution, bbox, width, height, layer.style, layer.nodata);
        postMessage({ type: 'pixels', id, pixels, memory: memory(), measurements: [{ kind: 'projectColor',
          startEpochMs, durationMs: epochNow() - startEpochMs, status: 'completed',
          mode: 'grib', mapIndex: layer.mapIndex ?? null, layerId: layer.id }] }, [pixels.buffer]);
      } else if (type === 'metrics') {
        postMessage({ type: 'metrics', memory: memory() });
      } else {
        throw new Error('Unknown GRIB2 worker request.');
      }
    } catch (error) {
      postMessage({ type: 'error', id, message: error.message || 'GRIB2 decoding failed.', ...failureDetails(error) });
    }
  };
}
