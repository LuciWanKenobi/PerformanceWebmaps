// Leaflet 1.9.4 setView({ animate: false }) fires viewprereset on each
// benchmark frame. Keep the existing grid through that reset, as Leaflet
// does during animated zooms, so loaded tiles can serve as fallbacks while
// the native grid loads tiles for the new view. _setView and _update must
// keep running throughout motion.
export function retainTilesDuringMotion(tiles) {
  const invalidateAll = tiles._invalidateAll;
  let moving = false;
  tiles._invalidateAll = function (...args) {
    if (!moving) return invalidateAll.apply(this, args);
  };
  // The shared runner uses true while moving and false at every stop,
  // including cancellation and failure.
  tiles.setMotionPaused = (paused) => { moving = paused; };
  return tiles;
}
