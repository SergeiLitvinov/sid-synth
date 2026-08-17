// Undoable marker commands (backlog #16). `store` is a markerStore from
// markers.js — addMarkerCommand/removeMarkerCommand go through the command
// history so markers can be added/removed with undo/redo like any edit.
export function addMarkerCommand(store, cfg) {
  let createdId = null;
  return {
    label: 'Add marker',
    apply() {
      const m = store.add(cfg);
      createdId = m ? m.id : null;
    },
    undo() {
      if (createdId) store.remove(createdId);
    },
  };
}

export function removeMarkerCommand(store, markerId) {
  let snapshot = null;
  return {
    label: 'Remove marker',
    apply() {
      const found = store.getMarkers().find(m => m.id === markerId);
      if (!found) return;
      snapshot = { ...found };
      store.remove(markerId);
    },
    undo() {
      if (snapshot) store.add(snapshot);
    },
  };
}