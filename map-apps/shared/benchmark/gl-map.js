import { CENTER, GL_ZOOM, createMapStyle } from '../config.js';
import { glWeatherFactory } from '../weather.js';
import { createGlAdapter } from './gl-adapter.js';
import { waitForMapEvent } from './timing.js';

export function createGlMapFactory(gl, { library, version, accessToken, projection }) {
  return async (surface, index, signal, startup = {}) => {
    signal.throwIfAborted();
    const style = createMapStyle();
    const map = new gl.Map({ container: surface, style, accessToken, projection,
      center: startup.camera?.center ?? CENTER, zoom: startup.camera ? startup.camera.zoom - 1 : GL_ZOOM, minZoom: 0, maxZoom: 18,
      dragRotate: false, pitchWithRotate: false });
    const initialization = new AbortController();
    const initSignal = AbortSignal.any([signal, initialization.signal]);
    const lost = () => initialization.abort(new Error('WebGL context lost during map initialization. Reduce the map count.'));
    const failed = (event) => { if (startup.benchmark) initialization.abort(event.error ?? new Error('Map initialization failed.')); };
    map.on('webglcontextlost', lost); map.on('error', failed);
    try {
      map.touchZoomRotate.disableRotation();
      map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-left');
      if (!map.loaded()) await waitForMapEvent({ on: map.on.bind(map), off: map.off.bind(map),
        trigger: () => map.triggerRepaint() }, 'load', initSignal);
      initSignal.throwIfAborted();
      return {
        surface, createOverlay: glWeatherFactory(map),
        adapter: createGlAdapter(map, { library, version }),
        getCamera: () => ({ center: map.getCenter().toArray(), zoom: map.getZoom() + 1 }),
        onCameraChange(handler) { map.on('move', handler); return () => map.off('move', handler); },
        destroy() { map.remove(); },
      };
    } catch (error) { map.remove(); throw error; }
    finally { map.off('webglcontextlost', lost); map.off('error', failed); }
  };
}
