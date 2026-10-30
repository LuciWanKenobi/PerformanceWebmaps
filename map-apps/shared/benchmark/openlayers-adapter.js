import { Circle, Fill, Stroke, Style } from 'ol/style.js';
import { POINT_COLOR, POINT_RADIUS } from '../config.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { fromLonLat } from 'ol/proj.js';
import { VERSION } from 'ol/util.js';
import { waitForMapEvent } from './timing.js';

export function createOpenLayersAdapter(map) {
  const layers = [];
  const view = map.getView();
  return {
    library: 'OpenLayers', version: VERSION, renderer: 'Canvas vector layers', readySignal: 'rendercomplete',
    size: () => map.getTargetElement().getBoundingClientRect(),
    resize: () => map.updateSize(),
    prepare() {
      const state = {
        center: [...view.getCenter()], zoom: view.getZoom(),
      };
      view.cancelAnimations();
      return state;
    },
    restore(state) {
      view.setCenter(state.center);
      view.setZoom(state.zoom);
    },
    addPoints(datasets) {
      for (const data of datasets) {
        const layer = new VectorLayer({
          source: new VectorSource({
            features: new GeoJSON().readFeatures(data, { featureProjection: 'EPSG:3857' }),
          }),
          style: new Style({ image: new Circle({ radius: POINT_RADIUS,
            fill: new Fill({ color: POINT_COLOR }), stroke: new Stroke({ color: '#ffffff', width: 2 }) }) }),
        });
        layers.push(layer);
        map.addLayer(layer);
      }
    },
    restylePoints({ pointColor }) {
      for (const layer of layers) {
        // Keep each layer's initial style independent of later trials.
        const style = layer.getStyle().clone();
        style.getImage().getFill().setColor(pointColor);
        layer.setStyle(style);
      }
    },
    clearPoints() {
      for (const layer of layers.splice(0)) { map.removeLayer(layer); layer.dispose(); }
    },
    updatePoints(datasets) {
      if (datasets.length !== layers.length) throw new Error('Point layer count changed during the trial.');
      datasets.forEach((data, index) => {
        const source = layers[index].getSource();
        source.clear();
        source.addFeatures(new GeoJSON().readFeatures(data, { featureProjection: 'EPSG:3857' }));
      });
    },
    setCamera({ center, zoom }) { view.setCenter(fromLonLat(center)); view.setZoom(zoom); },
    settle(signal) {
      return waitForMapEvent({ on: map.on.bind(map), off: map.un.bind(map), trigger: () => map.render() }, 'rendercomplete', signal);
    },
  };
}
