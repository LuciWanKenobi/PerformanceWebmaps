import { colorTableStyle } from '../color-tables.js';
import L from 'leaflet';
import { rasterNativeZoom } from '../raster-resolution.js';
import 'leaflet/dist/leaflet.css';
import '../style.css';
import { CENTER, ZOOM } from '../config.js';
import { createLeafletAdapter } from './leaflet-adapter.js';
import { createCogReader, xyzBounds } from '../cog-reader.js';
import { createGribReader } from '../grib-reader.js';
import { afterFrames, waitUntil } from './timing.js';
import { recordAllocation, timedStage } from './measurements.js';
import { trackLeafletTiles } from './raster-coverage-adapters.js';
import { retainTilesDuringMotion } from './leaflet-motion.js';

import { cogUrl, gribUrl, weatherTileUrl } from '../weather.js';

export function createLeafletMapFactory() {
  return async (surface, index, signal, startup = {}) => {
    signal.throwIfAborted();
    // Leaflet's view API expects [latitude, longitude]; GeoJSON remains [lng, lat].
    const position = startup.camera?.center ?? CENTER;
    const center = [position[1], position[0]];
    const map = L.map(surface, { minZoom: 1, maxZoom: 19, zoomSnap: 0 });
    try {
      map.setView(center, startup.camera?.zoom ?? ZOOM);
      const createOverlay = (layer, mode, onError) => {
        const maxNativeZoom = rasterNativeZoom(layer);
        if (mode === 'cog' || mode === 'grib') {
          const reader = mode === 'cog' ? createCogReader(cogUrl(layer), layer)
            : createGribReader(gribUrl(layer), layer);
          let removed = false;
          const canvases = new Map();
          const rendered = new Map();
          const cacheRender = (key, render) => {
            rendered.set(key, render);
            while (rendered.size > 64) rendered.delete(rendered.keys().next().value);
          };
          const forgetCanvas = (canvas) => { recordAllocation(canvases.get(canvas), null); canvases.delete(canvas); };
          const CogGrid = L.GridLayer.extend({
            createTile(coords, done) {
              const canvas = L.DomUtil.create('canvas', 'leaflet-tile');
              canvas.width = canvas.height = 256;
              const allocationId = crypto.randomUUID();
              canvases.set(canvas, allocationId);
              recordAllocation(allocationId, { canvasPixelBytes: 256 * 256 * 4 });
              const key = `${coords.z}/${coords.x}/${coords.y}`;
              let render = rendered.get(key);
              if (!render) {
                render = reader.render(xyzBounds(coords.z, coords.x, coords.y), 256, 256);
                cacheRender(key, render);
                render.catch(() => rendered.delete(key));
              }
              render.then((pixels) => {
                if (removed) return;
                timedStage('upload', () => canvas.getContext('2d').putImageData(new ImageData(pixels, 256, 256), 0, 0),
                  { mode, mapIndex: layer.mapIndex ?? null, layerId: layer.id });
                done(null, canvas);
              }).catch((error) => { if (!removed) { onError(error); done(error, canvas); } });
              return canvas;
            },
          });
          const tiles = retainTilesDuringMotion(new CogGrid({ tileSize: 256, opacity: 0.7, maxZoom: 19, maxNativeZoom, keepBuffer: 2,
            attribution: 'DWD ICON forecast', noWrap: true,
            bounds: [[layer.bounds[1], layer.bounds[0]], [layer.bounds[3], layer.bounds[2]]] })
            .on('tileunload', ({ tile }) => forgetCanvas(tile)));
          const tracking = trackLeafletTiles(map, tiles, layer);
          tiles.addTo(map);
          return {
            sampleCoverage: tracking.sampleCoverage, workStats: tracking.workStats,
            async restyle() {
              await reader.restyle(colorTableStyle(layer));
              tiles.redraw();
            },
            ready: reader.ready,
            async settle(signal) {
              await afterFrames(2, signal);
              await waitUntil(() => !tiles.isLoading(), signal);
              await afterFrames(2, signal);
            },
            remove() { tracking.dispose(); removed = true; reader.dispose(); rendered.clear(); map.removeLayer(tiles); [...canvases.keys()].forEach(forgetCanvas); },
            setVisible(visible) { if (visible) tiles.addTo(map); else map.removeLayer(tiles); },
            setMotionPaused(paused) { tiles.setMotionPaused(paused); },
          };
        }
        const options = { opacity: 0.7, tileSize: 256, maxZoom: 19, maxNativeZoom, keepBuffer: 2, noWrap: true,
          bounds: [[layer.bounds[1], layer.bounds[0]], [layer.bounds[3], layer.bounds[2]]], attribution: 'DWD ICON forecast' };
        const tiles = retainTilesDuringMotion(L.tileLayer(weatherTileUrl(layer, mode), options));
        const tracking = trackLeafletTiles(map, tiles, layer);
        tiles.on('tileerror', onError).addTo(map);
        return {
          sampleCoverage: tracking.sampleCoverage, workStats: tracking.workStats,
          async settle(signal) {
            await afterFrames(2, signal);
            await waitUntil(() => !tiles.isLoading(), signal);
            await afterFrames(2, signal);
          },
          remove() { tracking.dispose(); map.removeLayer(tiles); tiles.off('tileerror', onError); },
          setVisible(visible) { if (visible) tiles.addTo(map); else map.removeLayer(tiles); },
          setMotionPaused(paused) { tiles.setMotionPaused(paused); },
        };
      };
      return {
        surface, createOverlay,
        adapter: createLeafletAdapter(map),
        setMotionPaused(paused) { map.eachLayer((layer) => layer.setMotionPaused?.(paused)); },
        getCamera: () => ({ center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() }),
        onCameraChange(handler) { map.on('move', handler); return () => map.off('move', handler); },
        destroy() { map.remove(); },
      };
    } catch (error) { map.remove(); throw error; }
  };
}
