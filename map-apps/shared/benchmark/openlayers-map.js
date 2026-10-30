import { restyledLayer } from '../color-tables.js';
import Map from 'ol/Map.js';
import { rasterNativeZoom } from '../raster-resolution.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import WebGLTileLayer from 'ol/layer/WebGLTile.js';
import XYZ from 'ol/source/XYZ.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import DataTile from 'ol/source/DataTile.js';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj.js';
import 'ol/ol.css';
import '../style.css';
import { CENTER, ZOOM } from '../config.js';
import { createOpenLayersAdapter } from './openlayers-adapter.js';
import { createGribReader } from '../grib-reader.js';
import { xyzBounds } from '../cog-reader.js';
import { waitForMapEvent } from './timing.js';
import { trackOpenLayersTiles } from './raster-coverage-adapters.js';

import { cogUrl, gribUrl, weatherTileUrl, cogStyle } from '../weather.js';

export function createOpenLayersMapFactory() {
  return async (surface, index, signal, startup = {}) => {
    signal.throwIfAborted();
    let map;
    try {
      const view = new View({ center: fromLonLat(startup.camera?.center ?? CENTER), zoom: startup.camera?.zoom ?? ZOOM, minZoom: 1, maxZoom: 19, enableRotation: false });
      map = new Map({
        target: surface,
        layers: [],
        view,
      });

      const createOverlay = (layer, mode, onError, id = 'weather') => {
        let source, overlay, reader;
        const maxNativeZoom = rasterNativeZoom(layer);
        if (mode === 'cog') {
          source = new GeoTIFF({ sources: [{ url: cogUrl(layer), bands: [1], nodata: layer.nodata }],
            projection: 'EPSG:4326', normalize: false, transition: 0,
            interpolate: layer.style.resampling !== 'nearest',
            sourceOptions: { allowFullFile: false } });
          overlay = new WebGLTileLayer({ source, opacity: 0.7, style: cogStyle(layer) });
        } else if (mode === 'grib') {
          reader = createGribReader(gribUrl(layer), layer);
          source = new DataTile({ tileSize: 256, bandCount: 4, maxZoom: maxNativeZoom,
            projection: 'EPSG:3857', wrapX: false, transition: 0, interpolate: layer.style.resampling !== 'nearest',
            loader: async (z, x, y) => new Uint8Array(await reader.render(xyzBounds(z, x, y), 256, 256)),
            attributions: 'DWD ICON forecast' });
          overlay = new WebGLTileLayer({ source, opacity: 0.7 });
        } else {
          source = new XYZ({ url: weatherTileUrl(layer, mode), tileSize: 256, maxZoom: maxNativeZoom,
              wrapX: false, interpolate: layer.style.resampling !== 'nearest',
              transition: 0, attributions: 'DWD ICON forecast' });
          overlay = new TileLayer({ source, opacity: 0.7 });
        }
        overlay.setExtent(transformExtent(layer.bounds, 'EPSG:4326', 'EPSG:3857'));
        source.on('tileloaderror', onError);
        source.on('error', onError);
        const tracking = trackOpenLayersTiles(map, overlay, source, layer, transformExtent);
        const layers = map.getLayers();
        layers.insertAt(Math.min(1, layers.getLength()), overlay);
        return {
          sampleCoverage: tracking.sampleCoverage, workStats: tracking.workStats,
          restyle: mode === 'xyz' ? undefined : async () => {
            const styled = restyledLayer(layer);
            if (mode === 'cog') overlay.setStyle(cogStyle(styled));
            else if (mode === 'grib') {
              await reader.restyle(styled.style);
              source.refresh();
            }
          },
          ready: reader?.ready,
          async settle(signal) {
            if (mode === 'cog') await source.getView();
            await waitForMapEvent({ on: map.on.bind(map), off: map.un.bind(map),
              trigger: () => map.render() }, 'rendercomplete', signal);
          },
          remove() { tracking.dispose(); reader?.dispose(); map.removeLayer(overlay); overlay.dispose(); source.dispose(); },
          setVisible(visible) { overlay.setVisible(visible); },
        };
      };
      return {
        surface, createOverlay,
        adapter: createOpenLayersAdapter(map),
        getCamera: () => ({ center: toLonLat(view.getCenter()), zoom: view.getZoom() }),
        onCameraChange(handler) {
          const types = ['change:center', 'change:resolution'];
          types.forEach((type) => view.on(type, handler));
          return () => types.forEach((type) => view.un(type, handler));
        },
        destroy() { map.setTarget(undefined); map.dispose(); },
      };
    } catch (error) {
      map?.setTarget(undefined); map?.dispose();
      throw error;
    }
  };
}
