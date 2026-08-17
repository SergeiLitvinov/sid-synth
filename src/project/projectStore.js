import { migrateProject, fromLegacy } from './migrate.js';

export const PROJECT_STORAGE_KEY = 'sidSynthProject';
export const LEGACY_AUTOSAVE_KEY = 'sidSynthAutosave';
export const LEGACY_TRACKS_KEY = 'sidSynthTracks';

// Unified project persistence. One versioned localStorage key holds the whole
// snapshot (rack + tracks + tempo + active track); the two pre-project keys
// (`sidSynthAutosave`, `sidSynthTracks`) are migrated on first read.
// Pure module — storage, capture() and apply() are injected, so it is
// unit-testable in the browser without DOM or AudioContext.
export function createProjectStore(cfg = {}) {
  const storage = cfg.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const storageKey = cfg.storageKey || PROJECT_STORAGE_KEY;
  const autosaveKey = cfg.autosaveKey || LEGACY_AUTOSAVE_KEY;
  const tracksKey = cfg.tracksKey || LEGACY_TRACKS_KEY;
  const debounceMs = cfg.debounceMs ?? 600;
  const capture = cfg.capture;   // () => project doc (serializable object)
  const apply = cfg.apply;       // (project) => void (restore live app state)
  let timer = null;

  function read(key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { storage.setItem(key, value); } catch (e) {}
  }
  function remove(key) {
    try { storage.removeItem(key); } catch (e) {}
  }

  // Snapshot the live state to the unified key right now.
  function saveNow() {
    clearTimeout(timer);
    timer = null;
    if (!capture) return;
    try { write(storageKey, JSON.stringify(capture())); } catch (e) {}
  }

  // Debounced save.
  function save() {
    clearTimeout(timer);
    timer = setTimeout(saveNow, debounceMs);
  }

  function markDirty() { save(); }

  // Read the unified key; when absent, migrate from the legacy keys, write the
  // migrated doc back (so the next load is a straight read) and drop the legacy
  // keys. Returns the parsed project doc, or null when nothing is stored.
  function readProject() {
    const raw = read(storageKey);
    if (raw) {
      try { return migrateProject(JSON.parse(raw)); } catch (e) { /* fall through */ }
    }
    let autosave = null;
    let tracksStore = null;
    try { autosave = JSON.parse(read(autosaveKey)); } catch (e) {}
    try { tracksStore = JSON.parse(read(tracksKey)); } catch (e) {}
    if (autosave === null && tracksStore === null) return null;
    const project = fromLegacy({ autosave, tracksStore });
    try { write(storageKey, JSON.stringify(project)); } catch (e) {}
    remove(autosaveKey);
    remove(tracksKey);
    return project;
  }

  function restore() {
    const project = readProject();
    if (project && apply) apply(project);
    return project;
  }

  function readRaw() {
    return read(storageKey);
  }

  function clear() {
    clearTimeout(timer);
    timer = null;
    remove(storageKey);
  }

  return { saveNow, save, markDirty, restore, readRaw, readProject, clear };
}
