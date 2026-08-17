// Marker model (backlog #16): named positions on the timeline. Markers are
// project-level data (stored in the versioned snapshot) that the arranger
// renders on the ruler and uses for navigation (seek to a marker's tick).
// Pure functions for data shaping + a tiny reactive store for the live UI.

// Plain-data marker: { id, name, tick }. `tick` is an absolute PPQ position.
export function defaultMarker(cfg = {}) {
  return {
    id: cfg.id || 'mrk_' + Math.random().toString(36).slice(2, 8),
    name: cfg.name || 'Marker',
    tick: cfg.tick === undefined ? 0 : cfg.tick,
  };
}

export function normalizeMarker(m) {
  const src = m && typeof m === 'object' ? m : {};
  return {
    id: typeof src.id === 'string' && src.id ? src.id : defaultMarker().id,
    name: typeof src.name === 'string' ? src.name : 'Marker',
    tick: typeof src.tick === 'number' && src.tick >= 0 ? src.tick : 0,
  };
}

export function sortMarkers(markers) {
  return (markers || []).slice().sort((a, b) => a.tick - b.tick);
}

// Pure helpers that return new arrays (used by commands/tests).
export function addMarker(markers, cfg) {
  return sortMarkers((markers || []).concat(defaultMarker(cfg)));
}

export function removeMarker(markers, id) {
  return (markers || []).filter(m => m.id !== id);
}

// Reactive store backing the live arranger + project capture/apply.
export function createMarkerStore(cfg = {}) {
  let markers = sortMarkers((cfg.markers || []).map(normalizeMarker));
  const listeners = [];
  function emit() {
    const copy = markers.map(m => ({ ...m }));
    for (const fn of listeners) {
      try { fn(copy); } catch (e) {}
    }
  }
  return {
    getMarkers: () => markers.map(m => ({ ...m })),
    add(c) {
      const m = defaultMarker(c);
      markers.push(m);
      markers = sortMarkers(markers);
      emit();
      return m;
    },
    remove(id) {
      const i = markers.findIndex(m => m.id === id);
      if (i < 0) return false;
      markers.splice(i, 1);
      emit();
      return true;
    },
    set(list) {
      markers = sortMarkers((list || []).map(normalizeMarker));
      emit();
    },
    subscribe(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
  };
}