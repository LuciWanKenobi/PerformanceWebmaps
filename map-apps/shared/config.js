// GeoJSON and GL libraries use [longitude, latitude].
export const CENTER = [10.45, 51.16];
export const ZOOM = 6;

// GL zoom uses a 512px world tile; Leaflet/OpenLayers use 256px.
// Subtract one to give all four apps the same initial map scale.
export const GL_ZOOM = ZOOM - 1;

export function createMapStyle() {
  return {
    version: 8,
    sources: {},
    layers: [],
  };
}

export const POINT_COLOR = '#155bb5';
export const POINT_RADIUS = 3;

export const COG_SERVER = (import.meta.env?.VITE_COG_SERVER || 'http://127.0.0.1:8001').replace(/\/$/, '');
export const XYZ_SERVER = (import.meta.env?.VITE_XYZ_SERVER || 'http://127.0.0.1:8002').replace(/\/$/, '');
export const METRICS_SERVER = (import.meta.env?.VITE_METRICS_SERVER || 'http://127.0.0.1:8004').replace(/\/$/, '');
