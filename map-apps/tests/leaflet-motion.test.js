import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { retainTilesDuringMotion } from '../shared/benchmark/leaflet-motion.js';

// Minimal DOM for exercising the installed Leaflet grid and its real reset,
// loading and pruning code, without fetching images or starting a browser.
function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), style: {}, children: [], className: '',
    appendChild(child) {
      if (child.tagName === 'FRAGMENT') {
        for (const node of [...child.children]) this.appendChild(node);
      } else {
        child.parentNode?.removeChild(child);
        this.children.push(child); child.parentNode = this;
      }
      return child;
    },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
    setAttribute(key, value) { this[key] = value; },
    getAttribute(key) { return this[key]; },
    addEventListener() {}, removeEventListener() {},
  };
}

function fixture(png) {
  const document = { documentElement: { style: { MozPerspective: '', transform: '' } },
    createElement: element, createDocumentFragment: () => element('fragment') };
  const window = { devicePixelRatio: 1, screen: {}, requestAnimationFrame: () => 1,
    cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} };
  const context = { document, window, navigator: { userAgent: 'test', platform: 'Win32' }, setTimeout, clearTimeout };
  runInNewContext(readFileSync(new URL('../node_modules/leaflet/dist/leaflet-src.js', import.meta.url), 'utf8'), context);
  const L = context.leaflet;
  const pane = element();
  const map = new L.Evented();
  Object.assign(map, {
    options: { crs: L.CRS.EPSG3857 }, _zoom: 4, _center: L.latLng(52, 12),
    getCenter() { return this._center; }, getZoom() { return this._zoom; },
    getPane: () => pane, getSize: () => L.point(512, 512),
    getZoomScale: (to, from) => 2 ** (to - from),
    project(latlng, zoom = map._zoom) { return L.CRS.EPSG3857.latLngToPoint(L.latLng(latlng), zoom); },
    unproject(point, zoom = map._zoom) { return L.CRS.EPSG3857.pointToLatLng(point, zoom); },
    getPixelOrigin() { return this._getNewPixelOrigin(this._center, this._zoom); },
    _getNewPixelOrigin(center, zoom) { return this.project(center, zoom).subtract([256, 256]).round(); },
    getPixelWorldBounds: (zoom) => L.CRS.EPSG3857.getProjectedBounds(zoom),
    _removeZoomLimit() {},
  });
  const AsyncGrid = L.GridLayer.extend({ createTile(_coords, _done) { return element('canvas'); } });
  const tiles = retainTilesDuringMotion(png ? L.tileLayer('https://example.test/{z}/{x}/{y}.png', { maxNativeZoom: 5 })
    : new AsyncGrid({ maxNativeZoom: 5 }));
  tiles._map = map;
  map.on(tiles.getEvents(), tiles);
  tiles.onAdd(map);
  const finish = () => {
    for (const { coords, el } of Object.values(tiles._tiles)) {
      el.complete = true;
      tiles._tileReady(coords, null, el);
    }
  };
  const move = (center, zoom) => {
    // Same reset/event sequence as Map.setView({ animate: false }).
    map.fire('viewprereset');
    map._center = L.latLng(center); map._zoom = zoom;
    map.fire('zoom').fire('moveend').fire('viewreset');
  };
  finish();
  return { tiles, move, finish, map };
}

for (const png of [false, true]) {
  test(`${png ? 'PNG' : 'numeric canvas'} tiles survive motion resets while new tiles keep loading`, () => {
    const { tiles, move, finish } = fixture(png);
    const initial = Object.values(tiles._tiles).map(({ el }) => el);
    assert.ok(initial.length > 0);
    tiles.setMotionPaused(true);
    move([52, 12], 4.1);
    assert.ok(initial.every((el) => el.parentNode), 'existing raster stays attached on the first camera step');
    move([52, 12], 5);
    assert.ok(initial.some((el) => el.parentNode), 'loaded parents remain available during zoom');
    assert.ok(Object.values(tiles._tiles).some(({ coords, loaded }) => coords.z === 5 && !loaded),
      'new zoom tiles load during motion');
    finish();
    move([52, 26], 12);
    assert.ok(Object.values(tiles._tiles).some(({ current, coords }) => current && coords.z === 5),
      'deep zoom still uses the native source resolution');
    finish();
    assert.equal(tiles.isLoading(), false);
    tiles.setMotionPaused(false);
    move([52, 12], 4);
    assert.ok(Object.values(tiles._tiles).every(({ coords }) => coords.z === 4),
      'ordinary view resets work after motion stops');
  });

  test(`${png ? 'PNG' : 'numeric canvas'} removal still unloads tiles during motion`, () => {
    const { tiles, map } = fixture(png);
    tiles.setMotionPaused(true);
    tiles.onRemove(map);
    assert.equal(Object.keys(tiles._tiles).length, 0);
    assert.equal(tiles._container, null);
  });
}
