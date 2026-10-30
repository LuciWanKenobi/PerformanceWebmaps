import { POINT_COLOR, POINT_RADIUS } from '../config.js';
import { waitForMapEvent } from './timing.js';

export function createGlAdapter(map, { library, version }) {
  const ids = [];
  let contextLost = false;
  map.on('webglcontextlost', () => { contextLost = true; });
  map.on('webglcontextrestored', () => { contextLost = false; });
  const assertReady = () => {
    if (contextLost) throw new Error('WebGL context lost. Reduce the map count for this browser/GPU.');
  };
  return {
    assertReady,
    library, version, renderer: 'WebGL circles', readySignal: 'idle',
    size: () => map.getContainer().getBoundingClientRect(),
    resize: () => map.resize(),
    watchErrors(callback) {
      const handler = (event) => callback(new Error(event?.error?.message
        ? 'Map resource failed: ' + event.error.message
        : 'A map resource failed during the benchmark. Trial discarded.', { cause: event?.error }));
      map.on('error', handler);
      const lost = () => callback(new Error('WebGL context lost. Trial discarded; reduce the map count.'));
      map.on('webglcontextlost', lost);
      return () => { map.off('error', handler); map.off('webglcontextlost', lost); };
    },
    prepare() {
      assertReady();
      const state = {
        center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
      };
      map.stop();
      return state;
    },
    restore(state) {
      map.jumpTo(state);
    },
    addPoints(datasets) {
      datasets.forEach((data, index) => {
        const id = `benchmark-${index}`;
        ids.push(id);
        map.addSource(id, { type: 'geojson', data });
        map.addLayer({
          id, type: 'circle', source: id,
          paint: { 'circle-radius': POINT_RADIUS, 'circle-color': POINT_COLOR,
            'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
        });
      });
    },
    restylePoints({ pointColor }) {
      for (const id of ids) {
        map.setPaintProperty(id, 'circle-color-transition', { duration: 0, delay: 0 });
        map.setPaintProperty(id, 'circle-color', pointColor);
      }
    },
    clearPoints() {
      for (const id of ids.splice(0).reverse()) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    },
    updatePoints(datasets) {
      if (datasets.length !== ids.length) throw new Error('Point layer count changed during the trial.');
      datasets.forEach((data, index) => map.getSource(ids[index]).setData(data));
    },
    setCamera({ center, zoom }) { map.jumpTo({ center, zoom: zoom - 1, bearing: 0, pitch: 0 }); },
    settle(signal) {
      return waitForMapEvent({ on: map.on.bind(map), off: map.off.bind(map), trigger: () => map.triggerRepaint() }, 'idle', signal);
    },
  };
}
